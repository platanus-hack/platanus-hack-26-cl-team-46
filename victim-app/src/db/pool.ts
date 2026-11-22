import { Pool } from 'pg';
import { config } from '../config';

// Render: la URL interna no usa SSL, la externa (*.render.com) sí
function buildPoolConfig(rawUrl: string) {
  const url = new URL(rawUrl);
  const sslmode = url.searchParams.get('sslmode');
  url.searchParams.delete('sslmode');
  const useSsl = (sslmode !== null && sslmode !== 'disable') || url.hostname.endsWith('.render.com');
  return {
    connectionString: url.toString(),
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    max: 5,
  };
}

export const pool = new Pool(buildPoolConfig(config.databaseUrl));
