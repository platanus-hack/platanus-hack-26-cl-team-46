import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import type { Env } from '../config/env.js';
import { RenderClient } from '../render/render.client.js';
import type { RenderPostgres } from '../render/render.types.js';

export interface ProvisionedDatabase {
  postgres_id: string;
  /** Solo en modo shared. */
  database_name?: string;
  /** Para el servicio en Render (red interna). */
  internal_url: string;
  /** Para conectarse desde afuera (backend, motor). */
  external_url: string;
}

const POLL_MS = 5_000;
const TIMEOUT_MS = 10 * 60_000;

/**
 * Bases de datos para los sandboxes.
 *
 * - shared (default, free tier): una instancia Postgres compartida, y una
 *   base de datos por sandbox creada con CREATE DATABASE.
 * - dedicated: una instancia por sandbox (más aislado, requiere plan pagado).
 */
@Injectable()
export class DatabaseProvisioner {
  private readonly logger = new Logger(DatabaseProvisioner.name);
  private sharedPromise?: Promise<RenderPostgres>;

  constructor(
    private readonly render: RenderClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get mode() {
    return this.config.get('RENDER_POSTGRES_MODE', { infer: true });
  }

  async provision(
    sandboxId: string,
    onProgress: (msg: string) => void,
  ): Promise<ProvisionedDatabase> {
    return this.mode === 'shared'
      ? this.provisionShared(sandboxId, onProgress)
      : this.provisionDedicated(sandboxId, onProgress);
  }

  /** URLs de conexión de una base ya aprovisionada. */
  async urlsFor(db: {
    postgres_id: string;
    database_name?: string;
  }): Promise<{ internal_url: string; external_url: string }> {
    const info = await this.render.getPostgresConnectionInfo(db.postgres_id);
    return db.database_name
      ? {
          internal_url: withDatabase(
            info.internalConnectionString,
            db.database_name,
          ),
          external_url: withDatabase(
            info.externalConnectionString,
            db.database_name,
          ),
        }
      : {
          internal_url: info.internalConnectionString,
          external_url: info.externalConnectionString,
        };
  }

  async release(db: {
    postgres_id: string;
    database_name?: string;
  }): Promise<void> {
    if (db.database_name) {
      const info = await this.render.getPostgresConnectionInfo(db.postgres_id);
      await this.withAdminClient(
        info.externalConnectionString,
        async (client) => {
          await client.query(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
            [db.database_name],
          );
          await client.query(
            `DROP DATABASE IF EXISTS ${quoteIdent(db.database_name!)}`,
          );
        },
      );
    } else {
      await this.render.deletePostgres(db.postgres_id);
    }
  }

  // ---------------------------------------------------------------- shared

  private async provisionShared(
    sandboxId: string,
    onProgress: (msg: string) => void,
  ) {
    const instance = await this.ensureSharedInstance(onProgress);
    const info = await this.render.getPostgresConnectionInfo(instance.id);
    const databaseName = sandboxId.replace(/[^a-z0-9]/gi, '_').toLowerCase();

    onProgress(
      `Creando base de datos ${databaseName} en la instancia compartida`,
    );
    await this.withAdminClient(
      info.externalConnectionString,
      async (client) => {
        const exists = await client.query(
          'SELECT 1 FROM pg_database WHERE datname = $1',
          [databaseName],
        );
        if (exists.rowCount === 0)
          await client.query(`CREATE DATABASE ${quoteIdent(databaseName)}`);
      },
    );

    return {
      postgres_id: instance.id,
      database_name: databaseName,
      internal_url: withDatabase(info.internalConnectionString, databaseName),
      external_url: withDatabase(info.externalConnectionString, databaseName),
    };
  }

  private ensureSharedInstance(
    onProgress: (msg: string) => void,
  ): Promise<RenderPostgres> {
    this.sharedPromise ??= (async () => {
      const name = this.config.get('RENDER_SHARED_POSTGRES_NAME', {
        infer: true,
      });
      let instance = await this.render.findPostgresByName(name);
      if (!instance) {
        onProgress(
          `Creando instancia Postgres compartida "${name}" (solo la primera vez, tarda unos minutos)`,
        );
        instance = await this.render.createPostgres({
          name,
          ownerId: await this.render.ownerId(),
          plan: this.config.get('RENDER_POSTGRES_PLAN', { infer: true }),
          version: this.config.get('RENDER_POSTGRES_VERSION', { infer: true }),
          region: this.config.get('RENDER_REGION', { infer: true }),
        });
      }
      return this.waitAvailable(instance, onProgress);
    })().catch((err) => {
      this.sharedPromise = undefined; // permite reintentar
      throw err;
    });
    return this.sharedPromise;
  }

  // ------------------------------------------------------------- dedicated

  private async provisionDedicated(
    sandboxId: string,
    onProgress: (msg: string) => void,
  ) {
    onProgress('Creando instancia Postgres dedicada (tarda unos minutos)');
    const created = await this.render.createPostgres({
      name: `${sandboxId}-db`,
      ownerId: await this.render.ownerId(),
      plan: this.config.get('RENDER_POSTGRES_PLAN', { infer: true }),
      version: this.config.get('RENDER_POSTGRES_VERSION', { infer: true }),
      region: this.config.get('RENDER_REGION', { infer: true }),
    });
    const instance = await this.waitAvailable(created, onProgress);
    const info = await this.render.getPostgresConnectionInfo(instance.id);
    return {
      postgres_id: instance.id,
      internal_url: info.internalConnectionString,
      external_url: info.externalConnectionString,
    };
  }

  // ---------------------------------------------------------------- común

  private async waitAvailable(
    instance: RenderPostgres,
    onProgress: (msg: string) => void,
  ) {
    const started = Date.now();
    let current = instance;
    while (current.status !== 'available') {
      if (Date.now() - started > TIMEOUT_MS) {
        throw new Error(
          `Postgres ${current.id} no quedó disponible (estado: ${current.status})`,
        );
      }
      onProgress(`Postgres ${current.name}: ${current.status}`);
      await sleep(POLL_MS);
      current = await this.render.getPostgres(current.id);
    }
    return current;
  }

  private async withAdminClient<T>(
    url: string,
    fn: (c: pg.Client) => Promise<T>,
  ): Promise<T> {
    const client = new pg.Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
