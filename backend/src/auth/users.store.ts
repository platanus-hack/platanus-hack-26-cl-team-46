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

/** Usuario que entró con GitHub. Los tokens van cifrados (session.ts › encryptToken). */
export interface UserRecord {
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  /** Token user-to-server de la GitHub App, cifrado. */
  token: string;
  token_expires_at?: string;
  /** Refresh token (si la app tiene tokens que expiran), cifrado. */
  refresh_token?: string;
  refresh_expires_at?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Usuarios: Map en memoria + Postgres (tabla `users`) o JSON en DATA_DIR,
 * igual que SandboxStore.
 */
@Injectable()
export class UsersStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsersStore.name);
  private readonly file: string;
  private readonly databaseUrl?: string;
  private pool?: pg.Pool;
  private readonly items = new Map<number, UserRecord>();
  private writing: Promise<void> = Promise.resolve();

  constructor(config: ConfigService<Env, true>) {
    this.file = path.resolve(
      config.get('DATA_DIR', { infer: true }),
      'users.json',
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
        `CREATE TABLE IF NOT EXISTS users (
           github_id bigint PRIMARY KEY,
           data jsonb NOT NULL,
           updated_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
      const { rows } = await this.pool.query<{ data: UserRecord }>(
        'SELECT data FROM users',
      );
      for (const r of rows) this.items.set(r.data.github_id, r.data);
      this.logger.log(`Cargados ${rows.length} usuarios desde Postgres`);
      return;
    }
    if (!existsSync(this.file)) return;
    try {
      const list = JSON.parse(
        await readFile(this.file, 'utf8'),
      ) as UserRecord[];
      for (const u of list) this.items.set(u.github_id, u);
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

  get(githubId: number): UserRecord | undefined {
    return this.items.get(githubId);
  }

  upsert(user: Omit<UserRecord, 'created_at' | 'updated_at'>): UserRecord {
    const now = new Date().toISOString();
    const prev = this.items.get(user.github_id);
    const record: UserRecord = {
      ...user,
      created_at: prev?.created_at ?? now,
      updated_at: now,
    };
    this.items.set(record.github_id, record);
    this.persist(record);
    return record;
  }

  private persist(record: UserRecord) {
    if (this.pool) {
      const pool = this.pool;
      this.writing = this.writing
        .then(async () => {
          await pool.query(
            `INSERT INTO users (github_id, data, updated_at) VALUES ($1, $2, now())
             ON CONFLICT (github_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
            [record.github_id, JSON.stringify(record)],
          );
        })
        .catch((err) =>
          this.logger.error(
            `No se pudo persistir el usuario ${record.login}: ${(err as Error).message}`,
          ),
        );
      return;
    }
    const snapshot = JSON.stringify([...this.items.values()], null, 2);
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
