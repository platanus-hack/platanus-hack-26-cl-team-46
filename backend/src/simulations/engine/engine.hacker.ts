import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { SandboxesService } from '../../sandboxes/sandboxes.service.js';
import { signSimToken } from '../sim-token.js';
import { SimulationStore } from '../simulation.store.js';
import type {
  EngineFinding,
  EngineRecord,
  EngineReplayEvent,
  SimulationRecord,
  TimelineEvent,
} from '../simulation.types.js';
import { SimulationsService } from '../simulations.service.js';
import { TimelineService } from '../timeline.service.js';
import { EngineClient, type EngineRunResult } from './engine.client.js';

const TICK_MS = 5_000;
const LOG_LINES = 300;
/** Pausa antes del primer paso de cada vuln. */
const FIRST_STEP_MS = 4_000;
const CLOSED = ['finished', 'failed', 'stopped'];

interface Queue {
  vuln: string;
  events: EngineReplayEvent[];
  timer?: NodeJS.Timeout;
  paused: boolean;
}

/**
 * El rol hacker de las simulaciones con hacker_mode "external", operado por el
 * motor real en Modal:
 *
 * 1. Primera pasada: cuando la app queda desplegada, el motor ataca el sandbox
 *    de verdad y deja el informe. Con él se publica el attack.plan.
 * 2. Repetición: en control.start / control.next, los pasos reales de una vuln
 *    se publican como attack.* con reloj humano (el ataque real dura segundos).
 * 3. Verificación: en control.verify el motor vuelve a atacar solo esa vuln.
 *    Si sigue explotable lo dice el tráfico real; si el atacante sigue adentro
 *    se decide por el acceso que consiguió y los cambios desplegados después.
 */
@Injectable()
export class EngineHacker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EngineHacker.name);
  private readonly queues = new Map<string, Queue>();
  private readonly polling = new Set<string>();
  /** Llamadas a client.start en vuelo (sim_id, o sim_id:seq de un verify). */
  private readonly starting = new Set<string>();
  private off?: () => void;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly client: EngineClient,
    private readonly store: SimulationStore,
    private readonly timeline: TimelineService,
    private readonly sims: SimulationsService,
    private readonly sandboxes: SandboxesService,
  ) {}

  onModuleInit() {
    this.off = this.timeline.onAppend((e) => this.onEvent(e));
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    this.off?.();
    clearInterval(this.timer);
    for (const q of this.queues.values()) clearTimeout(q.timer);
  }

  get enabled() {
    return this.client.enabled;
  }

  // ------------------------------------------------------------ eventos

  private onEvent(e: TimelineEvent) {
    const s = this.store.get(e.sim_id);
    if (!s?.engine_driven) return;
    try {
      switch (e.type) {
        case 'deploy.ready':
          void this.firstPass(s.sim_id);
          break;
        case 'control.start':
        case 'control.next':
          this.playNext(s.sim_id, str(e.raw?.vuln_id) ?? e.vuln_id ?? undefined);
          break;
        case 'control.pause':
          this.pause(s.sim_id);
          break;
        case 'control.resume':
          this.resume(s.sim_id);
          break;
        case 'control.verify': {
          const vuln = str(e.raw?.vuln_id) ?? e.vuln_id;
          if (vuln) void this.verify(s.sim_id, vuln, e.seq);
          break;
        }
        case 'sim.status':
          if (CLOSED.includes(String(e.raw?.status))) this.drop(s.sim_id);
          break;
      }
    } catch (err) {
      this.logger.error(`[${e.sim_id}] ${e.type}: ${(err as Error).message}`);
    }
  }

  /** Líneas del CLI del motor mientras corre la primera pasada (POST /sim/:id/engine/progress). */
  progress(simId: string, lines: string[]) {
    this.store.update(simId, (r) => {
      if (!r.engine || r.engine.status !== 'running') return;
      r.engine.log = [...r.engine.log, ...lines].slice(-LOG_LINES);
    });
    return { accepted: lines.length };
  }

  /** El developer eligió los incidentes del simulacro (en orden). */
  select(simId: string, vulns: string[]) {
    const s = this.sims.get(simId);
    const confirmed = new Set(
      (s.engine?.findings ?? []).filter((f) => f.confirmed).map((f) => f.vuln_id),
    );
    const unknown = vulns.filter((v) => !confirmed.has(v));
    if (unknown.length)
      throw new ConflictException(
        `El motor no confirmó: ${unknown.join(', ')}`,
      );
    const selected = [...new Set(vulns)];
    this.store.update(simId, (r) => {
      r.engine!.selected = selected;
      // El simulacro cubre solo las elegidas, en ese orden. El cerebro ordena por
      // el campo `order` (planOrder), así que se reescribe además de filtrar.
      const plan = r.attack_plan as { findings?: { vuln_id: string; order?: number }[] };
      if (plan?.findings) {
        plan.findings = selected
          .map((id, i) => {
            const f = plan.findings!.find((x) => x.vuln_id === id);
            return f && { ...f, order: i + 1 };
          })
          .filter((f) => !!f);
      }
    });
  }

  // ------------------------------------------------- 1 · primera pasada

  async firstPass(simId: string) {
    // Sin motor configurado la sim external es de un hacker de afuera (con hacker_token): no se toca.
    if (!this.enabled) return;
    const s = this.sims.get(simId);
    if (s.engine || !s.engine_driven) return;
    const record: EngineRecord = {
      status: 'running',
      started_at: new Date().toISOString(),
      log: ['▶ preparando el contenedor del motor'],
      played: [],
      verifies: [],
    };
    this.store.update(simId, { engine: record });
    this.starting.add(simId);
    try {
      const callId = await this.client.start({
        ...this.baseSpec(s),
        progress: {
          url: `${this.publicUrl()}/sim/${simId}/engine/progress`,
          token: this.token(simId),
        },
      });
      this.store.update(simId, (r) => {
        r.engine!.call_id = callId;
      });
    } catch (err) {
      this.firstPassFailed(simId, (err as Error).message);
    } finally {
      this.starting.delete(simId);
    }
  }

  private firstPassDone(simId: string, result: EngineRunResult) {
    const a = result.artifacts as {
      attack_plan?: { raw?: { findings?: Record<string, unknown>[]; plugin?: string } };
      diagnosis?: {
        summary?: { confirmed: number; total: number; requests: number };
        duration_ms?: number;
      };
      replay?: Record<string, EngineReplayEvent[]>;
      /** Discovery estático del repo (repo-model.json); se reusa en las verificaciones. */
      repo_model?: Record<string, unknown>;
    };
    const raw = a.attack_plan?.raw;
    if (!result.ok || !raw?.findings) {
      const tail = (result.stderr || result.log).trim().split('\n').slice(-3);
      this.firstPassFailed(
        simId,
        `El motor terminó con error (exit ${result.exit_code}): ${tail.join(' · ')}`,
      );
      return;
    }
    const findings = raw.findings.map(toFinding);
    const confirmed = findings.filter((f) => f.confirmed);
    const summary = {
      confirmed: a.diagnosis?.summary?.confirmed ?? confirmed.length,
      total: a.diagnosis?.summary?.total ?? findings.length,
      requests: a.diagnosis?.summary?.requests ?? 0,
      duration_ms: a.diagnosis?.duration_ms ?? 0,
      correlated: confirmed.filter((f) => f.file).length,
    };
    this.store.update(simId, (r) => {
      Object.assign(r.engine!, {
        status: 'done',
        plugin: raw.plugin,
        finished_at: new Date().toISOString(),
        findings,
        summary,
        replay: a.replay ?? {},
        // Para que las verificaciones reusen el discovery (sin re-descubrir el repo).
        repo_model: a.repo_model,
      });
    });
    if (!confirmed.length) {
      this.sims.fail(
        simId,
        `El motor atacó de verdad y no confirmó ninguna vulnerabilidad (0/${findings.length}).`,
      );
      return;
    }
    // El plan con el formato del analizador (file/line) y solo lo confirmado.
    const planFindings = raw.findings
      .filter((f) => f.confirmed)
      .map((f) => {
        const ff = toFinding(f);
        return { ...f, file: ff.file, line: ff.line };
      });
    this.sims.postFromAgent(simId, 'hacker', {
      type: 'attack.plan',
      title: `Plan de ataque: ${summary.confirmed}/${summary.total} vulns confirmadas con tráfico real`,
      body: `Primera pasada del motor real: ${summary.requests} requests en ${(summary.duration_ms / 1000).toFixed(1)} s.`,
      raw: { ...raw, findings: planFindings, engine: summary },
    });
  }

  private firstPassFailed(simId: string, why: string) {
    this.logger.warn(`[${simId}] primera pasada: ${why}`);
    this.store.update(simId, (r) => {
      if (!r.engine) return;
      r.engine.status = 'failed';
      r.engine.error = why;
      r.engine.finished_at = new Date().toISOString();
    });
    this.sims.fail(simId, `El motor no pudo atacar la app: ${why}`);
  }

  // ------------------------------------------------------- 2 · repetición

  playNext(simId: string, vulnId?: string) {
    const s = this.sims.get(simId);
    const e = s.engine;
    if (!e || e.status !== 'done' || !e.replay) return;
    const order = e.selected?.length
      ? e.selected
      : (e.findings ?? [])
          .filter((f) => f.confirmed)
          .sort((a, b) => a.order - b.order)
          .map((f) => f.vuln_id);
    const vuln = vulnId ?? order.find((v) => !e.played.includes(v));
    if (!vuln || !e.replay[vuln]?.length) return;
    if (e.selected?.length && !e.selected.includes(vuln)) return;
    this.store.update(simId, (r) => {
      if (!r.engine!.played.includes(vuln)) r.engine!.played.push(vuln);
      r.engine!.current = vuln;
    });
    this.enqueue(simId, vuln, e.replay[vuln]);
  }

  private enqueue(simId: string, vuln: string, events: EngineReplayEvent[]) {
    const prev = this.queues.get(simId);
    if (prev) clearTimeout(prev.timer);
    const q: Queue = { vuln, events: [...events], paused: false };
    this.queues.set(simId, q);
    this.schedule(simId, q, FIRST_STEP_MS);
  }

  private schedule(simId: string, q: Queue, ms: number) {
    clearTimeout(q.timer);
    q.timer = setTimeout(() => this.step(simId, q), ms);
    q.timer.unref?.();
  }

  private step(simId: string, q: Queue) {
    if (q.paused || this.queues.get(simId) !== q) return;
    const s = this.store.get(simId);
    if (!s || CLOSED.includes(s.status)) return this.drop(simId);
    const ev = q.events.shift();
    if (!ev) {
      this.queues.delete(simId);
      return;
    }
    this.sims.postFromAgent(simId, 'hacker', {
      type: ev.type,
      vuln_id: ev.vuln_id,
      severity: ev.severity,
      title: ev.title,
      body: ev.body,
      raw: { ...ev.raw, replay: true },
    });
    if (q.events.length) this.schedule(simId, q, this.stepMs());
    else this.queues.delete(simId);
  }

  private stepMs() {
    const base = this.config.get('ENGINE_REPLAY_STEP_SECONDS', { infer: true }) * 1000;
    return Math.round(base * (0.7 + Math.random() * 0.6));
  }

  private pause(simId: string) {
    const q = this.queues.get(simId);
    if (!q) return;
    q.paused = true;
    clearTimeout(q.timer);
  }

  private resume(simId: string) {
    const q = this.queues.get(simId);
    if (!q) return;
    q.paused = false;
    this.schedule(simId, q, FIRST_STEP_MS);
  }

  private drop(simId: string) {
    const q = this.queues.get(simId);
    if (q) clearTimeout(q.timer);
    this.queues.delete(simId);
  }

  /** Tras un reinicio del backend: retoma la vuln en curso desde el paso donde quedó. */
  private recoverQueue(s: SimulationRecord) {
    const e = s.engine;
    if (!e?.current || !e.replay || this.queues.has(s.sim_id)) return;
    if (!['running'].includes(s.status)) return;
    const posted = s.timeline.filter(
      (x) => x.actor === 'hacker' && x.vuln_id === e.current && x.type.startsWith('attack.') && x.type !== 'attack.verify',
    ).length;
    const rest = (e.replay[e.current] ?? []).slice(posted);
    if (rest.length) this.enqueue(s.sim_id, e.current, rest);
  }

  // ----------------------------------------------------- 3 · verificación

  async verify(simId: string, vuln: string, seq: number) {
    const s = this.sims.get(simId);
    if (!s.engine || s.engine.status !== 'done') return;
    const v = {
      vuln_id: vuln,
      seq,
      requested_at: new Date().toISOString(),
      status: 'running' as const,
    };
    this.store.update(simId, (r) => {
      r.engine!.verifies.push(v);
    });
    this.starting.add(`${simId}:${seq}`);
    try {
      const callId = await this.client.start({
        ...this.baseSpec(s),
        // El mismo catálogo de la primera pasada (con auto, sin esto podría elegir otro).
        ...(s.engine.plugin ? { plugin: s.engine.plugin } : {}),
        only: [vuln],
        no_recon: true,
        seed: `${simId}-verify-${seq}`,
        // Verify liviano: reusa el discovery de la primera pasada y no corre SAST,
        // para atacar una sola vuln sin re-descubrir todo el repo.
        ...this.liteVerifySpec(s.engine),
      });
      this.store.update(simId, (r) => {
        const x = r.engine!.verifies.find((y) => y.seq === seq);
        if (x) x.call_id = callId;
      });
    } catch (err) {
      this.verifyDone(simId, seq, null, (err as Error).message);
    } finally {
      this.starting.delete(`${simId}:${seq}`);
    }
  }

  private verifyDone(
    simId: string,
    seq: number,
    result: EngineRunResult | null,
    error?: string,
  ) {
    const s = this.sims.get(simId);
    const v = s.engine?.verifies.find((x) => x.seq === seq);
    if (!v || v.status !== 'running') return;
    const diagnoses = (result?.artifacts?.diagnoses ?? []) as {
      vuln_id: string;
      verdict: string;
      impact?: string;
    }[];
    const d = diagnoses.find((x) => x.vuln_id === v.vuln_id);
    // Solo un veredicto claro cuenta como verificación en vivo; "inconclusive"
    // (sin login, timeout, etc.) no prueba que la defensa resistió.
    const live = Boolean(result?.ok && d && d.verdict !== 'inconclusive');
    // Sin verificación en vivo se asume lo peor: mejor que el developer siga buscando.
    const stillExploitable = live ? d!.verdict === 'confirmed' : true;
    const judged = attackerStillInside(s, v.vuln_id, stillExploitable);
    this.store.update(simId, (r) => {
      const x = r.engine!.verifies.find((y) => y.seq === seq)!;
      x.status = live ? 'done' : 'failed';
      if (!live) x.error = error ?? result?.stderr?.slice(-300) ?? 'sin resultado';
    });
    this.sims.postFromAgent(simId, 'hacker', {
      type: 'attack.verify',
      vuln_id: v.vuln_id,
      severity: 'info',
      title: live
        ? stillExploitable
          ? `Sigue explotable: ${v.vuln_id}`
          : `Ya no es explotable: ${v.vuln_id}`
        : `No se pudo verificar en vivo: ${v.vuln_id}`,
      body: judged.reason,
      raw: {
        vuln_id: v.vuln_id,
        still_exploitable: stillExploitable,
        attacker_active: judged.active,
        footholds: judged.footholds,
        reason: live
          ? `${stillExploitable ? 'El motor volvió a explotarla con tráfico real' : 'El motor volvió a atacar y la defensa resistió'}. ${judged.reason}`
          : `No se pudo verificar con tráfico real (${error ?? 'error del motor'}). ${judged.reason}`,
        verified_live: live,
        evidence: d?.impact ?? null,
      },
    });
  }

  // ------------------------------------------------------------ sondeo

  private async tick() {
    for (const s of this.store.list()) {
      if (!s.engine_driven || CLOSED.includes(s.status)) continue;
      // App ya desplegada sin primera pasada (p. ej. el backend se reinició justo antes).
      if (!s.engine) {
        if (s.deploy_ready_at && s.status === 'starting' && this.enabled) void this.firstPass(s.sim_id);
        continue;
      }
      this.recoverQueue(s);
      const e = s.engine;
      if (e.status === 'running') {
        if (!e.call_id && stale(e.started_at, START_GRACE_MS) && !this.starting.has(s.sim_id))
          this.firstPassFailed(s.sim_id, 'el motor no alcanzó a arrancar (el backend se reinició)');
        else if (stale(e.started_at, RUN_MAX_MS))
          this.firstPassFailed(s.sim_id, 'el motor no respondió a tiempo');
      }
      for (const v of e.verifies.filter((x) => x.status === 'running')) {
        if (!v.call_id && stale(v.requested_at, START_GRACE_MS) && !this.starting.has(`${s.sim_id}:${v.seq}`))
          this.verifyDone(s.sim_id, v.seq, null, 'el motor no alcanzó a arrancar (el backend se reinició)');
        else if (stale(v.requested_at, RUN_MAX_MS))
          this.verifyDone(s.sim_id, v.seq, null, 'el motor no respondió a tiempo');
      }
      // Releer: lo de arriba pudo cerrar la sim o terminar corridas.
      const now = this.store.get(s.sim_id);
      if (!now?.engine || CLOSED.includes(now.status)) continue;
      const fresh = now.engine;
      if (fresh.status === 'running' && fresh.call_id) await this.poll(s.sim_id, fresh.call_id, (st) => {
        if (st.status === 'done') this.firstPassDone(s.sim_id, st.result);
        else this.firstPassFailed(s.sim_id, st.error);
      });
      for (const v of fresh.verifies.filter((x) => x.status === 'running' && x.call_id)) {
        await this.poll(s.sim_id, v.call_id!, (st) =>
          st.status === 'done'
            ? this.verifyDone(s.sim_id, v.seq, st.result)
            : this.verifyDone(s.sim_id, v.seq, null, st.error),
        );
      }
    }
  }

  private async poll(
    simId: string,
    callId: string,
    onFinish: (
      st: { status: 'done'; result: EngineRunResult } | { status: 'failed'; error: string },
    ) => void,
  ) {
    if (this.polling.has(callId)) return;
    this.polling.add(callId);
    try {
      const st = await this.client.status(callId);
      if (st.status !== 'running') onFinish(st);
    } catch (err) {
      this.logger.warn(`[${simId}] sondeo ${callId}: ${(err as Error).message}`);
    } finally {
      this.polling.delete(callId);
    }
  }

  // ------------------------------------------------------------ internos

  private baseSpec(s: SimulationRecord) {
    const sbx = this.sandboxes.get(s.sandbox_id);
    const url = sbx.render?.url;
    if (!url) throw new Error('El sandbox no tiene URL desplegada');
    const users = (sbx.manifest?.seed_users ?? []) as {
      email?: string;
      password?: string;
      role?: string;
    }[];
    const weak = users.find((u) => u.email && u.password && u.role !== 'admin') ?? users.find((u) => u.email && u.password);
    // El código que está desplegado: el mirror (deploy_repo_url) en el commit actual
    // del sandbox (sandbox_commit es un sha del mirror; no existe en el repo original).
    // En una verificación es el commit con el arreglo del developer.
    const repo = sbx.deploy_repo_url ?? s.repo_url;
    const https = repo.startsWith('https://');
    return {
      url,
      repo: https ? repo : undefined,
      commit: https ? (s.sandbox_commit ?? sbx.commit_sha) : undefined,
      plugin: this.config.get('ENGINE_PLUGIN', { infer: true }),
      profile: 'fast',
      seed: s.sim_id,
      ...(weak ? { weak_login: { email: weak.email, password: weak.password } } : {}),
    };
  }

  /**
   * Hace liviana una verificación reusando lo que ya calculó la primera pasada:
   * pasa su RepoModel (el motor salta el discovery estático) y apaga el SAST.
   * Para los plugins propios (apuntes/tasks) tampoco hace falta re-clonar: el
   * ataque de una sola vuln sale del modelo, así que se omite el repo. El plugin
   * genérico sí lee secretos del código, por eso ahí se mantiene el clon.
   * Sin RepoModel guardado (p. ej. primera pasada sin repo) devuelve {} y la
   * verificación corre como antes.
   */
  private liteVerifySpec(engine: EngineRecord): Record<string, unknown> {
    if (!engine.repo_model) return {};
    const dropRepo = engine.plugin && engine.plugin !== 'generic';
    return {
      repo_model: engine.repo_model,
      semgrep: false,
      ...(dropRepo ? { repo: undefined, commit: undefined } : {}),
    };
  }

  private token(simId: string) {
    return signSimToken(this.config.get('AGENT_API_SECRET', { infer: true })!, simId);
  }

  private publicUrl() {
    return this.config.get('PUBLIC_BACKEND_URL', { infer: true })!.replace(/\/+$/, '');
  }
}

// ------------------------------------------------------------ puras

/** Una corrida sin call_id tras este tiempo quedó huérfana (reinicio entre persistir y lanzar). */
const START_GRACE_MS = 2 * 60_000;
/** Tope de una corrida en Modal (RUN_TIMEOUT_S = 30 min) más margen para sondeos fallidos. */
const RUN_MAX_MS = 40 * 60_000;
function stale(iso: string, ms: number) {
  return Date.now() - Date.parse(iso) > ms;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function toFinding(f: Record<string, unknown>): EngineFinding {
  const ref = f.repo_ref as { file?: string; line?: number } | undefined;
  const loc = typeof f.location === 'string' ? f.location.match(/^([^\s:]+):(\d+)/) : null;
  return {
    vuln_id: String(f.vuln_id),
    title: typeof f.title === 'string' ? f.title : String(f.vuln_id),
    severity: typeof f.severity === 'string' ? f.severity : 'medium',
    order: Number(f.order ?? 99),
    confirmed: Boolean(f.confirmed),
    file: ref?.file ?? loc?.[1],
    line: ref?.line ?? (loc ? Number(loc[2]) : undefined),
    real_case: typeof f.real_case === 'string' ? f.real_case : undefined,
  };
}

/**
 * ¿El atacante sigue adentro por esta vuln? El tráfico real dice si la vuln
 * sigue explotable; si el acceso que ya consiguió sigue sirviendo depende de
 * qué acceso era y de qué se desplegó después del ataque.
 */
export function attackerStillInside(
  s: SimulationRecord,
  vuln: string,
  stillExploitable: boolean,
): { active: boolean; reason: string; footholds: { foothold: string; valid: boolean; why: string }[] } {
  const replay = s.engine?.replay?.[vuln] ?? [];
  const success = replay.find((e) => e.type === 'attack.success');
  const foothold = (success?.raw?.foothold ?? null) as { type?: string; detail?: string } | null;
  const kind = foothold?.type;
  const attackSeq =
    s.timeline.find((e) => e.actor === 'hacker' && e.vuln_id === vuln && e.type.startsWith('attack.'))?.seq ?? 0;
  const after = s.timeline.filter((e) => e.seq > attackSeq);
  const deployedAfter = (seq: number) =>
    after.some((e) => e.seq > seq && e.type === 'change.deployed');
  const jwtRotation = after.find(
    (e) =>
      e.type === 'change.env' &&
      ((e.raw?.keys as string[] | undefined) ?? []).includes('JWT_SECRET') &&
      deployedAfter(e.seq),
  );
  const dbChange = after.some((e) => e.type === 'change.db');

  if (!kind || kind === 'data' || kind === 'db') {
    return {
      active: false,
      reason: stillExploitable
        ? 'No dejó un acceso persistente, pero puede volver a entrar por la misma vuln.'
        : 'No dejó un acceso persistente y la vuln ya no responde.',
      footholds: [],
    };
  }
  if (kind === 'jwt' || kind === 'account') {
    const valid = !jwtRotation;
    const active = valid || stillExploitable;
    return {
      active,
      reason: valid
        ? 'Su token sigue siendo válido: solo rotar JWT_SECRET (y desplegar) invalida los tokens ya emitidos.'
        : active
          ? kind === 'account'
            ? 'Rotaste JWT_SECRET y su token murió, pero la contraseña débil sigue sirviendo para volver a entrar.'
            : 'Rotaste JWT_SECRET y su token murió, pero puede robar uno nuevo por la misma vuln.'
          : 'Rotaste JWT_SECRET y se desplegó: el token robado ya no sirve.',
      footholds: [
        {
          foothold: foothold?.detail ?? 'token de sesión robado',
          valid,
          why: valid ? 'JWT_SECRET no se rotó desde el ataque' : 'JWT_SECRET rotado y desplegado',
        },
      ],
    };
  }
  // admin: el rol vive en la base; se corta revirtiéndolo o invalidando las sesiones.
  const valid = !(dbChange || jwtRotation);
  return {
    active: stillExploitable || valid,
    reason: valid
      ? 'Su cuenta sigue con rol de admin: hay que revertirlo en la base y cerrar sus sesiones.'
      : stillExploitable
        ? 'Revertiste el acceso, pero puede volver a escalar por la misma vuln.'
        : 'Se revirtió su acceso y la vuln ya no responde.',
    footholds: [
      { foothold: foothold?.detail ?? 'cuenta con rol admin', valid, why: valid ? 'sin cambios en la base ni rotación de JWT_SECRET' : 'acceso revertido' },
    ],
  };
}
