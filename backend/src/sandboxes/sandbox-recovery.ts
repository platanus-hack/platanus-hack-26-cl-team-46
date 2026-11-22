import type { SandboxRecord } from './sandbox.types.js';

/** Cada cuánto renueva el heartbeat la instancia que trabaja en un sandbox. */
export const LEASE_HEARTBEAT_MS = 10_000;
/** Sin heartbeat por más de esto, se asume que la instancia dueña murió. */
export const LEASE_TTL_MS = 45_000;

/** Estados en que el backend (no el agente) está trabajando activamente. */
export function needsWorker(s: SandboxRecord): boolean {
  return s.status === 'provisioning' || s.status === 'deploying';
}

/** ¿Otra instancia viva tiene el sandbox tomado? */
export function heldByOtherInstance(
  s: SandboxRecord,
  self: string,
  now = Date.now(),
): boolean {
  if (!s.lease || s.lease.owner === self) return false;
  return now - new Date(s.lease.heartbeat_at).getTime() < LEASE_TTL_MS;
}

export type RecoveryAction =
  /** Otra instancia sigue trabajando en él (deploy sin downtime): no tocar. */
  | { kind: 'skip' }
  /** Había un deploy de Render en curso: seguirlo hasta que termine. */
  | { kind: 'follow'; deployId: string }
  /** El agente ya estaba lanzado: él sigue a cargo. */
  | { kind: 'agent' }
  /** El aprovisionamiento quedó a medias: repetirlo (los pasos son idempotentes). */
  | { kind: 'reprovision' }
  /** Una operación se cortó antes de lanzar el deploy en Render. */
  | { kind: 'interrupted' };

/**
 * Qué hacer con un sandbox que quedó "en curso" cuando murió la instancia que
 * lo procesaba. Antes se marcaba como fallido; ahora se retoma.
 */
export function decideRecovery(
  s: SandboxRecord,
  self: string,
  now = Date.now(),
): RecoveryAction {
  if (!needsWorker(s) || heldByOtherInstance(s, self, now)) {
    return { kind: 'skip' };
  }
  const deploy = s.current_deploy;
  if (s.render && deploy && !deploy.finished_at) {
    return { kind: 'follow', deployId: deploy.id };
  }
  if (s.status === 'provisioning') {
    return s.agent ? { kind: 'agent' } : { kind: 'reprovision' };
  }
  return { kind: 'interrupted' };
}
