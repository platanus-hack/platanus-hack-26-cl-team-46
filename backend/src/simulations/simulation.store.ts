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
import type { SimulationRecord } from './simulation.types.js';

/** Máximo de eventos que se guardan por simulación. */
const MAX_TIMELINE = 3000;

/**
 * Estado de las simulaciones (incluido su timeline). Mismo esquema que
 * SandboxStore: Map en memoria + Postgres (si hay DATABASE_URL) o JSON local.
 * Las escrituras se agrupan (debounce) porque el timeline cambia seguido.
 */
@Injectable()
export class SimulationStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SimulationStore.name);
  private readonly file: string;
  private readonly databaseUrl?: string;
  private pool?: pg.Pool;
  private readonly items = new Map<string, SimulationRecord>();
  private readonly dirty = new Set<string>();
  private flushTimer?: NodeJS.Timeout;
  private writing: Promise<void> = Promise.resolve();

  constructor(config: ConfigService<Env, true>) {
    this.file = path.resolve(
      config.get('DATA_DIR', { infer: true }),
      'simulations.json',
    );
    this.databaseUrl = config.get('DATABASE_URL', { infer: true });
  }

  async onModuleInit() {
    if (this.databaseUrl) {
      this.pool = new pg.Pool({
        connectionString: this.databaseUrl,
        ssl: this.databaseUrl.includes('.render.com')
          ? { rejectUnauthorized: false }
          : undefined,
        max: 2,
      });
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS simulations (
           id text PRIMARY KEY,
           data jsonb NOT NULL,
           updated_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
      const { rows } = await this.pool.query<{ data: SimulationRecord }>(
        'SELECT data FROM simulations',
      );
      for (const r of rows) this.items.set(r.data.sim_id, r.data);
      this.logger.log(`Cargadas ${rows.length} simulaciones desde Postgres`);
      return;
    }
    if (!existsSync(this.file)) return;
    try {
      const list = JSON.parse(
        await readFile(this.file, 'utf8'),
      ) as SimulationRecord[];
      for (const s of list) this.items.set(s.sim_id, s);
      this.logger.log(
        `Cargadas ${list.length} simulaciones desde ${this.file}`,
      );
    } catch (err) {
      this.logger.error(
        `No se pudo leer ${this.file}: ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    clearTimeout(this.flushTimer);
    this.flush();
    await this.writing;
    await this.pool?.end();
  }

  get(id: string): SimulationRecord | undefined {
    return this.items.get(id);
  }

  list(): SimulationRecord[] {
    return [...this.items.values()].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
  }

  insert(record: SimulationRecord): SimulationRecord {
    this.items.set(record.sim_id, record);
    this.markDirty(record.sim_id);
    return record;
  }

  update(
    id: string,
    patch: Partial<SimulationRecord> | ((s: SimulationRecord) => void),
  ): SimulationRecord {
    const current = this.items.get(id);
    if (!current) throw new Error(`Simulación ${id} no existe`);
    if (typeof patch === 'function') patch(current);
    else Object.assign(current, patch);
    if (current.timeline.length > MAX_TIMELINE)
      current.timeline.splice(0, current.timeline.length - MAX_TIMELINE);
    current.updated_at = new Date().toISOString();
    this.markDirty(id);
    return current;
  }

  private markDirty(id: string) {
    this.dirty.add(id);
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, 500);
  }

  private flush() {
    if (!this.dirty.size) return;
    const ids = [...this.dirty];
    this.dirty.clear();
    if (this.pool) {
      const pool = this.pool;
      const rows = ids.map((id) => [id, JSON.stringify(this.items.get(id))]);
      this.writing = this.writing
        .then(async () => {
          for (const [id, json] of rows) {
            await pool.query(
              `INSERT INTO simulations (id, data, updated_at) VALUES ($1, $2, now())
               ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
              [id, json],
            );
          }
        })
        .catch((err) =>
          this.logger.error(`No se pudo persistir: ${(err as Error).message}`),
        );
      return;
    }
    const snapshot = JSON.stringify(this.list());
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
