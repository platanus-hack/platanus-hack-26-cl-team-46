import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import type { Env } from '../config/env.js';
import type { SandboxRecord } from './sandbox.types.js';

/**
 * Estado de los sandboxes: Map en memoria (fuente de verdad en caliente) +
 * persistencia en Postgres (si hay DATABASE_URL) o en un JSON en DATA_DIR.
 * Las escrituras se serializan para no pisarse.
 */
@Injectable()
export class SandboxStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SandboxStore.name);
  private readonly file: string;
  private readonly databaseUrl?: string;
  private pool?: pg.Pool;
  private readonly items = new Map<string, SandboxRecord>();
  private writing: Promise<void> = Promise.resolve();

  constructor(config: ConfigService<Env, true>) {
    this.file = path.resolve(
      config.get('DATA_DIR', { infer: true }),
      'sandboxes.json',
    );
    this.databaseUrl = config.get('DATABASE_URL', { infer: true });
  }

  async onModuleInit() {
    if (this.databaseUrl) {
      this.pool = new pg.Pool({
        connectionString: this.databaseUrl,
        // La URL interna de Render no usa SSL; la externa sí.
        ssl: this.databaseUrl.includes('.render.com')
          ? { rejectUnauthorized: false }
          : undefined,
        max: 3,
      });
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS sandboxes (
           id text PRIMARY KEY,
           data jsonb NOT NULL,
           updated_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
      const { rows } = await this.pool.query<{ data: SandboxRecord }>(
        'SELECT data FROM sandboxes',
      );
      for (const r of rows)
        this.items.set(r.data.sandbox_id, normalize(r.data));
      this.logger.log(`Cargados ${rows.length} sandboxes desde Postgres`);
      return;
    }
    if (!existsSync(this.file)) return;
    try {
      const list = JSON.parse(
        await readFile(this.file, 'utf8'),
      ) as SandboxRecord[];
      for (const s of list) this.items.set(s.sandbox_id, normalize(s));
      this.logger.log(`Cargados ${list.length} sandboxes desde ${this.file}`);
    } catch (err) {
      this.logger.error(
        `No se pudo leer ${this.file}: ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.writing;
    await this.pool?.end();
  }

  get(id: string): SandboxRecord | undefined {
    return this.items.get(id);
  }

  list(): SandboxRecord[] {
    return [...this.items.values()].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
  }

  /** Aplica un cambio parcial y persiste. */
  update(
    id: string,
    patch: Partial<SandboxRecord> | ((s: SandboxRecord) => void),
  ): SandboxRecord {
    const current = this.items.get(id);
    if (!current) throw new Error(`Sandbox ${id} no existe`);
    if (typeof patch === 'function') patch(current);
    else Object.assign(current, patch);
    current.updated_at = new Date().toISOString();
    this.persist(current);
    return current;
  }

  insert(record: SandboxRecord): SandboxRecord {
    this.items.set(record.sandbox_id, record);
    this.persist(record);
    return record;
  }

  private persist(record: SandboxRecord) {
    if (this.pool) {
      const pool = this.pool;
      const json = JSON.stringify(record);
      this.writing = this.writing
        .then(async () => {
          await pool.query(
            `INSERT INTO sandboxes (id, data, updated_at) VALUES ($1, $2, now())
             ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
            [record.sandbox_id, json],
          );
        })
        .catch((err) =>
          this.logger.error(
            `No se pudo persistir ${record.sandbox_id}: ${(err as Error).message}`,
          ),
        );
      return;
    }
    const snapshot = JSON.stringify(this.list(), null, 2);
    this.writing = this.writing
      .then(async () => {
        await mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, snapshot);
        await rename(tmp, this.file);
      })
      .catch((err) =>
        this.logger.error(`No se pudo persistir: ${(err as Error).message}`),
      );
  }
}

/** Registros guardados por versiones anteriores pueden no tener los campos nuevos. */
function normalize(s: SandboxRecord): SandboxRecord {
  s.mode ??= 'auto';
  s.pending_inputs ??= [];
  s.deploys ??= [];
  s.env ??= {};
  return s;
}
