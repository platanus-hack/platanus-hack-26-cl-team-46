/**
 * PRNG determinista (seeded) e inyección de reloj.
 *
 * Toda la aleatoriedad controlable del motor (orden de ataques, identidades
 * IP/UA, nombres de cuentas desechables, jitter) pasa por aquí para que una
 * corrida sea reproducible dado un `--seed`. Lo que NO es reproducible y no debe
 * serlo: las respuestas del servidor y los timestamps reales de observación
 * (son evidencia, no se falsifican). Con concurrencia > 1 el intercalado de la
 * telemetría tampoco es determinista; el escenario generado sí lo es porque se
 * indexa por vuln y se ordena.
 */

export type RNG = () => number; // [0, 1)

/** Hash de string a entero 32-bit (cyrb-ish) para derivar la semilla. */
function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32: PRNG pequeño y de buena distribución. */
export function makeRng(seed: string | number): RNG {
  let s = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: RNG, n: number): number {
  return Math.floor(rng() * n);
}

export function pick<T>(rng: RNG, arr: readonly T[]): T {
  return arr[randInt(rng, arr.length)];
}

/** Cadena hex reproducible de n chars. */
export function hex(rng: RNG, n = 6): string {
  let out = '';
  while (out.length < n) out += Math.floor(rng() * 0x10000).toString(16).padStart(4, '0');
  return out.slice(0, n);
}

/** Fisher-Yates con RNG inyectado. */
export function shuffle<T>(rng: RNG, arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Reloj inyectable: real por defecto. */
export interface Clock {
  now(): number;
  iso(): string;
}

export const realClock: Clock = {
  now: () => Date.now(),
  iso: () => new Date().toISOString(),
};
