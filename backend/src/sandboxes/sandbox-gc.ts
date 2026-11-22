import type { SandboxRecord } from './sandbox.types.js';

/** Uso de un sandbox desde las simulaciones (lo informa SimulationsService). */
export interface SandboxUsage {
  /** Tiene una simulación en curso (starting/ready/running/paused). */
  activeSimulation: boolean;
  /** Última acción del usuario en sus simulaciones (crearla, mensajes, acciones). */
  lastUserActivity?: string;
}

export interface CleanupOptions {
  idleTtlMs: number;
  failedTtlMs: number;
  duplicateGraceMs: number;
}

export interface CleanupCandidate {
  sandbox_id: string;
  reason: string;
}

/** Estados en que el backend o el agente están trabajando: nunca se limpian. */
const WORKING = new Set([
  'provisioning',
  'analyzing',
  'needs_input',
  'deploying',
]);

/** Sandboxes que todavía ocupan cupo (los fallidos se limpian solos en poco tiempo). */
export function isLive(s: SandboxRecord): boolean {
  return s.status !== 'deleted' && s.status !== 'failed';
}

/**
 * Última actividad *del usuario*: creación, acciones sobre el sandbox y
 * acciones en sus simulaciones. No usa updated_at, que el backend mueve solo
 * (heartbeats, simulaciones en curso).
 */
export function activityAt(s: SandboxRecord, usage: SandboxUsage): number {
  return Math.max(
    Date.parse(s.created_at) || 0,
    s.last_activity_at ? Date.parse(s.last_activity_at) : 0,
    usage.lastUserActivity ? Date.parse(usage.lastUserActivity) : 0,
  );
}

/** ¿Se puede borrar sin afectar a nadie? */
export function isProtected(
  s: SandboxRecord,
  usage: SandboxUsage,
  busy: boolean,
  now: number,
  opts: CleanupOptions,
): boolean {
  if (busy || WORKING.has(s.status)) return true;
  // Simulación en curso con el usuario activo: se respeta. Si la abandonó, ya no.
  return usage.activeSimulation && now - activityAt(s, usage) < opts.idleTtlMs;
}

/**
 * Qué sandboxes borrar: inactivos por más del TTL, fallidos viejos y copias
 * repetidas del mismo repo y dueño (se queda la más reciente, preferentemente
 * la que está arriba).
 */
export function planCleanup(
  records: SandboxRecord[],
  usageOf: (id: string) => SandboxUsage,
  busyOf: (id: string) => boolean,
  now: number,
  opts: CleanupOptions,
): CleanupCandidate[] {
  const alive = records.filter((s) => s.status !== 'deleted');
  const out = new Map<string, string>();
  const idle = (s: SandboxRecord) => now - activityAt(s, usageOf(s.sandbox_id));
  const free = (s: SandboxRecord) =>
    !isProtected(s, usageOf(s.sandbox_id), busyOf(s.sandbox_id), now, opts);

  for (const s of alive) {
    if (!free(s)) continue;
    if (s.status === 'failed' && idle(s) > opts.failedTtlMs) {
      out.set(s.sandbox_id, `falló hace más de ${hours(opts.failedTtlMs)}`);
    } else if (idle(s) > opts.idleTtlMs) {
      out.set(s.sandbox_id, `sin uso hace más de ${hours(opts.idleTtlMs)}`);
    }
  }

  const groups = new Map<string, SandboxRecord[]>();
  for (const s of alive) {
    const key = `${s.owner?.github_id ?? '-'}|${s.repo_url}|${s.ref ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const byRecent = [...group].sort(
      (a, b) =>
        Number(b.status === 'ready') - Number(a.status === 'ready') ||
        activityAt(b, usageOf(b.sandbox_id)) -
          activityAt(a, usageOf(a.sandbox_id)),
    );
    for (const s of byRecent.slice(1)) {
      if (out.has(s.sandbox_id) || !free(s)) continue;
      if (idle(s) > opts.duplicateGraceMs) {
        out.set(s.sandbox_id, `copia repetida de ${repoName(s.repo_url)}`);
      }
    }
  }
  return [...out].map(([sandbox_id, reason]) => ({ sandbox_id, reason }));
}

/**
 * Para crear un sandbox más cuando el usuario está en su límite: cuáles de
 * los suyos liberar (primero los del mismo repo, después los más viejos).
 */
export function pickToFree(
  userRecords: SandboxRecord[],
  repoUrl: string,
  needed: number,
  usageOf: (id: string) => SandboxUsage,
  busyOf: (id: string) => boolean,
  now: number,
  opts: CleanupOptions,
): string[] {
  if (needed <= 0) return [];
  return userRecords
    .filter(
      (s) =>
        isLive(s) &&
        !isProtected(s, usageOf(s.sandbox_id), busyOf(s.sandbox_id), now, opts),
    )
    .sort(
      (a, b) =>
        Number(b.repo_url === repoUrl) - Number(a.repo_url === repoUrl) ||
        activityAt(a, usageOf(a.sandbox_id)) -
          activityAt(b, usageOf(b.sandbox_id)),
    )
    .slice(0, needed)
    .map((s) => s.sandbox_id);
}

function hours(ms: number): string {
  const h = ms / 3_600_000;
  return h >= 1
    ? `${Number(h.toFixed(1))} h`
    : `${Math.round(ms / 60_000)} min`;
}

function repoName(url: string): string {
  return url.replace(/^https:\/\/github\.com\//, '');
}
