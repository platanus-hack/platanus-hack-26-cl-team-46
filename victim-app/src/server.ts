import { config } from './config';
import { createApp, state } from './app';
import { pool } from './db/pool';
import { migrate, resetDatabase } from './db/migrate';
import { seed } from './db/seed';
import { logEvent } from './lib/logger';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForDatabase(attempts = 30): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      logEvent('db_waiting', { attempt: i, error: (err as Error).message }, 'warn');
      await sleep(2000);
    }
  }
  throw new Error('No se pudo conectar a la base de datos');
}

async function init(): Promise<void> {
  await waitForDatabase();
  if (config.seedReset) {
    await resetDatabase();
  }
  await migrate();
  await seed();
  state.ready = true;
  logEvent('app_ready', { env: config.nodeEnv });
}

const app = createApp();
app.listen(config.port, () => {
  logEvent('server_started', { port: config.port, env: config.nodeEnv });
});

init().catch((err) => {
  logEvent('startup_failed', { error: err.message, stack: err.stack }, 'error');
  process.exit(1);
});

process.on('SIGTERM', () => {
  logEvent('shutdown', { signal: 'SIGTERM' });
  pool.end().finally(() => process.exit(0));
});
