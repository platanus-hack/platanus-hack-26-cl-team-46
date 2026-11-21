import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { AgentOrchestrator } from '../agent/agent.orchestrator.js';
import type { Env } from '../config/env.js';
import { GitService, type FileChange } from '../git/git.service.js';
import { RenderApiError, RenderClient } from '../render/render.client.js';
import {
  DEPLOY_FAILED_STATUSES,
  type CreateWebServiceInput,
  type ListLogsQuery,
  type RenderEnvVarInput,
} from '../render/render.types.js';
import { DatabaseProvisioner } from './database.provisioner.js';
import {
  loadManifest,
  ManifestError,
  type SandboxManifest,
} from './manifest.js';
import { SandboxEventsService } from './sandbox-events.service.js';
import { SandboxStore } from './sandbox.store.js';
import type {
  SandboxContract,
  SandboxDeployInfo,
  SandboxMode,
  SandboxRecord,
} from './sandbox.types.js';

const DEPLOY_POLL_MS = 5_000;
const DEPLOY_TIMEOUT_MS = 25 * 60_000;
const HEALTH_TIMEOUT_MS = 4 * 60_000;

export interface CreateSandboxInput {
  repo_url: string;
  ref?: string;
  env?: Record<string, string>;
  mode?: SandboxMode;
}

export interface RedeployInput {
  patch?: string;
  files?: FileChange[];
  message?: string;
  clear_cache?: boolean;
}

export interface SetEnvInput {
  env?: Record<string, string>;
  generate?: string[];
  unset?: string[];
  deploy?: boolean;
}

/**
 * Ciclo de vida de un sandbox:
 *
 *   repo → mirror en GitHub → camino determinista (manifest o inferencia)
 *                                   ↓ si no alcanza
 *                             agente de IA en Conductor
 *
 * Ambos caminos terminan en `applyPlan`, que crea o actualiza Postgres y el
 * web service en Render y sigue el deploy. Las operaciones largas corren en
 * background: el progreso sale por SandboxEventsService.
 */
@Injectable()
export class SandboxesService implements OnModuleInit {
  private readonly logger = new Logger(SandboxesService.name);
  /** Una operación a la vez por sandbox. */
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly store: SandboxStore,
    private readonly events: SandboxEventsService,
    private readonly render: RenderClient,
    private readonly git: GitService,
    private readonly databases: DatabaseProvisioner,
    private readonly agents: AgentOrchestrator,
  ) {}

  /** Retoma deploys que estaban en curso cuando el backend se reinició. */
  onModuleInit() {
    for (const s of this.store.list()) {
      if (s.status !== 'provisioning' && s.status !== 'deploying') continue;
      const deploy = s.current_deploy;
      if (s.render && deploy && !deploy.finished_at) {
        this.logger.log(
          `Retomando seguimiento del deploy ${deploy.id} de ${s.sandbox_id}`,
        );
        this.runExclusive(s.sandbox_id, () =>
          this.followDeploy(s.sandbox_id, deploy.id),
        );
      } else if (!this.agentActive(s)) {
        this.store.update(s.sandbox_id, {
          status: 'failed',
          error: 'El backend se reinició durante el aprovisionamiento',
        });
      }
    }
  }

  // ------------------------------------------------------------ consultas

  list(): SandboxRecord[] {
    return this.store.list();
  }

  get(id: string): SandboxRecord {
    const s = this.store.get(id);
    if (!s) throw new NotFoundException(`Sandbox ${id} no existe`);
    return s;
  }

  /** Espera a que no quede ninguna operación en curso para el sandbox. */
  async waitIdle(id: string, timeoutMs = Infinity): Promise<void> {
    const started = Date.now();
    for (;;) {
      const lock = this.locks.get(id);
      if (!lock) return;
      const remaining = timeoutMs - (Date.now() - started);
      if (remaining <= 0) return;
      await Promise.race([lock, sleep(Math.min(remaining, 2_147_000_000))]);
    }
  }

  isBusy(id: string): boolean {
    return this.locks.has(id);
  }

  agentActive(s: SandboxRecord): boolean {
    return Boolean(s.agent && !s.agent.finished_at);
  }

  async toContract(s: SandboxRecord): Promise<SandboxContract> {
    let dbUrl: string | null = null;
    if (s.database && s.status !== 'deleted') {
      dbUrl = await this.databases
        .urlsFor(s.database)
        .then((u) => u.external_url)
        .catch(() => null);
    }
    const agent = s.agent
      ? (({ idle_since: _i, nudged: _n, ...rest }) => ({
          ...rest,
          active: !rest.finished_at,
        }))(s.agent)
      : null;
    return {
      sandbox_id: s.sandbox_id,
      repo_url: s.repo_url,
      commit_sha: s.commit_sha ?? null,
      deployed_url: s.render?.url ?? null,
      credentials: {
        seed_users: s.manifest?.seed_users ?? [],
        db_url: dbUrl,
        env: s.env,
      },
      status: s.status,
      mode: s.mode,
      error: s.error ?? null,
      logs_url: `/sandboxes/${s.sandbox_id}/logs`,
      events_url: `/sandboxes/${s.sandbox_id}/events`,
      render_service_id: s.render?.service_id ?? null,
      render_dashboard_url: s.render?.dashboard_url ?? null,
      mirror_repo_url: s.mirror_repo ? this.git.mirrorUrl(s.mirror_repo) : null,
      manifest_source: s.manifest_source ?? null,
      current_deploy: s.current_deploy ?? null,
      agent,
      pending_inputs: s.pending_inputs,
      created_at: s.created_at,
      updated_at: s.updated_at,
    };
  }

  // -------------------------------------------------------------- crear

  create(input: CreateSandboxInput): SandboxRecord {
    const mode = input.mode ?? 'auto';
    if (!this.git.mirrorsEnabled && mode !== 'manifest') {
      throw new ConflictException(
        'Los modos auto y agent necesitan GITHUB_TOKEN (mirrors) configurado',
      );
    }
    if (mode === 'agent') this.agents.assertConfigured();

    const id = `sbx-${randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    const record = this.store.insert({
      sandbox_id: id,
      repo_url: input.repo_url,
      ref: input.ref,
      mode,
      status: 'provisioning',
      created_at: now,
      updated_at: now,
      env: { ...input.env },
      pending_inputs: [],
      deploys: [],
    });
    this.events.emit(
      id,
      'info',
      'Sandbox creado',
      `Preparando el deploy de ${input.repo_url}`,
      { mode },
    );
    this.runExclusive(id, () => this.provision(id));
    return record;
  }

  private async provision(id: string) {
    const s = this.get(id);
    const step = (
      title: string,
      body = '',
      raw: Record<string, unknown> = {},
    ) => this.events.emit(id, 'info', title, body, raw);

    // 1. Código fuente
    step('Clonando repositorio', s.repo_url);
    const { dir, sha: sourceSha } = await this.git.cloneSource(
      id,
      s.repo_url,
      s.ref,
    );
    this.store.update(id, { source_sha: sourceSha });

    let manifest: SandboxManifest | undefined;
    let manifestError: string | undefined;
    try {
      const loaded = await loadManifest(dir);
      manifest = loaded.manifest;
      this.store.update(id, { manifest, manifest_source: loaded.source });
      step(
        'Repositorio clonado',
        `Commit ${sourceSha.slice(0, 7)}. Configuración ${loaded.source === 'file' ? 'desde .sandbox/manifest.json' : 'inferida'} (runtime ${manifest.runtime}).`,
        { manifest },
      );
    } catch (err) {
      if (!(err instanceof ManifestError)) throw err;
      manifestError = err.message;
      step(
        'Repositorio clonado',
        `Commit ${sourceSha.slice(0, 7)}. ${err.message}`,
      );
    }

    // 2. Mirror (o deploy directo, solo modo manifest sin token)
    if (this.git.mirrorsEnabled) {
      step('Creando mirror del repo', `${this.git.org}/${id}`);
      const mirror = await this.git.pushSnapshotToMirror(id, id, {
        url: s.repo_url,
        sha: sourceSha,
      });
      this.store.update(id, {
        mirror_repo: id,
        deploy_repo_url: mirror.mirrorUrl,
        commit_sha: mirror.sha,
      });
    } else {
      this.events.emit(
        id,
        'warning',
        'Deploy directo, sin mirror',
        'GITHUB_TOKEN no está configurado: se despliega desde el repo original y no se podrán aplicar parches.',
      );
      this.store.update(id, {
        deploy_repo_url: s.repo_url,
        commit_sha: sourceSha,
      });
    }

    // 3. Camino agéntico directo
    if (s.mode === 'agent') {
      await this.agents.start(
        id,
        'El usuario pidió que la IA configure el deploy.',
      );
      return;
    }
    if (!manifest) {
      if (s.mode === 'manifest') throw new Error(manifestError);
      await this.agents.start(
        id,
        `El camino determinista no supo cómo desplegarlo: ${manifestError}`,
      );
      return;
    }

    // 4. Camino optimista (determinista); si falla en modo auto, entra la IA
    try {
      await this.applyPlan(id, manifest, 'initial');
    } catch (err) {
      if (s.mode !== 'auto') throw err;
      const reason = `El deploy determinista (${this.get(id).manifest_source === 'file' ? 'manifest del repo' : 'configuración inferida'}) falló: ${(err as Error).message}`;
      this.events.emit(
        id,
        'warning',
        'El deploy automático falló',
        'Le pasamos el caso al agente de IA.',
        {
          error: (err as Error).message,
        },
      );
      await this.agents.start(id, reason);
    }
  }

  // ------------------------------------------------------------- planes

  /**
   * Aplica un manifest: Postgres si hace falta, crea o actualiza el web
   * service, reemplaza las env vars, despliega el commit actual del mirror
   * y espera a que quede live. Lanza un error si el deploy falla.
   */
  async applyPlan(id: string, manifest: SandboxManifest, reason: string) {
    this.store.update(id, { manifest, status: 'deploying', error: undefined });
    const s = this.get(id);

    // Postgres
    let databaseUrl: string | undefined;
    if (manifest.needs_postgres) {
      if (!s.database) {
        this.events.emit(
          id,
          'info',
          'Aprovisionando Postgres',
          `Modo ${this.databases.mode}`,
        );
        const db = await this.databases.provision(id, (msg) =>
          this.events.emit(id, 'info', 'Postgres', msg),
        );
        this.store.update(id, {
          database: {
            postgres_id: db.postgres_id,
            database_name: db.database_name,
          },
        });
        databaseUrl = db.internal_url;
        this.events.emit(
          id,
          'info',
          'Postgres listo',
          db.database_name ?? db.postgres_id,
        );
      } else {
        databaseUrl = (await this.databases.urlsFor(s.database)).internal_url;
      }
    }

    // Env vars: manifest < env del usuario/agente < DATABASE_URL
    const env = new Map<string, RenderEnvVarInput>();
    for (const [key, spec] of Object.entries(manifest.env)) {
      env.set(
        key,
        'generate' in spec
          ? { key, generateValue: true }
          : { key, value: spec.value },
      );
    }
    for (const [key, value] of Object.entries(s.env))
      env.set(key, { key, value });
    if (databaseUrl)
      env.set(manifest.database_url_env, {
        key: manifest.database_url_env,
        value: databaseUrl,
      });
    const envVars = [...env.values()];

    const details: Pick<
      CreateWebServiceInput,
      | 'runtime'
      | 'rootDir'
      | 'healthCheckPath'
      | 'buildCommand'
      | 'startCommand'
      | 'dockerfilePath'
    > = {
      runtime: manifest.runtime,
      rootDir: manifest.root_dir,
      healthCheckPath: manifest.healthcheck_path,
      dockerfilePath: manifest.dockerfile_path,
      buildCommand: manifest.build_command,
      startCommand: manifest.start_command,
    };

    let deployId: string | undefined;
    if (s.render) {
      // Servicio existente: actualizar config + env y desplegar el commit actual.
      try {
        await this.render.updateWebService(s.render.service_id, details);
      } catch (err) {
        if (!(err instanceof RenderApiError) || err.status >= 500) throw err;
        // Render no deja cambiar algunas cosas (p. ej. el runtime): recreamos el servicio.
        this.events.emit(
          id,
          'info',
          'Recreando servicio',
          `Render rechazó la actualización: ${err.message}`,
        );
        await this.render.deleteService(s.render.service_id);
        deployId = await this.createService(
          id,
          details,
          envVars,
          s.render.generation + 1,
        );
      }
      if (!deployId) {
        await this.render.replaceEnvVars(
          this.get(id).render!.service_id,
          envVars,
        );
        const triggered = await this.render.triggerDeploy(
          this.get(id).render!.service_id,
          {
            commitId: this.git.mirrorsEnabled ? s.commit_sha : undefined,
          },
        );
        deployId =
          triggered?.id ??
          (await this.waitForAnyDeploy(
            this.get(id).render!.service_id,
            s.current_deploy?.id,
          ));
      }
    } else {
      deployId = await this.createService(id, details, envVars, 0);
    }

    this.startDeploy(id, deployId, reason, this.get(id).commit_sha);
    await this.followDeploy(id, deployId);
  }

  private async createService(
    id: string,
    details: Pick<
      CreateWebServiceInput,
      | 'runtime'
      | 'rootDir'
      | 'healthCheckPath'
      | 'buildCommand'
      | 'startCommand'
      | 'dockerfilePath'
    >,
    envVars: RenderEnvVarInput[],
    generation: number,
  ): Promise<string> {
    const s = this.get(id);
    const name = generation === 0 ? id : `${id}-${generation}`;
    this.events.emit(id, 'info', 'Creando servicio en Render', name);
    const { service, deployId } = await this.render.createWebService({
      ...details,
      name,
      ownerId: await this.render.ownerId(),
      repo: s.deploy_repo_url!,
      branch: this.git.mirrorsEnabled ? 'main' : s.ref,
      envVars,
      plan: this.config.get('RENDER_SERVICE_PLAN', { infer: true }),
      region: this.config.get('RENDER_REGION', { infer: true }),
    });
    this.store.update(id, {
      render: {
        service_id: service.id,
        service_name: service.name,
        dashboard_url: service.dashboardUrl,
        url: service.serviceDetails?.url,
        generation,
      },
    });
    this.events.emit(
      id,
      'info',
      'Servicio creado',
      service.serviceDetails?.url ?? service.id,
      { service_id: service.id },
    );
    return deployId ?? (await this.waitForAnyDeploy(service.id));
  }

  /** Corre un plan del agente en background (exclusivo por sandbox). */
  runAgentPlan(id: string, manifest: SandboxManifest, note?: string) {
    this.store.update(id, {
      status: 'deploying',
      error: undefined,
      manifest_source: 'agent',
    });
    this.runExclusive(id, () =>
      this.applyPlan(id, manifest, note ? `agente: ${note}` : 'agente'),
    );
  }

  // ------------------------------------------------------------ acciones

  archiveSource(id: string): Promise<Buffer> {
    const s = this.get(id);
    if (!s.mirror_repo)
      throw new ConflictException('Este sandbox no tiene mirror');
    return this.git.archive(id, s.mirror_repo);
  }

  /** Commitea cambios al mirror (sin desplegar). Lo usan el agente y redeploy. */
  async commitChanges(
    id: string,
    change: { patch?: string; files?: FileChange[]; message: string },
  ) {
    const s = this.get(id);
    if (!s.mirror_repo)
      throw new ConflictException(
        'Este sandbox no tiene mirror: no se pueden aplicar cambios',
      );
    const result = await this.git.applyChanges(id, s.mirror_repo, change);
    this.store.update(id, { commit_sha: result.sha });
    return result;
  }

  redeploy(id: string, input: RedeployInput): SandboxRecord {
    const s = this.requireRender(id);
    const hasChanges = Boolean(input.patch || input.files?.length);
    if (hasChanges && !s.mirror_repo) {
      throw new ConflictException(
        'Este sandbox no tiene mirror (falta GITHUB_TOKEN): no se pueden aplicar parches',
      );
    }
    this.store.update(id, { status: 'deploying', error: undefined });
    this.runExclusive(id, async () => {
      let reason = 'redeploy';
      if (hasChanges) {
        const message = input.message ?? 'Parche aplicado desde el simulador';
        this.events.emit(id, 'info', 'Aplicando parche', message);
        const result = await this.commitChanges(id, {
          patch: input.patch,
          files: input.files,
          message,
        });
        reason = 'patch';
        this.events.emit(
          id,
          'info',
          'Parche commiteado',
          `${result.sha.slice(0, 7)}: ${result.changedFiles.join(', ')}`,
          {
            changed_files: result.changedFiles,
            commit_sha: result.sha,
          },
        );
      }
      await this.deployAndFollow(id, reason, {
        commitId: hasChanges ? this.get(id).commit_sha : undefined,
        clearCache: input.clear_cache,
      });
    });
    return this.get(id);
  }

  setEnv(id: string, input: SetEnvInput): SandboxRecord {
    const s = this.requireRender(id);
    const serviceId = s.render!.service_id;
    const deploy = input.deploy ?? true;
    if (deploy)
      this.store.update(id, { status: 'deploying', error: undefined });
    this.runExclusive(id, async () => {
      for (const [key, value] of Object.entries(input.env ?? {})) {
        await this.render.setEnvVar(serviceId, key, value);
      }
      for (const key of input.generate ?? []) {
        await this.render.setEnvVar(serviceId, key, { generate: true });
      }
      for (const key of input.unset ?? []) {
        await this.render.deleteEnvVar(serviceId, key);
      }
      this.store.update(id, (r) => {
        Object.assign(r.env, input.env ?? {});
        for (const key of [...(input.generate ?? []), ...(input.unset ?? [])])
          delete r.env[key];
      });
      const keys = [
        ...Object.keys(input.env ?? {}),
        ...(input.generate ?? []),
        ...(input.unset ?? []),
      ];
      this.events.emit(
        id,
        'info',
        'Variables de entorno actualizadas',
        keys.join(', '),
        { keys },
      );
      // Render no aplica los cambios de env a la instancia viva: hace falta un deploy.
      if (deploy) await this.deployAndFollow(id, `env: ${keys.join(', ')}`, {});
    });
    return this.get(id);
  }

  restart(id: string): SandboxRecord {
    const s = this.requireRender(id);
    this.store.update(id, { status: 'deploying', error: undefined });
    this.runExclusive(id, async () => {
      this.events.emit(id, 'info', 'Reiniciando servicio');
      await this.render.restartService(s.render!.service_id);
      // El restart no es instantáneo: si chequeamos al tiro responde la instancia vieja.
      await sleep(8_000);
      await this.waitHealthy(id);
      this.store.update(id, { status: 'ready' });
      this.events.emit(
        id,
        'info',
        'Servicio reiniciado',
        this.get(id).render?.url ?? '',
      );
    });
    return this.get(id);
  }

  async logs(id: string, query: Omit<ListLogsQuery, 'resource'>) {
    const s = this.requireRender(id);
    return this.render.listLogs({ ...query, resource: [s.render!.service_id] });
  }

  /** Últimas `limit` líneas de logs (texto plano, sin ANSI) desde que empezó el deploy actual. */
  async recentLogsText(
    id: string,
    type: 'build' | 'app',
    limit: number,
  ): Promise<string> {
    const s = this.get(id);
    if (!s.render) return '(todavía no hay servicio en Render)\n';
    const since = s.current_deploy
      ? new Date(
          new Date(s.current_deploy.started_at).getTime() - 5_000,
        ).toISOString()
      : new Date(Date.now() - 60 * 60_000).toISOString();
    const lines: { t: string; m: string }[] = [];
    let endTime = new Date().toISOString();
    while (lines.length < limit) {
      const page = await this.render.listLogs({
        resource: [s.render.service_id],
        type: [type],
        direction: 'backward',
        startTime: since,
        endTime,
        limit: Math.min(100, limit - lines.length),
      });
      for (const l of page.logs)
        lines.push({ t: l.timestamp, m: stripAnsi(l.message) });
      if (!page.hasMore || page.logs.length === 0) break;
      endTime = page.nextEndTime;
    }
    if (lines.length === 0)
      return `(sin logs de tipo ${type} desde ${since})\n`;
    return lines
      .reverse()
      .map((l) => `${l.t.slice(11, 19)} ${l.m}`)
      .join('\n')
      .concat('\n');
  }

  /**
   * Stream SSE de logs de la app (polling a la API de Render cada 3s).
   * Cada línea sale como `event: log` con { id, t, message, labels }.
   */
  logsStream(
    id: string,
    opts: { since?: string; type?: string[] },
  ): ReadableStream<string> {
    const s = this.requireRender(id);
    const serviceId = s.render!.service_id;
    let cursor = opts.since ?? new Date(Date.now() - 60_000).toISOString();
    const seen = new Set<string>();
    let stopped = false;
    let timer: NodeJS.Timeout;

    return new ReadableStream<string>({
      start: (controller) => {
        controller.enqueue(': connected\n\n');
        const tick = async () => {
          if (stopped) return;
          try {
            let page;
            do {
              page = await this.render.listLogs({
                resource: [serviceId],
                type: opts.type,
                direction: 'forward',
                startTime: cursor,
                endTime: new Date().toISOString(),
                limit: 100,
              });
              for (const line of page.logs) {
                if (seen.has(line.id)) continue;
                seen.add(line.id);
                const labels = Object.fromEntries(
                  line.labels.map((l) => [l.name, l.value]),
                );
                controller.enqueue(
                  `event: log\ndata: ${JSON.stringify({ id: line.id, t: line.timestamp, message: line.message, labels })}\n\n`,
                );
              }
              if (page.logs.length)
                cursor = page.logs[page.logs.length - 1].timestamp;
            } while (page.hasMore && !stopped);
            if (seen.size > 5000) seen.clear();
          } catch (err) {
            controller.enqueue(
              `event: error\ndata: ${JSON.stringify({ message: (err as Error).message })}\n\n`,
            );
          }
          if (!stopped) timer = setTimeout(tick, 3_000);
        };
        void tick();
      },
      cancel: () => {
        stopped = true;
        clearTimeout(timer);
      },
    });
  }

  async remove(id: string): Promise<SandboxRecord> {
    const s = this.get(id);
    if (s.status === 'deleted') return s;
    await this.agents.stop(id, 'Sandbox eliminado');
    const errors: string[] = [];
    if (s.render?.service_id) {
      await this.render
        .deleteService(s.render.service_id)
        .catch((e: Error) => errors.push(e.message));
    }
    if (s.database) {
      await this.databases
        .release(s.database)
        .catch((e: Error) => errors.push(e.message));
    }
    if (s.mirror_repo) await this.git.deleteMirror(s.mirror_repo);
    await this.git.removeWorkdir(id);
    this.events.emit(
      id,
      errors.length ? 'warning' : 'info',
      'Sandbox eliminado',
      errors.join('\n'),
    );
    return this.store.update(id, {
      status: 'deleted',
      error: errors.length ? errors.join('\n') : undefined,
    });
  }

  // ---------------------------------------------------------- internos

  private requireRender(id: string): SandboxRecord {
    const s = this.get(id);
    if (s.status === 'deleted')
      throw new ConflictException('El sandbox fue eliminado');
    if (!s.render)
      throw new ConflictException(
        'El sandbox todavía no tiene servicio en Render',
      );
    return s;
  }

  /** Encola `fn` detrás de cualquier otra operación del mismo sandbox y registra errores. */
  private runExclusive(id: string, fn: () => Promise<void>) {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(fn)
      .catch((err: Error) => this.handleFailure(id, err));
    this.locks.set(id, next);
    void next.finally(() => {
      if (this.locks.get(id) === next) this.locks.delete(id);
    });
  }

  private handleFailure(id: string, err: Error) {
    this.logger.error(`[${id}] ${err.message}`, err.stack);
    const s = this.store.get(id);
    if (!s || s.status === 'deleted') return;
    if (this.agentActive(s)) {
      // El agente sigue a cargo: ve el error en `deployer wait` / `context` y decide.
      this.store.update(id, { status: 'analyzing', error: err.message });
      this.events.emit(
        id,
        'warning',
        'El intento de deploy falló',
        err.message,
      );
      return;
    }
    // Si la app ya estaba arriba, un redeploy fallido no la bota: sigue sirviendo la versión anterior.
    const stillServing =
      s.status === 'deploying' && s.deploys.some((d) => d.status === 'live');
    this.store.update(id, {
      status: stillServing ? 'ready' : 'failed',
      error: err.message,
    });
    this.events.emit(
      id,
      'critical',
      stillServing ? 'Falló el redeploy' : 'Falló el deploy',
      err.message,
    );
  }

  private async deployAndFollow(
    id: string,
    reason: string,
    opts: { commitId?: string; clearCache?: boolean },
  ) {
    const s = this.get(id);
    const serviceId = s.render!.service_id;
    const triggered = await this.render.triggerDeploy(serviceId, opts);
    const deployId =
      triggered?.id ??
      (await this.waitForAnyDeploy(serviceId, s.current_deploy?.id));
    this.startDeploy(id, deployId, reason, opts.commitId ?? s.commit_sha);
    await this.followDeploy(id, deployId);
  }

  private startDeploy(
    id: string,
    deployId: string,
    reason: string,
    commitSha?: string,
  ) {
    const info: SandboxDeployInfo = {
      id: deployId,
      status: 'created',
      commit_sha: commitSha,
      reason,
      started_at: new Date().toISOString(),
    };
    this.store.update(id, (r) => {
      r.current_deploy = info;
      r.deploys.push(info);
    });
    this.events.emit(id, 'info', 'Deploy iniciado', `${deployId} (${reason})`, {
      deploy_id: deployId,
      reason,
    });
  }

  /** Hace polling del deploy hasta live/fallo y deja el sandbox en ready. */
  private async followDeploy(id: string, deployId: string) {
    const serviceId = this.get(id).render!.service_id;
    const started = Date.now();
    let lastStatus = '';
    for (;;) {
      const deploy = await this.render.getDeploy(serviceId, deployId);
      if (deploy.status !== lastStatus) {
        lastStatus = deploy.status;
        this.updateDeploy(id, deployId, { status: deploy.status });
        this.events.emit(
          id,
          'info',
          `Deploy: ${DEPLOY_LABELS[deploy.status] ?? deploy.status}`,
          deployId,
          {
            deploy_id: deployId,
            status: deploy.status,
          },
        );
      }
      if (deploy.status === 'live') break;
      if (DEPLOY_FAILED_STATUSES.has(deploy.status)) {
        this.updateDeploy(id, deployId, {
          finished_at: new Date().toISOString(),
        });
        throw new Error(
          `El deploy ${deployId} terminó en ${deploy.status}. Revisa los logs de build y de la app.`,
        );
      }
      if (Date.now() - started > DEPLOY_TIMEOUT_MS)
        throw new Error(`Timeout esperando el deploy ${deployId}`);
      await sleep(DEPLOY_POLL_MS);
    }
    this.updateDeploy(id, deployId, { finished_at: new Date().toISOString() });

    // Render a veces no devuelve la URL al crear; la refrescamos.
    if (!this.get(id).render?.url) {
      const svc = await this.render.getService(serviceId);
      this.store.update(id, (r) => {
        r.render!.url = svc.serviceDetails?.url;
      });
    }
    await this.waitHealthy(id);
    this.store.update(id, { status: 'ready', error: undefined });
    this.events.emit(
      id,
      'info',
      'Sandbox listo',
      this.get(id).render?.url ?? '',
      {
        deployed_url: this.get(id).render?.url,
        commit_sha: this.get(id).commit_sha,
      },
    );
  }

  /** Espera a que el healthcheck responda 2xx (los servicios free tardan en despertar). */
  private async waitHealthy(id: string) {
    const s = this.get(id);
    const url = s.render?.url;
    if (!url) return;
    const target = new URL(s.manifest?.healthcheck_path ?? '/', url).toString();
    const started = Date.now();
    while (Date.now() - started < HEALTH_TIMEOUT_MS) {
      try {
        const res = await fetch(target, {
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) return;
      } catch {
        // todavía no responde
      }
      await sleep(3_000);
    }
    this.events.emit(
      id,
      'warning',
      'Healthcheck sin respuesta',
      `${target} no respondió 2xx a tiempo`,
    );
  }

  private updateDeploy(
    id: string,
    deployId: string,
    patch: Partial<SandboxDeployInfo>,
  ) {
    this.store.update(id, (r) => {
      const d = r.deploys.find((x) => x.id === deployId);
      if (d) Object.assign(d, patch);
      if (r.current_deploy?.id === deployId)
        r.current_deploy = d ?? { ...r.current_deploy, ...patch };
    });
  }

  /** Cuando Render no devuelve el id del deploy, lo buscamos en el listado. */
  private async waitForAnyDeploy(
    serviceId: string,
    notId?: string,
  ): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const latest = await this.render.latestDeploy(serviceId);
      if (latest && latest.id !== notId) return latest.id;
      await sleep(2_000);
    }
    throw new Error(`Render no creó ningún deploy para ${serviceId}`);
  }
}

const DEPLOY_LABELS: Record<string, string> = {
  created: 'creado',
  queued: 'en cola',
  build_in_progress: 'construyendo',
  update_in_progress: 'actualizando',
  pre_deploy_in_progress: 'pre-deploy',
  live: 'en vivo',
  build_failed: 'falló el build',
  update_failed: 'falló la actualización',
  pre_deploy_failed: 'falló el pre-deploy',
  canceled: 'cancelado',
  deactivated: 'desactivado',
};

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
