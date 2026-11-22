import {
  scrubProviderRaw,
  scrubProviderText,
} from '../conductor/public-text.js';
import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import type { Env } from '../config/env.js';
import type { SandboxEvent } from './sandbox.types.js';

type Listener = (e: SandboxEvent) => void;

/** Eventos que se guardan (y se reenvían al conectarse) por sandbox. */
export const MAX_EVENTS_PER_SANDBOX = 500;
const FILE_FLUSH_MS = 1_000;

/**
 * Bus de eventos por sandbox con historial, para que un cliente que se
 * conecta tarde (UI, motor) reciba todo lo que pasó desde el inicio.
 *
 * El historial se persiste (tabla `sandbox_events` en Postgres, o un JSON en
 * DATA_DIR) para que sobreviva a un reinicio del backend: en Render free el
 * servicio se reinicia en cada deploy y al despertar.
 */
@Injectable()
export class SandboxEventsService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(SandboxEventsService.name);
  private readonly history = new Map<string, SandboxEvent[]>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly file: string;
  private readonly databaseUrl?: string;
  private pool?: pg.Pool;
  private writing: Promise<void> = Promise.resolve();
  private flushTimer?: NodeJS.Timeout;

  constructor(config: ConfigService<Env, true>) {
    this.databaseUrl = config.get('DATABASE_URL', { infer: true });
    this.file = path.resolve(
      config.get('DATA_DIR', { infer: true }),
      'sandbox-events.json',
    );
  }

  async onModuleInit() {
    if (this.databaseUrl) {
      this.pool = new pg.Pool({
        connectionString: this.databaseUrl,
        // La URL interna de Render no usa SSL; la externa sí.
        ssl: this.databaseUrl.includes('.render.com')
          ? { rejectUnauthorized: false }
          : undefined,
        max: 2,
      });
      await this.pool.query(
        `CREATE TABLE IF NOT EXISTS sandbox_events (
           id bigserial PRIMARY KEY,
           sandbox_id text NOT NULL,
           data jsonb NOT NULL
         )`,
      );
      await this.pool.query(
        'CREATE INDEX IF NOT EXISTS sandbox_events_sandbox_idx ON sandbox_events (sandbox_id, id)',
      );
      const { rows } = await this.pool.query<{ data: SandboxEvent }>(
        `SELECT data FROM (
           SELECT data, id, row_number() OVER (PARTITION BY sandbox_id ORDER BY id DESC) AS rn
             FROM sandbox_events
         ) recent
         WHERE rn <= $1
         ORDER BY id`,
        [MAX_EVENTS_PER_SANDBOX],
      );
      for (const r of rows) this.remember(r.data);
      this.logger.log(`Cargados ${rows.length} eventos de sandboxes`);
      return;
    }
    if (!existsSync(this.file)) return;
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8')) as Record<
        string,
        SandboxEvent[]
      >;
      for (const list of Object.values(saved))
        list.forEach((e) => this.remember(e));
    } catch (err) {
      this.logger.error(
        `No se pudo leer ${this.file}: ${(err as Error).message}`,
      );
    }
  }

  /** Al final del apagado: durante el drenaje se siguen emitiendo eventos. */
  async onApplicationShutdown() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushFile();
    }
    await this.writing;
    await this.pool?.end();
  }

  emit(
    sandboxId: string,
    severity: SandboxEvent['severity'],
    title: string,
    body = '',
    raw: Record<string, unknown> = {},
    source: SandboxEvent['source'] = 'deploy',
  ): SandboxEvent {
    const event: SandboxEvent = {
      t: new Date().toISOString(),
      sandbox_id: sandboxId,
      vuln_id: null,
      source,
      severity,
      title,
      body,
      raw,
    };
    this.remember(event);
    this.persist(event);
    for (const l of this.listeners.get(sandboxId) ?? []) l(event);
    return event;
  }

  getHistory(sandboxId: string): SandboxEvent[] {
    return [...(this.history.get(sandboxId) ?? [])];
  }

  subscribe(sandboxId: string, listener: Listener): () => void {
    const set = this.listeners.get(sandboxId) ?? new Set();
    set.add(listener);
    this.listeners.set(sandboxId, set);
    return () => set.delete(listener);
  }

  /** Stream SSE: historial + eventos en vivo + heartbeat. */
  sseStream(sandboxId: string): ReadableStream<string> {
    let unsubscribe = () => {};
    let heartbeat: NodeJS.Timeout;
    // Salida pública: sin rastros del proveedor de agentes (también en eventos viejos ya guardados).
    const format = (e: SandboxEvent) =>
      `event: ${e.source}\ndata: ${JSON.stringify({
        ...e,
        title: scrubProviderText(e.title),
        body: scrubProviderText(e.body),
        raw: scrubProviderRaw(e.raw),
      })}\n\n`;
    return new ReadableStream<string>({
      start: (controller) => {
        controller.enqueue(': connected\n\n');
        for (const e of this.getHistory(sandboxId))
          controller.enqueue(format(e));
        unsubscribe = this.subscribe(sandboxId, (e) =>
          controller.enqueue(format(e)),
        );
        heartbeat = setInterval(() => controller.enqueue(': ping\n\n'), 15_000);
      },
      cancel: () => {
        unsubscribe();
        clearInterval(heartbeat);
      },
    });
  }

  private remember(event: SandboxEvent) {
    const list = this.history.get(event.sandbox_id) ?? [];
    list.push(event);
    if (list.length > MAX_EVENTS_PER_SANDBOX) list.shift();
    this.history.set(event.sandbox_id, list);
  }

  private persist(event: SandboxEvent) {
    if (this.pool) {
      const pool = this.pool;
      this.writing = this.writing
        .then(async () => {
          await pool.query(
            'INSERT INTO sandbox_events (sandbox_id, data) VALUES ($1, $2)',
            [event.sandbox_id, JSON.stringify(event)],
          );
        })
        .catch((err) =>
          this.logger.error(
            `No se pudo guardar el evento de ${event.sandbox_id}: ${(err as Error).message}`,
          ),
        );
      return;
    }
    // JSON local: se agrupan las escrituras porque un deploy emite varios eventos seguidos.
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushFile(), FILE_FLUSH_MS);
    }
  }

  private flushFile() {
    this.flushTimer = undefined;
    const file = this.file;
    const snapshot = JSON.stringify(Object.fromEntries(this.history));
    this.writing = this.writing
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        await writeFile(tmp, snapshot);
        await rename(tmp, file);
      })
      .catch((err) =>
        this.logger.error(
          `No se pudo guardar ${file}: ${(err as Error).message}`,
        ),
      );
  }
}
