import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'node:crypto';
import pg from 'pg';
import type { Env } from '../config/env.js';
import { RenderClient } from '../render/render.client.js';
import type { RenderPostgres } from '../render/render.types.js';

export interface ProvisionedDatabase {
  postgres_id: string;
  /** Solo en modo shared. */
  database_name?: string;
  /** Solo en modo shared: rol propio del sandbox, dueño de su base. */
  role?: string;
  /** Para el servicio en Render (red interna). */
  internal_url: string;
  /** Para conectarse desde afuera (backend, motor). */
  external_url: string;
}

export interface SandboxDatabaseRef {
  postgres_id: string;
  database_name?: string;
  role?: string;
}

const POLL_MS = 5_000;
const TIMEOUT_MS = 10 * 60_000;

/**
 * Roles internos de Render que se conectan a las bases (monitoreo, gestión).
 * Al cerrar una base a PUBLIC se les mantiene el CONNECT (sin acceso a tablas).
 */
const RENDER_INTERNAL_ROLES = [
  'datadog',
  'render_conn',
  'render_mgmt',
  'primaryuser',
];

/**
 * Bases de datos para los sandboxes.
 *
 * - shared (default, free tier): una instancia Postgres compartida, y por
 *   sandbox una base **y un rol propio** (dueño de su base, sin acceso a las
 *   demás). La app del sandbox es código del usuario y es vulnerable a
 *   propósito: nunca recibe las credenciales de administrador de la instancia.
 *   Todas las bases se cierran a PUBLIC, incluida la del backend.
 * - dedicated: una instancia por sandbox (aislada por construcción).
 *
 * Las credenciales de administrador (usuario default de Render) solo se usan
 * dentro de esta clase.
 */
@Injectable()
export class DatabaseProvisioner {
  private readonly logger = new Logger(DatabaseProvisioner.name);
  private sharedPromise?: Promise<RenderPostgres>;
  private readonly passwordSecret: string;
  private lockdownDone = false;

  constructor(
    private readonly render: RenderClient,
    private readonly config: ConfigService<Env, true>,
  ) {
    const secret =
      config.get('SANDBOX_DB_SECRET', { infer: true }) ??
      config.get('AGENT_API_SECRET', { infer: true });
    if (!secret) {
      this.logger.warn(
        'Sin SANDBOX_DB_SECRET ni AGENT_API_SECRET: las contraseñas de las bases de sandboxes cambian en cada arranque (se reponen en el siguiente deploy de cada sandbox)',
      );
    }
    this.passwordSecret = secret ?? randomBytes(32).toString('hex');
  }

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

  /**
   * URLs de conexión de una base ya aprovisionada. Con rol propio usan las
   * credenciales del sandbox (nunca las de administrador), también para el
   * backend y los agentes: lo que hagan en la base queda limitado a ella.
   */
  async urlsFor(
    db: SandboxDatabaseRef,
  ): Promise<{ internal_url: string; external_url: string }> {
    const info = await this.render.getPostgresConnectionInfo(db.postgres_id);
    if (!db.database_name) {
      return {
        internal_url: info.internalConnectionString,
        external_url: info.externalConnectionString,
      };
    }
    const creds = db.role
      ? { user: db.role, password: this.passwordFor(db.role) }
      : undefined;
    return {
      internal_url: withDatabase(
        info.internalConnectionString,
        db.database_name,
        creds,
      ),
      external_url: withDatabase(
        info.externalConnectionString,
        db.database_name,
        creds,
      ),
    };
  }

  /**
   * Deja la base del sandbox aislada y devuelve sus URLs con el rol propio.
   * Idempotente: crea el rol si falta, repone su contraseña, le traspasa la
   * base y todos sus objetos (bases creadas antes del aislamiento) y la cierra
   * a PUBLIC. Se llama antes de cada deploy que inyecta la URL.
   */
  async ensureIsolated(
    db: SandboxDatabaseRef,
  ): Promise<{ role: string; internal_url: string; external_url: string }> {
    if (!db.database_name) {
      // dedicated: la instancia es solo del sandbox.
      return { role: '', ...(await this.urlsFor(db)) };
    }
    const role = db.role ?? sandboxRoleName(db.database_name);
    const info = await this.render.getPostgresConnectionInfo(db.postgres_id);
    await this.withClient(info.externalConnectionString, async (admin) => {
      await this.ensureRole(admin, role);
      await admin.query(
        `ALTER DATABASE ${quoteIdent(db.database_name!)} OWNER TO ${quoteIdent(role)}`,
      );
      await this.closeDatabase(admin, db.database_name!, role);
    });
    // Objetos que ya existían (tablas, secuencias, tipos...) pasan al rol, para
    // que la app pueda leerlos y correr sus migraciones (ALTER TABLE).
    await this.withClient(
      withDatabase(info.externalConnectionString, db.database_name),
      (admin) => admin.query(transferOwnershipSql(role)),
    );
    await this.lockdownSharedInstance(info.externalConnectionString);
    return { role, ...(await this.urlsFor({ ...db, role })) };
  }

  async release(db: SandboxDatabaseRef): Promise<void> {
    if (db.database_name) {
      const info = await this.render.getPostgresConnectionInfo(db.postgres_id);
      await this.withClient(info.externalConnectionString, async (client) => {
        await client.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [db.database_name],
        );
        await client.query(
          `DROP DATABASE IF EXISTS ${quoteIdent(db.database_name!)}`,
        );
        const role = db.role ?? sandboxRoleName(db.database_name!);
        await client.query(`DROP ROLE IF EXISTS ${quoteIdent(role)}`);
      });
    } else {
      await this.render.deletePostgres(db.postgres_id);
    }
  }

  /**
   * Cierra a PUBLIC todas las bases de la instancia compartida que administra
   * el backend (la del backend, la default de Render y las de sandboxes): solo
   * su dueño puede conectarse. Una vez por proceso; idempotente.
   */
  async lockdownSharedInstance(adminUrl?: string): Promise<void> {
    if (this.lockdownDone || this.mode !== 'shared') return;
    let url = adminUrl;
    if (!url) {
      const name = this.config.get('RENDER_SHARED_POSTGRES_NAME', {
        infer: true,
      });
      const instance = await this.render.findPostgresByName(name);
      if (!instance) return;
      url = (await this.render.getPostgresConnectionInfo(instance.id))
        .externalConnectionString;
    }
    await this.withClient(url, async (admin) => {
      const { rows } = await admin.query<{ datname: string }>(
        `SELECT datname FROM pg_database
          WHERE NOT datistemplate AND datname <> 'postgres'
            AND pg_has_role(current_user, datdba, 'MEMBER')`,
      );
      for (const { datname } of rows) {
        await this.closeDatabase(admin, datname).catch((err: Error) =>
          this.logger.warn(
            `No se pudo cerrar la base ${datname}: ${err.message}`,
          ),
        );
      }
      this.logger.log(
        `Instancia compartida cerrada a PUBLIC (${rows.length} bases)`,
      );
    });
    this.lockdownDone = true;
  }

  passwordFor(role: string): string {
    return deriveDbPassword(this.passwordSecret, role);
  }

  // ---------------------------------------------------------------- shared

  private async provisionShared(
    sandboxId: string,
    onProgress: (msg: string) => void,
  ): Promise<ProvisionedDatabase> {
    const instance = await this.ensureSharedInstance(onProgress);
    const info = await this.render.getPostgresConnectionInfo(instance.id);
    const databaseName = sandboxId.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const role = sandboxRoleName(databaseName);

    onProgress(
      `Creando base de datos ${databaseName} (con su propio usuario) en la instancia compartida`,
    );
    await this.withClient(info.externalConnectionString, async (admin) => {
      await this.ensureRole(admin, role);
      const exists = await admin.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [databaseName],
      );
      if (exists.rowCount === 0) {
        await admin.query(
          `CREATE DATABASE ${quoteIdent(databaseName)} OWNER ${quoteIdent(role)}`,
        );
      } else {
        await admin.query(
          `ALTER DATABASE ${quoteIdent(databaseName)} OWNER TO ${quoteIdent(role)}`,
        );
      }
      await this.closeDatabase(admin, databaseName, role);
    });
    await this.lockdownSharedInstance(info.externalConnectionString);

    const urls = await this.urlsFor({
      postgres_id: instance.id,
      database_name: databaseName,
      role,
    });
    return {
      postgres_id: instance.id,
      database_name: databaseName,
      role,
      ...urls,
    };
  }

  /** Crea el rol del sandbox (o repone su contraseña) y le da membresía al administrador. */
  private async ensureRole(admin: pg.Client, role: string) {
    const password = quoteLiteral(this.passwordFor(role));
    const exists = await admin.query(
      'SELECT 1 FROM pg_roles WHERE rolname = $1',
      [role],
    );
    if (exists.rowCount === 0) {
      await admin.query(
        `CREATE ROLE ${quoteIdent(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 20 PASSWORD ${password}`,
      );
    } else {
      await admin.query(
        `ALTER ROLE ${quoteIdent(role)} LOGIN PASSWORD ${password}`,
      );
    }
    // El administrador necesita los privilegios del rol para traspasarle objetos
    // y administrar su base (ALTER ... OWNER exige poder hacer SET ROLE).
    await admin
      .query(
        `GRANT ${quoteIdent(role)} TO current_user WITH INHERIT TRUE, SET TRUE`,
      )
      .catch(() =>
        // Postgres < 16 no tiene WITH INHERIT/SET.
        admin.query(`GRANT ${quoteIdent(role)} TO current_user`),
      );
  }

  /** Quita CONNECT/TEMP a PUBLIC y se lo da solo al dueño (y a los roles internos de Render). */
  private async closeDatabase(
    admin: pg.Client,
    database: string,
    owner?: string,
  ) {
    const db = quoteIdent(database);
    await admin.query(
      `REVOKE CONNECT, TEMPORARY ON DATABASE ${db} FROM PUBLIC`,
    );
    if (owner) {
      await admin.query(
        `GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO ${quoteIdent(owner)}`,
      );
    }
    const { rows } = await admin.query<{ rolname: string }>(
      'SELECT rolname FROM pg_roles WHERE rolname = ANY($1)',
      [RENDER_INTERNAL_ROLES],
    );
    for (const { rolname } of rows) {
      await admin.query(
        `GRANT CONNECT ON DATABASE ${db} TO ${quoteIdent(rolname)}`,
      );
    }
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
  ): Promise<ProvisionedDatabase> {
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

  private async withClient<T>(
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

/** El rol de un sandbox se llama igual que su base (`sbx_xxxxxxxx`). */
export function sandboxRoleName(databaseName: string): string {
  return databaseName;
}

/** Contraseña del rol, derivada del secreto: no hay que guardarla en ningún lado. */
export function deriveDbPassword(secret: string, role: string): string {
  return createHmac('sha256', secret)
    .update(`sandbox-db:${role}`)
    .digest('base64url');
}

/**
 * Traspasa al rol todos los objetos de la base actual que no son suyos
 * (esquemas, tablas, vistas, secuencias sueltas, tipos y funciones), salvo
 * los de extensiones. Las secuencias de columnas serial/identity siguen a su
 * tabla. Se ejecuta conectado a la base del sandbox.
 */
export function transferOwnershipSql(role: string): string {
  const target = quoteLiteral(role);
  return `DO $mayday$
DECLARE
  r record;
  target_oid oid := (SELECT oid FROM pg_roles WHERE rolname = ${target});
BEGIN
  FOR r IN
    SELECT n.nspname FROM pg_namespace n
     WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
       AND n.nspowner <> target_oid
       AND pg_get_userbyid(n.nspowner) <> 'pg_database_owner'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = n.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO %I', r.nspname, ${target});
  END LOOP;

  FOR r IN
    SELECT n.nspname, c.relname, c.relkind FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
       AND c.relowner <> target_oid
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
       AND NOT (c.relkind = 'S' AND EXISTS (
         SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i')))
  LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO %I',
      CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
        WHEN 'S' THEN 'SEQUENCE' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END,
      r.nspname, r.relname, ${target});
  END LOOP;

  FOR r IN
    SELECT n.nspname, t.typname, t.typtype FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
       AND t.typtype IN ('e', 'd', 'r', 'c')
       AND (t.typtype <> 'c' OR (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c')
       AND t.typowner <> target_oid
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO %I',
      CASE r.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END,
      r.nspname, r.typname, ${target});
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.prokind FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
       AND p.proowner <> target_oid
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO %I',
      CASE r.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END,
      r.sig, ${target});
  END LOOP;
END
$mayday$;`;
}

function withDatabase(
  connectionString: string,
  database: string,
  creds?: { user: string; password: string },
): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  if (creds) {
    url.username = encodeURIComponent(creds.user);
    url.password = encodeURIComponent(creds.password);
  }
  return url.toString();
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
