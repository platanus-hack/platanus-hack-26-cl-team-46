import type {
  BenchmarkMetric,
  BenchmarkView,
  ResultSkills,
  SimulationResult,
} from './report.types.js';

/**
 * Benchmark: cómo te fue contra las demás corridas. Pura, sin Nest: recibe tu
 * resultado y los de las otras simulaciones (ya filtrados) y devuelve solo agregados.
 * Nunca sale un repo, un usuario ni un reporte ajeno: solo medianas y percentiles.
 */

/** Con menos corridas que esto no se compara (un percentil sobre 2 corridas no dice nada). */
export const MIN_SAMPLE = 3;

export interface BenchmarkRun {
  result: SimulationResult;
  /** Dueño (solo para contar developers distintos; nunca sale). */
  owner?: string;
}

const SKILL_KEYS: (keyof ResultSkills)[] = [
  'contencion',
  'reaccion',
  'precision',
  'protocolo',
  'integridad',
];

export function scoreOf(r: SimulationResult): number {
  const v = Object.values(r.skills);
  return Math.round(v.reduce((a, b) => a + b, 0) / v.length);
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** % de corridas a las que les ganaste (los empates cuentan la mitad). */
export function percentile(
  you: number,
  others: number[],
  better: 'higher' | 'lower',
): number {
  let beat = 0;
  for (const o of others) {
    if (o === you) beat += 0.5;
    else if (better === 'higher' ? you > o : you < o) beat += 1;
  }
  return Math.round((beat / others.length) * 100);
}

function metric(
  you: number,
  others: number[],
  better: 'higher' | 'lower',
): BenchmarkMetric {
  const enough = others.length >= MIN_SAMPLE;
  return {
    you,
    median: enough ? median(others) : null,
    percentile: enough ? percentile(you, others, better) : null,
    runs: others.length,
    better,
  };
}

/** Una corrida es comparable si el ataque alcanzó a jugar algo. */
export function comparable(r: SimulationResult): boolean {
  return r.vectors.length > 0 && r.hud.time > 0;
}

export function computeBenchmark(
  you: SimulationResult,
  runs: BenchmarkRun[],
): BenchmarkView {
  const others = runs.filter((r) => comparable(r.result));
  const results = others.map((r) => r.result);
  const enough = results.length >= MIN_SAMPLE;

  const skills = enough
    ? (Object.fromEntries(
        SKILL_KEYS.map((k) => [k, median(results.map((r) => r.skills[k]))]),
      ) as unknown as ResultSkills)
    : null;

  return {
    runs: results.length,
    devs: new Set(others.map((r) => r.owner).filter(Boolean)).size,
    min_sample: MIN_SAMPLE,
    overall: {
      score: metric(scoreOf(you), results.map(scoreOf), 'higher'),
      time: metric(
        you.hud.time,
        results.map((r) => r.hud.time),
        'lower',
      ),
      steps: metric(
        you.hud.steps,
        results.map((r) => r.hud.steps),
        'lower',
      ),
      contained_rate: enough
        ? Math.round(
            (results.filter((r) => r.verdict === 'contenido').length /
              results.length) *
              100,
          )
        : null,
    },
    skills,
    // Por vector: solo contra las corridas que enfrentaron ese mismo vector.
    vectors: you.vectors.map((v) => ({
      id: v.id,
      name: v.name,
      family: v.family,
      score: metric(
        v.score,
        results.flatMap((r) =>
          r.vectors.filter((x) => x.id === v.id).map((x) => x.score),
        ),
        'higher',
      ),
    })),
  };
}
