/**
 * Orquesta la pasada de diagnóstico: corre cada ataque real contra el target,
 * captura el paso a paso y arma el resultado completo. Soporta perfiles de
 * agresividad/evasión (concurrencia, jitter, rotación de identidad). No ataca
 * nada fuera del target autorizado.
 */
import { ATTACKS } from './attacks/index.ts';
import { PROFILES, pool, randomIdentity, shuffle, type ProfileName } from './evasion.ts';
import { RecordingClient } from './http.ts';
import type { Attack, AttackContext, AttackResult, HttpExchange, TargetConfig } from './types.ts';

export interface DiagnosisResult {
  target: TargetConfig;
  profile: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  results: AttackResult[];
  /** Toda la telemetría capturada, en orden temporal. */
  telemetry: HttpExchange[];
  summary: {
    total: number;
    confirmed: number;
    blocked: number;
    errored: number;
    attacker_active: boolean;
    requests: number;
  };
}

export async function diagnose(
  target: TargetConfig,
  opts: { log?: (m: string) => void; only?: string[]; profile?: ProfileName } = {},
): Promise<DiagnosisResult> {
  const log = opts.log ?? (() => {});
  const profile = PROFILES[opts.profile ?? 'fast'];

  const started = Date.now();
  const started_at = new Date().toISOString();

  let toRun: Attack[] = opts.only ? ATTACKS.filter((a) => opts.only!.includes(a.meta.id)) : ATTACKS;
  if (profile.shuffle) toRun = shuffle(toRun);

  log(`perfil: ${profile.name} (concurrencia ${profile.concurrency}, jitter ${profile.minDelayMs}-${profile.maxDelayMs}ms, identidad ${profile.rotateIdentity})`);

  const clients: RecordingClient[] = [];

  const results = await pool(toRun, profile.concurrency, async (attack) => {
    // Cada ataque usa su propia identidad base (rota por request si es stealth).
    const identity = randomIdentity();
    const http = new RecordingClient(target.url, identity, profile);
    clients.push(http);
    const ctx: AttackContext = { target, http, attacker: identity, log };

    log(`▶ ${attack.meta.id} — ${attack.meta.title}`);
    try {
      const r = await attack.run(ctx);
      const tag = r.confirmed ? 'CONFIRMADO' : r.blocked ? 'bloqueado' : r.error ? 'ERROR' : 'no confirmado';
      log(`  → [${attack.meta.id}] ${tag}: ${r.summary}`);
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`  → [${attack.meta.id}] ERROR de ejecución: ${msg}`);
      return {
        vuln_id: attack.meta.id,
        confirmed: false,
        blocked: false,
        steps: [],
        gained: [],
        attacker_active: false,
        summary: `No se pudo ejecutar el ataque: ${msg}`,
        error: msg,
      } satisfies AttackResult;
    }
  });

  const finished_at = new Date().toISOString();
  const telemetry = clients
    .flatMap((c) => c.exchanges)
    .sort((a, b) => a.at.localeCompare(b.at));

  return {
    target,
    profile: profile.name,
    started_at,
    finished_at,
    duration_ms: Date.now() - started,
    results,
    telemetry,
    summary: {
      total: results.length,
      confirmed: results.filter((r) => r.confirmed).length,
      blocked: results.filter((r) => r.blocked && !r.confirmed).length,
      errored: results.filter((r) => r.error).length,
      attacker_active: results.some((r) => r.attacker_active),
      requests: telemetry.length,
    },
  };
}
