import { scrubProviderText } from '../conductor/public-text.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { previewUrl } from '../preview/preview-proxy.js';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { agentConfigProblems, type Env } from '../config/env.js';
import { ConductorClient } from '../conductor/conductor.client.js';
import { DatabaseProvisioner } from '../sandboxes/database.provisioner.js';
import { SandboxEventsService } from '../sandboxes/sandbox-events.service.js';
import { SandboxesService } from '../sandboxes/sandboxes.service.js';
import { sandboxDisplayName } from '../sandboxes/sandbox.types.js';
import { nextBlockedReason } from './brain/facts.js';
import { buildSimPrompt } from './sim-prompts.js';
import { signSimToken } from './sim-token.js';
import { detectTools } from './tools-detector.js';
import { SimulationStore } from './simulation.store.js';
import {
  BASE_CHANNELS,
  NOTIFY_CHANNELS,
  SIM_ROLES,
  type IncidentState,
  type NotifyChannel,
  type SimActor,
  type SimContext,
  type SimRole,
  type SimStatus,
  type SimulationRecord,
  type TimelineEvent,
} from './simulation.types.js';
import {
  pendingFor,
  TimelineService,
  type AppendInput,
} from './timeline.service.js';

export interface CreateSimulationInput {
  repo_url?: string;
  sandbox_id?: string;
  hacker?: 'emulated' | 'external';
  /** Con repo_url: dueño del sandbox nuevo y si el repo es privado (ver src/auth). */
  owner?: { github_id: number; login: string };
  private_repo?: boolean;
  /** Forzar un sandbox nuevo en vez de reusar uno ya desplegado del mismo repo. */
  fresh_sandbox?: boolean;
}

export interface QuickActionInput {
  action: string;
  params: Record<string, unknown>;
  free_text?: string;
}

const ACTIVE: SimStatus[] = ['starting', 'ready', 'running', 'paused'];
/** Roles que pueden cambiar la app (código, env, datos, servicio). */
const OPERATORS: SimRole[] = ['coder', 'infra'];
/** Espera máxima por el agente de código y las alertas de apertura antes de dejar partir igual. */
const READY_WAIT_MS = 3 * 60_000;

/**
 * Orquestación de una simulación: un sandbox + un workspace de Conductor con
 * un thread por rol, coordinados por el timeline. Este servicio es la única
 * puerta para cambiar el estado; el dispatcher solo despierta threads.
 */
@Injectable()
export class SimulationsService implements OnModuleInit {
  private readonly logger = new Logger(SimulationsService.name);
  private readonly bridged = new Map<string, () => void>();
  private readonly launching = new Set<string>();

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly store: SimulationStore,
    private readonly timeline: TimelineService,
    private readonly sandboxes: SandboxesService,
    private readonly sandboxEvents: SandboxEventsService,
    private readonly conductor: ConductorClient,
    private readonly databases: DatabaseProvisioner,
  ) {}

  onModuleInit() {
    for (const s of this.store.list()) {
      if (!ACTIVE.includes(s.status)) continue;
      this.bridgeSandbox(s);
      // Simulaciones creadas antes de la detección determinista.
      if (s.deploy_ready_at && !s.tools_detected) void this.scanTools(s.sim_id);
    }
  }

  // ------------------------------------------------------------ consultas

  list() {
    return this.store.list().map((s) => this.toView(s));
  }

  /** Dueño de la simulación = dueño de su sandbox (undefined si no tiene). */
  ownerOf(s: SimulationRecord) {
    try {
      return this.sandboxes.get(s.sandbox_id).owner;
    } catch {
      return undefined;
    }
  }

  records(): SimulationRecord[] {
    return this.store.list();
  }

  get(id: string): SimulationRecord {
    const s = this.store.get(id);
    if (!s) throw new NotFoundException(`Simulación ${id} no existe`);
    return s;
  }

  active(): SimulationRecord[] {
    return this.store.list().filter((s) => ACTIVE.includes(s.status));
  }

  channels(s: SimulationRecord): NotifyChannel[] {
    const wanted = s.tools_detected ?? [];
    const valid = wanted.filter((t): t is NotifyChannel =>
      (NOTIFY_CHANNELS as readonly string[]).includes(t),
    );
    return [...new Set([...BASE_CHANNELS, ...valid])];
  }

  toView(s: SimulationRecord) {
    const sbx = this.sandboxes
      .list()
      .find((x) => x.sandbox_id === s.sandbox_id);
    const previewTemplate = this.config.get('PREVIEW_URL_TEMPLATE', {
      infer: true,
    });
    return {
      sim_id: s.sim_id,
      status: s.status,
      error: scrubProviderText(s.error) ?? null,
      repo_url: s.repo_url,
      sandbox: sbx
        ? {
            sandbox_id: sbx.sandbox_id,
            name: sandboxDisplayName(sbx),
            status: sbx.status,
            deployed_url: sbx.render?.url ?? null,
            /** La misma app servida por el proxy de preview (embebible con cookies). */
            preview_url:
              previewTemplate && sbx.render?.url
                ? previewUrl(previewTemplate, sbx.sandbox_id)
                : null,
            commit_sha: sbx.commit_sha ?? null,
            seed_users: sbx.manifest?.seed_users ?? [],
          }
        : {
            sandbox_id: s.sandbox_id,
            name: sandboxDisplayName({ repo_url: s.repo_url }),
            status: 'unknown',
            deployed_url: null,
            preview_url: null,
            commit_sha: null,
            seed_users: [],
          },
      hacker_mode: s.hacker_mode,
      engine_driven: Boolean(s.engine_driven),
      // Vista pública: sin ids, links ni nombres del proveedor de agentes (quedan en el store).
      threads: s.threads.map(
        ({
          role,
          mode,
          wakes,
          cursor,
          create_error,
          model,
          last_ms,
          last_error,
        }) => ({
          role,
          mode: mode === 'conductor' ? 'agent' : mode,
          wakes,
          cursor,
          create_error: create_error ? 'No se pudo preparar este agente' : null,
          model: model ?? null,
          last_ms: last_ms ?? null,
          last_error: last_error ?? null,
        }),
      ),
      channels: this.channels(s),
      tools_detected: s.tools_detected ?? null,
      context: this.contextView(s),
      attack_plan: s.attack_plan ?? null,
      engine: engineView(s),
      state: s.state ?? null,
      debrief: s.debrief ?? null,
      report: s.report
        ? {
            status: s.report.status,
            verdict: s.report.result?.verdict ?? null,
            rank: s.report.result?.rank ?? null,
            degraded: s.report.degraded ?? false,
          }
        : null,
      events: s.timeline.length,
      last_seq: s.next_seq - 1,
      created_at: s.created_at,
      updated_at: s.updated_at,
    };
  }

  // -------------------------------------------------------------- crear

  create(input: CreateSimulationInput) {
    const problems = agentConfigProblems({
      AGENT_API_SECRET: this.config.get('AGENT_API_SECRET', { infer: true }),
      PUBLIC_BACKEND_URL: this.config.get('PUBLIC_BACKEND_URL', {
        infer: true,
      }),
      CONDUCTOR_API_KEY: this.config.get('CONDUCTOR_API_KEY', { infer: true }),
      GITHUB_TOKEN: this.config.get('GITHUB_TOKEN', { infer: true }),
    } as Env);
    if (problems.length)
      throw new ConflictException(
        `Las simulaciones necesitan: ${problems.join(', ')}`,
      );

    let sandboxId = input.sandbox_id;
    let repoUrl = input.repo_url;
    if (sandboxId) {
      const sbx = this.sandboxes.get(sandboxId);
      if (sbx.status === 'deleted')
        throw new ConflictException(`El sandbox ${sandboxId} fue eliminado`);
      repoUrl = sbx.repo_url;
    } else if (repoUrl) {
      // Reusar un sandbox ya "ready" del mismo repo (y dueño) evita re-desplegar
      // en Render entre simulacros: es más rápido y no gasta cuota. Con
      // fresh_sandbox se fuerza uno nuevo para partir de estado limpio.
      const reusable = input.fresh_sandbox
        ? undefined
        : this.sandboxes.findReusable({
            repo_url: repoUrl,
            owner: input.owner,
          });
      if (reusable) {
        sandboxId = reusable.sandbox_id;
        this.logger.log(
          `Reusando sandbox ${sandboxId} para ${repoUrl} (sin re-desplegar)`,
        );
      } else {
        sandboxId = this.sandboxes.create({
          repo_url: repoUrl,
          mode: 'auto',
          owner: input.owner,
          private_repo: input.private_repo,
        }).sandbox_id;
      }
    } else {
      throw new BadRequestException('Indica repo_url o sandbox_id');
    }

    const now = new Date().toISOString();
    // Con el motor real configurado, el hacker es el motor (salvo que se pida el emulado).
    const engineReady = Boolean(
      this.config.get('ENGINE_URL', { infer: true }) &&
      this.config.get('ENGINE_MODAL_KEY', { infer: true }) &&
      this.config.get('ENGINE_MODAL_SECRET', { infer: true }),
    );
    const hackerMode = input.hacker ?? (engineReady ? 'external' : 'emulated');
    // El rol hacker lo opera el motor interno (EngineHacker), no alguien de afuera.
    const engineDriven = !input.hacker && engineReady;
    const sim = this.store.insert({
      sim_id: `sim-${randomBytes(4).toString('hex')}`,
      sandbox_id: sandboxId,
      repo_url: repoUrl!,
      status: 'starting',
      created_at: now,
      updated_at: now,
      hacker_mode: hackerMode,
      ...(engineDriven ? { engine_driven: true } : {}),
      threads: SIM_ROLES.map((role) => ({
        role,
        mode:
          role === 'hacker' && hackerMode === 'external'
            ? 'external'
            : this.apiRoles().includes(role)
              ? 'api'
              : 'conductor',
        cursor: 0,
        wakes: 0,
      })),
      next_seq: 1,
      timeline: [],
    });
    this.system(
      sim.sim_id,
      'sim.status',
      'Preparando la simulación',
      `Repo ${repoUrl}`,
      { status: 'starting' },
    );
    this.bridgeSandbox(sim);
    void this.launch(sim.sim_id);
    return {
      ...this.toView(sim),
      // Para un motor de hacking externo (rol hacker vía HTTP). Solo si se pidió
      // explícitamente: el token sirve para cualquier rol (x-sim-role es declarado).
      ...(hackerMode === 'external' && !engineDriven
        ? { hacker_token: this.token(sim.sim_id) }
        : {}),
    };
  }

  /** Crea el workspace (con el thread infra) y luego el resto de los threads. */
  async launch(simId: string) {
    if (this.launching.has(simId)) return;
    this.launching.add(simId);
    try {
      const s = this.get(simId);
      // La VM nace con la primera sesión de Conductor (infra, o hacker si infra corre en la API).
      const first = s.threads.find((t) => t.mode === 'conductor');
      if (!s.workspace_id && first) {
        const ws = await this.conductor.createWorkspace({
          name: `sim ${simId}`,
          sessionName: first.role,
          message: buildSimPrompt(this.promptVars(s, first.role)),
          env: {
            SIM_ID: simId,
            SIM_URL: this.publicUrl(),
            SIM_TOKEN: this.token(simId),
          },
        });
        this.store.update(simId, (r) => {
          r.workspace_id = ws.workspaceId;
          delete r.error; // un intento anterior pudo haber fallado
          r.workspace_link = ws.deepLink.replace(/&session=.*$/, '');
          const t = r.threads.find((x) => x.role === first.role)!;
          t.session_id = ws.sessionId;
          t.deep_link = ws.deepLink;
        });
        this.system(simId, 'agent.note', 'Agentes listos', '', {});
      }
      await this.createMissingThreads(simId);
    } catch (err) {
      this.logger.error(`[${simId}] launch: ${(err as Error).message}`);
      this.store.update(simId, {
        error: 'No se pudieron preparar los agentes de la simulación',
      });
    } finally {
      this.launching.delete(simId);
    }
  }

  async createMissingThreads(simId: string) {
    const s = this.get(simId);
    if (!s.workspace_id) return;
    for (const t of s.threads) {
      if (t.mode !== 'conductor' || t.session_id) continue;
      try {
        const session = await this.conductor.createSession({
          workspaceId: s.workspace_id,
          name: t.role,
          message: buildSimPrompt(this.promptVars(s, t.role)),
        });
        this.store.update(simId, (r) => {
          const x = r.threads.find((y) => y.role === t.role)!;
          x.session_id = session.id;
          x.deep_link = session.deepLink;
          delete x.create_error;
        });
      } catch (err) {
        this.store.update(simId, (r) => {
          r.threads.find((y) => y.role === t.role)!.create_error = (
            err as Error
          ).message;
        });
      }
    }
  }

  /** Roles que corren en el backend con la API de Claude (solo si hay ANTHROPIC_API_KEY). */
  apiRoles(): SimRole[] {
    if (!this.config.get('ANTHROPIC_API_KEY', { infer: true })) return [];
    const allowed: SimRole[] = ['infra', 'observer', 'generator'];
    return this.config
      .get('SIM_API_ROLES', { infer: true })
      .split(',')
      .map((r) => r.trim() as SimRole)
      .filter((r) => allowed.includes(r));
  }

  private promptVars(s: SimulationRecord, role: SimRole) {
    return {
      simId: s.sim_id,
      repoUrl: s.repo_url,
      role,
      conductorRoles: s.threads
        .filter((t) => t.mode === 'conductor')
        .map((t) => t.role),
    };
  }

  get launchingIds(): ReadonlySet<string> {
    return this.launching;
  }

  // ------------------------------------------------- acciones del usuario

  start(id: string) {
    const s = this.get(id);
    if (s.status !== 'ready') {
      const missing = this.readyMissing(s);
      throw new ConflictException(
        s.status === 'starting'
          ? `Todavía falta: ${missing.join(' y ')}`
          : `La simulación está ${s.status}`,
      );
    }
    this.post(id, 'user', {
      type: 'control.start',
      title: 'El developer partió la simulación',
    });
    return this.toView(this.get(id));
  }

  control(
    id: string,
    action: 'next' | 'pause' | 'resume' | 'verify' | 'finish',
    vulnId?: string,
    reason?: string,
  ) {
    const s = this.get(id);
    if (!['running', 'paused'].includes(s.status))
      throw new ConflictException(`La simulación está ${s.status}`);
    // Pausar lo pausado o reanudar lo que corre no hace nada (Hinty se abre y cierra seguido).
    if (
      (action === 'pause' && s.status === 'paused') ||
      (action === 'resume' && s.status === 'running')
    )
      return this.toView(s);
    if (action === 'next') {
      const blocked = nextBlockedReason(s);
      if (blocked) throw new ConflictException(blocked);
    }
    this.post(id, 'user', {
      type: `control.${action}`,
      title:
        reason === 'hinty'
          ? action === 'pause'
            ? 'En pausa: hablando con Hinty'
            : 'Hinty se cerró: el incidente continúa'
          : `${action}${vulnId ? ` ${vulnId}` : ''} (developer)`,
      vuln_id: vulnId,
      raw: {
        ...(vulnId ? { vuln_id: vulnId } : {}),
        ...(reason ? { reason } : {}),
      },
    });
    return this.toView(this.get(id));
  }

  message(id: string, text: string) {
    this.requireActive(id);
    return this.post(id, 'user', {
      type: 'user.message',
      title: firstLine(text),
      body: text,
    });
  }

  /**
   * Deja en el timeline una pregunta a Hinty hecha con el incidente en curso, para el
   * reporte (modo instructor y pestaña "Uso de Hinty"). Interno: no se le muestra al
   * developer ni despierta a ningún agente. Nunca guarda la captura, solo el texto.
   */
  recordHinty(
    id: string,
    input: {
      question: string;
      stepDone: boolean;
      walkGoal?: string;
      marks: number;
      guided: boolean;
      beats: number;
    },
  ) {
    const s = this.store.get(id);
    if (!s || !['running', 'paused'].includes(s.status)) return null;
    return this.system(
      id,
      'hinty.question',
      input.stepDone ? 'Hinty: siguiente paso de la guía' : 'Pregunta a Hinty',
      input.question,
      {
        question: input.question,
        step_done: input.stepDone,
        ...(input.walkGoal ? { walk_goal: input.walkGoal } : {}),
        marks: input.marks,
        guided: input.guided,
        beats: input.beats,
      },
    );
  }

  /** Acciones rápidas (botones). Las deterministas se ejecutan acá; el resto se delega al agente de código. */
  action(id: string, input: QuickActionInput) {
    const s = this.requireActive(id);
    const event = this.post(id, 'user', {
      type: 'user.action',
      title: ACTION_LABELS[input.action]?.(input.params) ?? input.action,
      body: input.free_text ?? '',
      raw: { action: input.action, params: input.params },
    });
    switch (input.action) {
      case 'rotate_secret': {
        const key = str(input.params.key, 'JWT_SECRET');
        this.changeEnv(s, 'user', { generate: [key] });
        break;
      }
      case 'set_env':
        this.changeEnv(s, 'user', {
          env: input.params.env as Record<string, string>,
        });
        break;
      case 'restart':
        this.restart(id, 'user');
        break;
      case 'redeploy':
        this.sandboxes.redeploy(s.sandbox_id, {});
        this.system(id, 'change.restart', 'Redeploy sin cambios', '', {
          by: 'user',
          kind: 'redeploy',
        });
        break;
      default:
        // rotate_password, revoke_sessions, block_ip, custom…: dependen de la app → los hace el agente de código.
        this.post(id, 'user', {
          type: 'user.message',
          title: `Acción: ${event.title}`,
          body:
            `${input.free_text ? `${input.free_text}\n\n` : ''}` +
            `(Acción rápida "${input.action}" con params ${JSON.stringify(input.params)}. Ejecútala en la app.)`,
        });
    }
    return event;
  }

  /** La simulación no puede seguir (p. ej. el workspace de Conductor se cayó). */
  fail(id: string, why: string) {
    const s = this.get(id);
    if (!ACTIVE.includes(s.status)) return;
    this.store.update(id, { error: why });
    this.setStatus(id, 'failed', why);
  }

  async stop(id: string, opts: { delete_sandbox?: boolean } = {}) {
    const s = this.get(id);
    if (s.workspace_id) {
      await this.conductor
        .archiveWorkspace(s.workspace_id)
        .catch((e: Error) =>
          this.logger.warn(
            `No se pudo archivar ${s.workspace_id}: ${e.message}`,
          ),
        );
    }
    if (opts.delete_sandbox)
      await this.sandboxes.remove(s.sandbox_id).catch(() => undefined);
    this.bridged.get(id)?.();
    this.bridged.delete(id);
    if (s.status !== 'finished')
      this.setStatus(id, 'stopped', 'Simulación detenida');
    return this.toView(this.get(id));
  }

  // --------------------------------------------- operaciones de los agentes

  agentContext(id: string, role: SimRole) {
    const s = this.get(id);
    const view = this.toView(s);
    const thread = s.threads.find((t) => t.role === role)!;
    return {
      you: role,
      sim_id: s.sim_id,
      status: s.status,
      repo_url: s.repo_url,
      // El coder no ve las contraseñas de los usuarios: las citaba y adelantaba la vuln de clave débil.
      app:
        role === 'coder'
          ? {
              ...view.sandbox,
              seed_users: view.sandbox.seed_users.map(
                ({ password: _omit, ...u }) => u,
              ),
            }
          : view.sandbox,
      channels: view.channels,
      context: view.context,
      // El agente de código solo sabe lo que sabe el developer.
      ...(role === 'coder'
        ? {}
        : { attack_plan: s.attack_plan ?? null, state: s.state ?? null }),
      threads: s.threads.map((t) => t.role),
      your_cursor: thread.cursor,
      last_seq: s.next_seq - 1,
    };
  }

  inbox(id: string, role: SimRole) {
    const s = this.get(id);
    const thread = s.threads.find((t) => t.role === role)!;
    const events = pendingFor(s.timeline, role, thread.cursor);
    if (events.length) this.advanceCursor(id, role, events.at(-1)!.seq);
    return { events };
  }

  timelineFor(
    id: string,
    role: SimRole,
    q: { since?: number; types?: string[]; limit?: number },
  ) {
    this.get(id);
    return {
      events: this.timeline.list(id, {
        ...q,
        view: role === 'coder' ? 'user' : 'all',
      }),
    };
  }

  advanceCursor(id: string, role: SimRole, seq: number) {
    this.store.update(id, (r) => {
      const t = r.threads.find((x) => x.role === role)!;
      t.cursor = Math.max(t.cursor, seq);
    });
  }

  postFromAgent(id: string, role: SimRole, input: AppendInput) {
    this.get(id);
    return this.post(id, role, input);
  }

  sourceArchive(id: string) {
    return this.sandboxes.archiveSource(this.get(id).sandbox_id);
  }

  logs(id: string, type: 'build' | 'app', limit: number) {
    return this.sandboxes.recentLogsText(this.get(id).sandbox_id, type, limit);
  }

  async deployStatus(id: string, waitSeconds: number) {
    const s = this.get(id);
    if (waitSeconds > 0)
      await this.sandboxes.waitIdle(s.sandbox_id, waitSeconds * 1000);
    const sbx = this.sandboxes.get(s.sandbox_id);
    return {
      status: sbx.status,
      busy: this.sandboxes.isBusy(s.sandbox_id),
      deployed_url: sbx.render?.url ?? null,
      commit_sha: sbx.commit_sha ?? null,
      error: sbx.error ?? null,
      current_deploy: sbx.current_deploy ?? null,
      seed_users: sbx.manifest?.seed_users ?? [],
    };
  }

  pushChanges(
    id: string,
    role: SimRole,
    change: { patch: string; message: string },
  ) {
    const s = this.requireOperator(id, role);
    const files = [...change.patch.matchAll(/^diff --git a\/(\S+) b\//gm)].map(
      (m) => m[1],
    );
    this.sandboxes.redeploy(s.sandbox_id, {
      patch: change.patch,
      message: change.message,
    });
    this.system(id, 'change.commit', change.message, files.join(', '), {
      by: role,
      files,
    });
    return { accepted: true, files, status: 'deploying' };
  }

  setEnv(
    id: string,
    role: SimRole,
    body: {
      env?: Record<string, string>;
      generate?: string[];
      unset?: string[];
    },
  ) {
    const s = this.requireOperator(id, role);
    this.changeEnv(s, role, body);
    return { accepted: true, status: 'deploying' };
  }

  restart(id: string, role: SimActor) {
    const s =
      role === 'user'
        ? this.get(id)
        : this.requireOperator(id, role as SimRole);
    this.sandboxes.restart(s.sandbox_id);
    this.system(id, 'change.restart', 'Reinicio del servicio', '', {
      by: role,
      kind: 'restart',
    });
    return { accepted: true, status: 'deploying' };
  }

  async runSql(id: string, role: SimRole, sql: string) {
    const s = this.requireOperator(id, role);
    const sbx = this.sandboxes.get(s.sandbox_id);
    if (!sbx.database)
      throw new ConflictException(
        'Esta app no tiene base de datos administrada por el sandbox',
      );
    const { external_url } = await this.databases.urlsFor(sbx.database);
    const client = new pg.Client({
      connectionString: external_url,
      ssl: { rejectUnauthorized: false },
      statement_timeout: 15_000,
      connectionTimeoutMillis: 15_000,
    });
    await client.connect();
    try {
      const res = await client.query(sql);
      const results = Array.isArray(res) ? res : [res];
      const out = results.map((r: pg.QueryResult) => ({
        command: r.command,
        rowCount: r.rowCount,
        rows: (r.rows ?? []).slice(0, 100),
        truncated: (r.rows?.length ?? 0) > 100,
      }));
      const mutating = out.filter(
        (r) => r.command && !['SELECT', 'SHOW', 'EXPLAIN'].includes(r.command),
      );
      if (mutating.length) {
        this.system(
          id,
          'change.db',
          `Cambio en la base: ${mutating.map((r) => `${r.command} (${r.rowCount})`).join(', ')}`,
          sql.slice(0, 2000),
          {
            by: role,
            sql: sql.slice(0, 4000),
            results: mutating.map(({ command, rowCount }) => ({
              command,
              rowCount,
            })),
          },
        );
      }
      return out.length === 1 ? out[0] : out;
    } catch (err) {
      throw new BadRequestException(`SQL falló: ${(err as Error).message}`);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  // ------------------------------------------- puente con el servicio de deploy

  /**
   * Detecta transiciones del sandbox y las convierte en eventos del timeline:
   * primer deploy (deploy.ready / deploy.failed) y redeploys (change.deployed /
   * change.deploy_failed). Lo llama el dispatcher en cada tick.
   */
  syncSandbox(simId: string) {
    const s = this.get(simId);
    let sbx;
    try {
      sbx = this.sandboxes.get(s.sandbox_id);
    } catch {
      return;
    }
    const prev = s.sandbox_status;
    const now = sbx.status;
    if (prev === now) return;
    this.store.update(simId, { sandbox_status: now });

    if (!s.deploy_ready_at) {
      if (now === 'ready') {
        this.store.update(simId, {
          deploy_ready_at: new Date().toISOString(),
          sandbox_commit: sbx.commit_sha,
        });
        this.system(
          simId,
          'deploy.ready',
          'La app está desplegada',
          sbx.render?.url ?? '',
          {
            deployed_url: sbx.render?.url,
            commit_sha: sbx.commit_sha,
            seed_users: sbx.manifest?.seed_users ?? [],
          },
        );
        void this.scanTools(simId);
        this.maybeReady(simId);
      } else if (now === 'failed') {
        this.system(
          simId,
          'deploy.failed',
          'No se pudo desplegar la app',
          sbx.error ?? '',
          {},
          'critical',
        );
        this.setStatus(simId, 'failed', `Falló el deploy: ${sbx.error ?? ''}`);
      }
      return;
    }
    if (prev === 'deploying' && (now === 'ready' || now === 'failed')) {
      const ok = now === 'ready' && !sbx.error;
      this.store.update(simId, { sandbox_commit: sbx.commit_sha });
      this.system(
        simId,
        ok ? 'change.deployed' : 'change.deploy_failed',
        ok ? 'Cambio desplegado' : 'Falló el redeploy',
        ok
          ? `${sbx.render?.url ?? ''} (commit ${sbx.commit_sha?.slice(0, 7) ?? '?'})`
          : (sbx.error ?? ''),
        {
          commit_sha: sbx.commit_sha,
          reason: sbx.current_deploy?.reason,
          still_serving_previous: !ok && now === 'ready',
        },
        ok ? 'info' : 'warning',
      );
    }
  }

  // ------------------------------------------------------------ internos

  /** Publica un evento y aplica sus efectos sobre el estado de la simulación. */
  private post(id: string, actor: SimActor, input: AppendInput): TimelineEvent {
    const event = this.timeline.append(id, actor, input);
    this.applyEffects(id, event);
    return event;
  }

  private system(
    id: string,
    type: string,
    title: string,
    body = '',
    raw: Record<string, unknown> = {},
    severity: TimelineEvent['severity'] = 'info',
  ) {
    return this.timeline.append(
      id,
      'system',
      { type, title, body, raw, severity },
      { trusted: true },
    );
  }

  private applyEffects(id: string, e: TimelineEvent) {
    switch (e.type) {
      case 'context.ready':
        this.store.update(id, { context: e.raw as SimContext });
        break;
      case 'attack.plan':
        this.store.update(id, { attack_plan: e.raw });
        this.maybeReady(id);
        break;
      case 'state.update':
        this.store.update(id, { state: e.raw as IncidentState });
        break;
      case 'sim.finished':
        this.store.update(id, { debrief: e.raw });
        this.setStatus(id, 'finished', 'Simulación terminada');
        break;
      case 'control.start':
        this.setStatus(id, 'running', 'El incidente está en curso');
        break;
      case 'control.pause':
        if (this.get(id).status === 'running')
          this.setStatus(id, 'paused', 'Atacante en pausa');
        break;
      case 'control.resume':
        if (this.get(id).status === 'paused')
          this.setStatus(id, 'running', 'El incidente continúa');
        break;
    }
  }

  /**
   * Detecta en el código del sandbox qué herramientas de monitoreo tiene el
   * developer (Sentry, PostHog…). Solo esas se simulan, además de los canales base.
   */
  private async scanTools(simId: string) {
    const s = this.get(simId);
    let tools: string[] = [];
    try {
      const dir = await this.sandboxes.sourceDir(s.sandbox_id);
      tools = await detectTools(dir);
    } catch (err) {
      this.logger.warn(
        `No se pudieron detectar herramientas en ${s.sandbox_id}: ${(err as Error).message}`,
      );
    }
    this.store.update(simId, { tools_detected: tools });
    this.system(
      simId,
      'agent.note',
      tools.length
        ? `Herramientas detectadas en el repo: ${tools.join(', ')}`
        : 'El repo no tiene herramientas de monitoreo configuradas',
      `Canales activos: ${this.channels(this.get(simId)).join(', ')}`,
      { tools_detected: tools },
    );
    this.maybeReady(simId);
  }

  /** El contexto del infra, con las herramientas detectadas por el backend (no las del LLM). */
  private contextView(s: SimulationRecord) {
    if (!s.context) return null;
    return { ...s.context, tools_detected: s.tools_detected ?? [] };
  }

  private maybeReady(id: string) {
    this.checkReady(id);
  }

  /**
   * La simulación queda lista (botón para partir) recién cuando TODOS los agentes
   * pueden partir: app arriba, herramientas, plan del atacante, contexto, el agente de
   * código en línea y las alertas de apertura escritas. Así, al partir, todo arranca
   * al tiro. Si algo de lo último se demora más de READY_WAIT_MS, se parte igual.
   */
  checkReady(id: string) {
    const s = this.store.get(id);
    if (!s || s.status !== 'starting') return;
    const missing = this.readyMissing(s);
    const base =
      s.deploy_ready_at && s.tools_detected && s.attack_plan && s.context;
    if (base && !s.ready_wait_since)
      this.store.update(id, { ready_wait_since: new Date().toISOString() });
    const waited =
      base &&
      s.ready_wait_since &&
      Date.now() - Date.parse(s.ready_wait_since) > READY_WAIT_MS;
    if (missing.length && !waited) return;
    if (missing.length)
      this.system(
        id,
        'agent.note',
        `Se parte sin esperar: ${missing.join(', ')}`,
        '',
      );
    this.setStatus(id, 'ready', 'Todo listo: los agentes están en posición');
  }

  /** Qué falta para poder partir (vacío = listo). */
  readyMissing(s: SimulationRecord): string[] {
    const coder = s.threads.find((t) => t.role === 'coder');
    const coderReady =
      !coder ||
      coder.mode !== 'conductor' ||
      s.timeline.some((e) => e.type === 'coder.reply');
    const generatorApi = s.threads.some(
      (t) => t.role === 'generator' && t.mode === 'api',
    );
    const openingReady =
      !generatorApi ||
      ['ready', 'failed', 'skipped'].includes(s.opening?.status ?? '');
    return [
      !s.deploy_ready_at && 'la app desplegada',
      !s.tools_detected && 'revisar las herramientas del repo',
      !s.attack_plan && 'el plan del atacante',
      !s.context && 'el contexto de la app',
      !coderReady && 'tu agente de código',
      !openingReady && 'las primeras alertas',
    ].filter((x): x is string => Boolean(x));
  }

  private setStatus(id: string, status: SimStatus, title: string) {
    this.store.update(id, { status });
    this.system(id, 'sim.status', title, '', { status });
  }

  private changeEnv(
    s: SimulationRecord,
    by: SimActor,
    body: {
      env?: Record<string, string>;
      generate?: string[];
      unset?: string[];
    },
  ) {
    this.sandboxes.setEnv(s.sandbox_id, body);
    const keys = [
      ...Object.keys(body.env ?? {}),
      ...(body.generate ?? []),
      ...(body.unset ?? []),
    ];
    const parts = [
      body.env && `cambió ${Object.keys(body.env).join(', ')}`,
      body.generate?.length && `rotó ${body.generate.join(', ')}`,
      body.unset?.length && `eliminó ${body.unset.join(', ')}`,
    ].filter(Boolean);
    this.system(
      s.sim_id,
      'change.env',
      `Variables: ${parts.join('; ')}`,
      'Redeploy en curso para aplicarlas',
      {
        by,
        keys,
        set: Object.keys(body.env ?? {}),
        generate: body.generate ?? [],
        unset: body.unset ?? [],
      },
    );
  }

  private requireActive(id: string) {
    const s = this.get(id);
    if (!ACTIVE.includes(s.status))
      throw new ConflictException(`La simulación está ${s.status}`);
    return s;
  }

  private requireOperator(id: string, role: SimRole) {
    if (!OPERATORS.includes(role))
      throw new ForbiddenException(`El rol ${role} no puede modificar la app`);
    return this.requireActive(id);
  }

  /** Reenvía los eventos del servicio de deploy al timeline (internos). */
  private bridgeSandbox(s: SimulationRecord) {
    if (this.bridged.has(s.sim_id)) return;
    const off = this.sandboxEvents.subscribe(s.sandbox_id, (e) => {
      if (
        !this.store.get(s.sim_id) ||
        !ACTIVE.includes(this.get(s.sim_id).status)
      )
        return;
      this.timeline.append(
        s.sim_id,
        'system',
        {
          type: 'deploy.progress',
          title: e.title,
          body: e.body,
          severity: e.severity,
          raw: { source: e.source },
        },
        { trusted: true },
      );
    });
    this.bridged.set(s.sim_id, off);
  }

  private token(simId: string) {
    return signSimToken(
      this.config.get('AGENT_API_SECRET', { infer: true })!,
      simId,
    );
  }

  private publicUrl() {
    return this.config
      .get('PUBLIC_BACKEND_URL', { infer: true })!
      .replace(/\/+$/, '');
  }
}

const ACTION_LABELS: Record<string, (p: Record<string, unknown>) => string> = {
  rotate_secret: (p) => `Rotar ${str(p.key, 'JWT_SECRET')}`,
  set_env: (p) =>
    `Cambiar variables: ${Object.keys((p.env as object) ?? {}).join(', ')}`,
  restart: () => 'Reiniciar el servicio',
  redeploy: () => 'Redesplegar',
  rotate_password: (p) =>
    `Cambiar la contraseña de ${str(p.email ?? p.user, 'un usuario')}`,
  revoke_sessions: () => 'Cerrar todas las sesiones',
  block_ip: (p) => `Bloquear la IP ${str(p.ip, '')}`,
  maintenance: () => 'Poner la app en mantenimiento',
  custom: () => 'Acción personalizada',
};

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : fallback;
}

function firstLine(s: string): string {
  return (s.split('\n').find((x) => x.trim()) ?? s).slice(0, 100);
}

/** Lo que ve el frontend del motor real (sin la repetición completa, que pesa). */
function engineView(s: SimulationRecord) {
  const e = s.engine;
  if (!e) return null;
  return {
    status: e.status,
    error: e.error ?? null,
    started_at: e.started_at,
    finished_at: e.finished_at ?? null,
    log: e.log.slice(-80),
    summary: e.summary ?? null,
    findings: e.findings ?? [],
    selected: e.selected ?? null,
    played: e.played,
    current: e.current ?? null,
    verifies: e.verifies.map(({ vuln_id, status, requested_at, error }) => ({
      vuln_id,
      status,
      requested_at,
      error: error ?? null,
    })),
  };
}
