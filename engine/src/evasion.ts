/**
 * Perfiles de agresividad / evasión (emulación de adversario).
 *
 * El tráfico se parece al de un atacante real: identidades que rotan, jitter
 * temporal y concurrencia. Da escenarios de DIFICULTAD VARIABLE: "noisy" deja
 * rastros obvios (fácil de detectar) y "stealth" se mezcla (difícil). La
 * aleatoriedad usa el RNG seeded (rng.ts) para que sea reproducible con --seed.
 *
 * Límite ético/de producto: es emulación de adversario (timing, identidades,
 * ritmo). NO hace anti-forense ni manipula/borra logs del target.
 */
import { pick, randInt, type RNG } from './rng.ts';

export type ProfileName = 'noisy' | 'normal' | 'fast' | 'stealth';

export interface EvasionProfile {
  name: ProfileName;
  concurrency: number;
  minDelayMs: number;
  maxDelayMs: number;
  rotateIdentity: 'never' | 'per-attack' | 'per-request';
  shuffle: boolean;
}

export const PROFILES: Record<ProfileName, EvasionProfile> = {
  noisy: { name: 'noisy', concurrency: 1, minDelayMs: 0, maxDelayMs: 0, rotateIdentity: 'never', shuffle: false },
  normal: { name: 'normal', concurrency: 2, minDelayMs: 40, maxDelayMs: 180, rotateIdentity: 'per-attack', shuffle: true },
  fast: { name: 'fast', concurrency: 6, minDelayMs: 0, maxDelayMs: 0, rotateIdentity: 'per-attack', shuffle: true },
  stealth: { name: 'stealth', concurrency: 2, minDelayMs: 250, maxDelayMs: 1200, rotateIdentity: 'per-request', shuffle: true },
};

export interface Identity {
  ip: string;
  userAgent: string;
}

// User-Agents de navegadores reales comunes, para mimetizarse.
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
];

// Rangos de documentación (RFC 5737): no direccionan a nadie real.
const IP_BLOCKS = ['203.0.113', '198.51.100', '192.0.2'];

export function randomIdentity(rng: RNG): Identity {
  const b = pick(rng, IP_BLOCKS);
  return { ip: `${b}.${1 + randInt(rng, 253)}`, userAgent: pick(rng, UA_POOL) };
}

export function jitterMs(profile: EvasionProfile, rng: RNG): number {
  if (profile.maxDelayMs <= 0) return 0;
  return Math.floor(profile.minDelayMs + rng() * (profile.maxDelayMs - profile.minDelayMs));
}

/** Ejecuta tareas con un límite de concurrencia. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
