type Level = 'info' | 'warn' | 'error';

// Un evento JSON por línea a stdout (Render lo muestra tal cual en los logs)
export function logEvent(event: string, data: Record<string, unknown> = {}, level: Level = 'info'): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
  process.stdout.write(line + '\n');
}
