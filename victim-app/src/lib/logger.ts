import { track } from './analytics';

type Level = 'info' | 'warn' | 'error';

// Eventos de negocio que además se mandan a PostHog.
const PRODUCT_EVENTS = new Set([
  'login_success',
  'login_failed',
  'user_registered',
  'password_changed',
  'profile_updated',
  'admin_export',
]);

// Un evento JSON por línea a stdout (Render lo muestra tal cual en los logs)
export function logEvent(event: string, data: Record<string, unknown> = {}, level: Level = 'info'): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
  process.stdout.write(line + '\n');
  if (PRODUCT_EVENTS.has(event)) {
    const who = data.user_id ?? data.email ?? data.ip ?? 'anonymous';
    track(String(who), event, data);
  }
}
