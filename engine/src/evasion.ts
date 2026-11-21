/**
 * Perfiles de agresividad / evasión (emulación de adversario).
 *
 * El objetivo es que el motor sea rápido, variable y que su tráfico se parezca
 * al de un atacante real: identidades que rotan, jitter temporal y concurrencia.
 * Esto da escenarios de DIFICULTAD VARIABLE para el simulador: "noisy" deja
 * rastros obvios (fácil de detectar) y "stealth" se mezcla con el tráfico normal
 * (difícil de detectar), que es justo lo que enseña a los defensores.
 *
 * Límite ético/de producto: esto es emulación de adversario (timing, identidades,
 * ritmo). NO hace anti-forense ni manipula/borra logs del target: eso sería
 * malicioso y además destruiría la telemetría que ES el producto.
 */

export type ProfileName = 'noisy' | 'normal' | 'fast' | 'stealth';

export interface EvasionProfile {
  name: ProfileName;
  /** Ataques en paralelo. */
  concurrency: number;
  /** Jitter entre requests (ms). */
  minDelayMs: number;
  maxDelayMs: number;
  /** Rotar IP/User-Agent: nunca, por ataque, o por request. */
  rotateIdentity: 'never' | 'per-attack' | 'per-request';
  /** Barajar el orden de ejecución para variar la huella. */
  shuffle: boolean;
}

export const PROFILES: Record<ProfileName, EvasionProfile> = {
  // Ruidoso: ráfagas desde una sola identidad, sin pausa. Fácil de detectar.
  noisy: { name: 'noisy', concurrency: 1, minDelayMs: 0, maxDelayMs: 0, rotateIdentity: 'never', shuffle: false },
  // Normal: una identidad, algo de concurrencia y jitter leve.
  normal: { name: 'normal', concurrency: 2, minDelayMs: 40, maxDelayMs: 180, rotateIdentity: 'per-attack', shuffle: true },
  // Rápido: máxima concurrencia, sin pausas. Agresivo.
  fast: { name: 'fast', concurrency: 6, minDelayMs: 0, maxDelayMs: 0, rotateIdentity: 'per-attack', shuffle: true },
  // Sigiloso: identidad por request, jitter alto, poca concurrencia. Se mezcla.
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

function randIp(): string {
  // Rangos de documentación (RFC 5737): no direccionan a nadie real.
  const blocks = ['203.0.113', '198.51.100', '192.0.2'];
  const b = blocks[Math.floor(Math.random() * blocks.length)];
  return `${b}.${1 + Math.floor(Math.random() * 253)}`;
}

export function randomIdentity(): Identity {
  return { ip: randIp(), userAgent: UA_POOL[Math.floor(Math.random() * UA_POOL.length)] };
}

export function jitter(profile: EvasionProfile): Promise<void> {
  if (profile.maxDelayMs <= 0) return Promise.resolve();
  const d = profile.minDelayMs + Math.random() * (profile.maxDelayMs - profile.minDelayMs);
  return new Promise((r) => setTimeout(r, d));
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
