/**
 * Orquesta la pasada de diagnóstico: corre cada ataque real contra el target,
 * captura el paso a paso y arma el resultado. Soporta perfiles de evasión,
 * determinismo por --seed (RNG por-ataque derivado de seed+vuln_id, estable aun
 * con concurrencia), modo read-only y teardown robusto con reporte de residuo.
 * No ataca nada fuera del target autorizado (scope guard en el cliente HTTP).
 */
import { PROFILES, randomIdentity, type ProfileName } from './evasion.ts';
import { pool } from './evasion.ts';
import { RecordingClient } from './http.ts';
import { makeRng, realClock, shuffle, type Clock } from './rng.ts';
import { planSchedule, type SchedulePlan } from './scheduler.ts';
import { ResourceTracker } from './tracker.ts';
import type { Attack, AttackContext, AttackResult, EnginePlugin, HttpExchange, TargetConfig } from './types.ts';

export interface DiagnosisResult {
  target: TargetConfig;
  profile: string;
  seed: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  results: AttackResult[];
  telemetry: HttpExchange[];
  /** Plan del scheduler: lanes y por qué cada táctica fue paralela o secuencial. */
  schedule: SchedulePlan;
  /** Recursos que no se pudieron limpiar (para decidir el reset). */
  residue: string[];
  summary: {
    total: number;
    confirmed: number;
    blocked: number;
    errored: number;
    attacker_active: boolean;
    requests: number;
  };
}

export interface DiagnoseOpts {
  log?: (m: string) => void;
  only?: string[];
  profile?: ProfileName;
  seed?: string;
  clock?: Clock;
}

export async function diagnose(target: TargetConfig, plugin: EnginePlugin, opts: DiagnoseOpts = {}): Promise<DiagnosisResult> {
  const log = opts.log ?? (() => {});
  const profile = PROFILES[opts.profile ?? 'fast'];
  const seed = opts.seed ?? 'default';
  const clock = opts.clock ?? realClock;
  const tracker = new ResourceTracker();

  const started = clock.now();
  const started_at = clock.iso();

  // Siempre en modo agresivo: corren todos los módulos, también los mutantes y los
  // destructivos (DoS, SSRF…). El motor solo ataca contenedores desechables.
  let toRun: Attack[] = opts.only ? plugin.attacks.filter((a) => opts.only!.includes(a.meta.id)) : plugin.attacks;
  if (profile.shuffle) toRun = shuffle(makeRng(`${seed}:order`), toRun);

  log(`perfil: ${profile.name} · seed: ${seed} · agresivo (concurrencia ${profile.concurrency}, jitter ${profile.minDelayMs}-${profile.maxDelayMs}ms, identidad ${profile.rotateIdentity})`);

  // Scheduler (B): construye lanes (paralelo por defecto, secuencia por
  // dependencia/baseline/mutex). Lane por lane; paralelo dentro de cada lane.
  const schedule = planSchedule(toRun);
  log(`scheduler: ${schedule.lanes.length} lane(s) — ${schedule.lanes.map((l) => `[${l.attackIds.join(',')}]`).join(' → ')}`);

  const clients: RecordingClient[] = [];
  const resultsById = new Map<string, AttackResult>();

  async function runOne(attack: Attack): Promise<AttackResult> {
    // RNG por-ataque: determinista e independiente del orden/concurrencia.
    const rng = makeRng(`${seed}:${attack.meta.id}`);
    const identity = randomIdentity(rng);
    const http = new RecordingClient(target.url, identity, { profile, rng, clock });
    clients.push(http);
    const ctx: AttackContext = { target, http, attacker: identity, rng, clock, tracker, log };

    log(`▶ ${attack.meta.id}${attack.mutating ? ' (mutante)' : ' (read-only)'} — ${attack.meta.title}`);
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
  }

  try {
    const byId = new Map(toRun.map((a) => [a.meta.id, a]));
    for (const lane of schedule.lanes) {
      const laneAttacks = lane.attackIds.map((id) => byId.get(id)!);
      const laneResults = await pool(laneAttacks, profile.concurrency, runOne);
      laneAttacks.forEach((a, i) => resultsById.set(a.meta.id, laneResults[i]));
    }
  } finally {
    // Teardown robusto: corre aunque algún ataque haya lanzado.
    if (tracker.items.length) log(`▶ teardown: ${tracker.items.length} recurso(s)`);
  }

  const results: AttackResult[] = toRun.map((a) => resultsById.get(a.meta.id)!).filter(Boolean);

  const residue = await tracker.teardown(log);

  const finished_at = clock.iso();
  const telemetry = clients.flatMap((c) => c.exchanges).sort((a, b) => a.at.localeCompare(b.at));

  return {
    target,
    profile: profile.name,
    seed,
    started_at,
    finished_at,
    duration_ms: clock.now() - started,
    results,
    telemetry,
    schedule,
    residue,
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
