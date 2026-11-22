/**
 * Adapter del "hacker externo" (requisito de integración #1). Habla el contrato
 * `hacker: "external"` del backend: hace polling de /sim/:id/inbox, ataca de
 * verdad y publica attack.* en /sim/:id/events. Convierte el hackeo EMULADO
 * (razonamiento LLM) en explotación REAL, y alimenta el debrief con where real.
 *
 * Mantiene un FootholdStore a lo largo de la sesión: en el `verify` tras un
 * parche re-testea EL MISMO acceso robado (p. ej. el JWT) para reportar
 * `attacker_active` correctamente — la lección "cambiaste la clave pero el token
 * robado sigue vivo".
 */
import { diagnose } from '../core/diagnose.ts';
import { toTimelineEvents } from '../core/events.ts';
import { FootholdStore } from '../core/footholds.ts';
import { realClock, type Clock } from '../core/rng.ts';
import type { ProfileName } from '../core/evasion.ts';
import type { EnginePlugin, TargetConfig } from '../core/types.ts';

export interface HackerOpts {
  simId: string;
  token: string;
  backendUrl: string; // p.ej. https://api.mayday.rip
  plugin: EnginePlugin;
  seed?: string;
  profile?: ProfileName;
  destructive?: boolean;
  pollMs?: number;
  maxIdleMs?: number;
  log?: (m: string) => void;
  clock?: Clock;
  /** Inyectable para tests (default fetch global). */
  fetchImpl?: typeof fetch;
}

interface InboxEvent {
  type: string;
  vuln_id?: string | null;
  raw?: Record<string, unknown>;
}

export async function runAsHacker(opts: HackerOpts): Promise<{ attacked: string[]; events_posted: number }> {
  const log = opts.log ?? (() => {});
  const clock = opts.clock ?? realClock;
  const doFetch = opts.fetchImpl ?? fetch;
  const pollMs = opts.pollMs ?? 3000;
  const maxIdleMs = opts.maxIdleMs ?? 10 * 60 * 1000;
  const base = `${opts.backendUrl.replace(/\/$/, '')}/sim/${opts.simId}`;
  const headers = { authorization: `Bearer ${opts.token}`, 'x-sim-role': 'hacker' };
  const footholds = new FootholdStore();
  const attacked: string[] = [];
  let posted = 0;

  const api = async (path: string, init?: RequestInit) => {
    const res = await doFetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
    return res;
  };
  const postEvent = async (ev: Record<string, unknown>) => {
    await api('/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ev) });
    posted++;
  };

  // 1. Contexto → target.
  const context = (await (await api('')).json()) as any;
  const app = context.app ?? {};
  const url = String(app.deployed_url ?? app.url ?? '').replace(/\/$/, '');
  if (!url) throw new Error('el contexto no trae app.deployed_url');
  const seed = (app.seed_users ?? []) as Array<{ email: string; password?: string; role?: string }>;
  const weak = seed.find((u) => u.password);
  const target: TargetConfig = {
    url,
    seed_users: seed,
    weak_login: weak ? { email: weak.email, password: weak.password! } : undefined,
  };
  log(`hacker externo listo: target ${url}, ${target.seed_users.length} seed users`);

  // Orden de ataque (del plugin).
  const order = [...opts.plugin.attacks].sort((a, b) => a.meta.order - b.meta.order);
  let nextIdx = 0;

  // 2. attack.plan inicial (del catálogo, con los campos de enseñanza).
  await postPlan();

  // 3. Loop de control.
  let running = true;
  let paused = false;
  let lastActivity = clock.now();
  while (running) {
    const inbox = (await (await api('/inbox')).json()) as { events: InboxEvent[] };
    for (const ev of inbox.events ?? []) {
      lastActivity = clock.now();
      const vuln = (ev.vuln_id ?? (ev.raw?.vuln_id as string | undefined)) || undefined;
      if (ev.type === 'control.start') await postPlan();
      else if (ev.type === 'control.pause') paused = true;
      else if (ev.type === 'control.resume') paused = false;
      else if (ev.type === 'control.finish') running = false;
      else if (ev.type === 'sim.finished') running = false;
      else if (ev.type === 'control.next' && !paused) await attackOne(vuln ?? order[nextIdx++]?.meta.id);
      else if (ev.type === 'control.verify') await verifyOne(vuln);
    }
    if (!running) break;
    if (clock.now() - lastActivity > maxIdleMs) {
      log('hacker externo: idle demasiado tiempo, terminando');
      break;
    }
    await sleep(pollMs);
  }
  return { attacked, events_posted: posted };

  async function postPlan() {
    const findings = order.map((a) => {
      const m = opts.plugin.catalog[a.meta.id];
      return {
        vuln_id: m.id, title: m.title, severity: m.severity, order: m.order,
        location: m.code_location, real_case: m.real_case, correct_fix: m.fix_correct,
        wrong_fixes: m.fix_wrong, symptoms: (opts.plugin.storylines[m.id] ?? []).map((b) => b.symptom),
      };
    });
    await postEvent({ type: 'attack.plan', title: `Plan de ataque: ${findings.length} vulnerabilidades`, body: `Análisis de ${url}`, severity: 'info', raw: { findings } });
  }

  async function attackOne(vulnId: string | undefined) {
    if (!vulnId) return;
    attacked.push(vulnId);
    log(`▶ attack.next ${vulnId}`);
    const diag = await diagnose(target, opts.plugin, { only: [vulnId], seed: opts.seed, profile: opts.profile, destructive: opts.destructive, footholds, clock });
    const r = diag.results[0];
    if (!r) return;
    for (const ev of toTimelineEvents(r, opts.plugin)) await postEvent(ev);
  }

  async function verifyOne(vulnId: string | undefined) {
    if (!vulnId) return;
    log(`▶ attack.verify ${vulnId}`);
    // Captura el foothold robado ANTES de re-ejecutar (el re-run lo sobrescribiría).
    const fh = footholds.get(vulnId);
    // Re-ejecuta el módulo → ¿la vuln sigue presente?
    const diag = await diagnose(target, opts.plugin, { only: [vulnId], seed: opts.seed, profile: opts.profile, footholds, clock });
    const r = diag.results[0];
    const stillExploitable = !!r?.confirmed;

    // ¿El atacante sigue adentro? Re-testea EL foothold persistido (el token robado original).
    let attackerActive = !!r?.attacker_active;
    const footStatus: Array<{ foothold: string; valid: boolean; why: string }> = [];
    if (fh?.token) {
      const whoami = target.whoami_path ?? '/api/users/me';
      const res = await doFetch(`${url}${whoami}`, { headers: { authorization: `Bearer ${fh.token}` } });
      const valid = res.status === 200;
      attackerActive = valid;
      footStatus.push({ foothold: fh.detail, valid, why: valid ? 'el acceso robado todavía autentica' : 'el acceso robado fue invalidado (p. ej. rotaron el secreto)' });
      if (!valid) footholds.delete(vulnId);
    }

    await postEvent({
      type: 'attack.verify', vuln_id: vulnId, severity: attackerActive ? 'critical' : 'info',
      title: `Verificación de ${vulnId}`,
      body: stillExploitable ? 'La vulnerabilidad sigue siendo explotable.' : 'La vulnerabilidad ya no es explotable.',
      raw: { vuln_id: vulnId, still_exploitable: stillExploitable, attacker_active: attackerActive, footholds: footStatus, reason: r?.summary ?? '' },
    });
  }

  function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}
