import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { agentConfigProblems, type Env } from '../config/env.js';
import { ConductorClient } from '../conductor/conductor.client.js';
import { SandboxEventsService } from '../sandboxes/sandbox-events.service.js';
import { SandboxStore } from '../sandboxes/sandbox.store.js';
import type { SandboxManifest } from '../sandboxes/manifest.js';
import type {
  InputRequest,
  SandboxRecord,
} from '../sandboxes/sandbox.types.js';
import { buildAgentPrompt } from './agent-prompt.js';
import { signAgentToken } from './agent-token.js';

const MONITOR_MS = 20_000;
/** Cuánto tiempo puede estar la sesión idle sin reportar antes de insistir / rendirse. */
const IDLE_GRACE_MS = 60_000;
const AGENT_TIMEOUT_MS = 60 * 60_000;

/**
 * Agente de deploy: cuando el camino determinista no alcanza, crea un
 * workspace de Conductor (una VM por sandbox) con un brief y un token
 * acotado al sandbox. El agente trabaja contra /agent/sandboxes/:id/*
 * y este orquestador vigila la sesión para que nada quede colgado.
 */
@Injectable()
export class AgentOrchestrator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentOrchestrator.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly conductor: ConductorClient,
    private readonly store: SandboxStore,
    private readonly events: SandboxEventsService,
  ) {}

  onModuleInit() {
    const problems = this.problems();
    if (problems.length) {
      this.logger.warn(
        `Fallback agéntico deshabilitado. Falta: ${problems.join(', ')}`,
      );
    }
    this.timer = setInterval(() => void this.monitor(), MONITOR_MS);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  problems(): string[] {
    return agentConfigProblems({
      AGENT_API_SECRET: this.config.get('AGENT_API_SECRET', { infer: true }),
      PUBLIC_BACKEND_URL: this.config.get('PUBLIC_BACKEND_URL', {
        infer: true,
      }),
      CONDUCTOR_API_KEY: this.config.get('CONDUCTOR_API_KEY', { infer: true }),
      GITHUB_TOKEN: this.config.get('GITHUB_TOKEN', { infer: true }),
    } as Env);
  }

  assertConfigured() {
    const problems = this.problems();
    if (problems.length) {
      throw new ServiceUnavailableException(
        `El agente de deploy no está configurado. Falta: ${problems.join(', ')}`,
      );
    }
  }

  get maxPlans(): number {
    return this.config.get('AGENT_MAX_PLANS', { infer: true });
  }

  /** Lanza el agente para un sandbox (ya clonado y con mirror). */
  async start(id: string, reason: string): Promise<void> {
    const problems = this.problems();
    if (problems.length) {
      throw new Error(
        `${reason}. El fallback con IA no está disponible (falta ${problems.join(', ')}).`,
      );
    }
    const s = this.store.get(id)!;
    const secret = this.config.get('AGENT_API_SECRET', { infer: true })!;
    const publicUrl = this.config
      .get('PUBLIC_BACKEND_URL', { infer: true })!
      .replace(/\/+$/, '');

    this.store.update(id, { status: 'analyzing' });
    this.events.emit(id, 'info', 'Lanzando agente de IA', reason, {}, 'agent');

    const ws = await this.conductor.createWorkspace({
      name: `deploy ${id}`,
      sessionName: `Deploy ${s.repo_url.replace('https://github.com/', '')}`,
      message: buildAgentPrompt({
        sandboxId: id,
        repoUrl: s.repo_url,
        reason,
        previousManifest: s.manifest_source ? s.manifest : undefined,
        maxPlans: this.maxPlans,
      }),
      env: {
        SANDBOX_ID: id,
        DEPLOYER_URL: publicUrl,
        DEPLOYER_TOKEN: signAgentToken(secret, id),
      },
    });

    this.store.update(id, {
      status: 'analyzing',
      agent: {
        workspace_id: ws.workspaceId,
        session_id: ws.sessionId,
        deep_link: ws.deepLink,
        reason,
        started_at: new Date().toISOString(),
        plans_submitted: 0,
      },
    });
    this.events.emit(
      id,
      'info',
      'Agente trabajando',
      'Una VM de Conductor está analizando el repo.',
      {
        workspace_id: ws.workspaceId,
        session_id: ws.sessionId,
        deep_link: ws.deepLink,
      },
      'agent',
    );
  }

  // ---------------------------------------------------- acciones del agente

  /** Valida y contabiliza un plan del agente. Quien llama lo ejecuta (SandboxesService.runAgentPlan). */
  acceptPlan(
    s: SandboxRecord,
    manifest: SandboxManifest,
    note: string | undefined,
    busy: boolean,
  ) {
    const agent = this.requireActive(s);
    if (agent.plans_submitted >= this.maxPlans) {
      throw new ConflictException(
        `Se agotaron los ${this.maxPlans} planes. Reporta con "deployer report gave_up".`,
      );
    }
    if (busy) {
      throw new ConflictException(
        'Hay un deploy en curso. Espera con "deployer wait".',
      );
    }
    if (s.pending_inputs.length) {
      throw new ConflictException(
        `Faltan valores del usuario: ${s.pending_inputs.map((p) => p.key).join(', ')}. Espera con "deployer ask".`,
      );
    }
    this.store.update(s.sandbox_id, (r) => {
      r.agent!.plans_submitted += 1;
    });
    this.events.emit(
      s.sandbox_id,
      'info',
      `Plan ${agent.plans_submitted}/${this.maxPlans} del agente`,
      note ?? `runtime ${manifest.runtime}`,
      { manifest },
      'agent',
    );
  }

  note(s: SandboxRecord, title: string, body: string) {
    this.events.emit(s.sandbox_id, 'info', title, body, {}, 'agent');
  }

  requestInputs(s: SandboxRecord, variables: InputRequest[]) {
    this.requireActive(s);
    this.store.update(s.sandbox_id, (r) => {
      for (const v of variables) {
        if (v.key in r.env) continue; // ya entregada
        r.pending_inputs = r.pending_inputs
          .filter((p) => p.key !== v.key)
          .concat(v);
      }
      if (r.pending_inputs.length) r.status = 'needs_input';
    });
    const pending = this.store.get(s.sandbox_id)!.pending_inputs;
    if (pending.length) {
      this.events.emit(
        s.sandbox_id,
        'warning',
        'El agente necesita datos tuyos',
        pending.map((p) => `${p.key}: ${p.description}`).join('\n'),
        { pending_inputs: pending },
        'agent',
      );
    }
    return pending;
  }

  /** El usuario entrega valores pedidos por el agente. */
  provideInputs(id: string, env: Record<string, string>) {
    const s = this.store.get(id)!;
    this.store.update(id, (r) => {
      Object.assign(r.env, env);
      r.pending_inputs = r.pending_inputs.filter((p) => !(p.key in env));
      if (r.status === 'needs_input' && r.pending_inputs.length === 0)
        r.status = 'analyzing';
    });
    this.events.emit(
      id,
      'info',
      'Datos entregados',
      Object.keys(env).join(', '),
      { keys: Object.keys(env) },
      'agent',
    );
    return s;
  }

  async report(
    s: SandboxRecord,
    outcome: 'deployed' | 'gave_up',
    summary: string,
  ) {
    this.requireActive(s);
    if (outcome === 'deployed' && s.status !== 'ready') {
      throw new ConflictException(
        `El sandbox no está ready (status: ${s.status}). Sigue trabajando o reporta gave_up.`,
      );
    }
    await this.finish(s.sandbox_id, outcome, summary);
  }

  /** Detiene el agente si sigue activo y archiva su VM (p. ej. al borrar el sandbox). */
  async stop(id: string, why: string) {
    const s = this.store.get(id);
    if (!s?.agent) return;
    if (!s.agent.finished_at) {
      await this.finish(id, 'gave_up', why, { archive: true, silent: true });
      return;
    }
    await this.conductor
      .archiveWorkspace(s.agent.workspace_id)
      .catch((e: Error) =>
        this.logger.warn(
          `No se pudo archivar ${s.agent!.workspace_id}: ${e.message}`,
        ),
      );
  }

  // ------------------------------------------------------------ internos

  private requireActive(s: SandboxRecord) {
    if (!s.agent || s.agent.finished_at)
      throw new ConflictException('No hay un agente activo para este sandbox');
    return s.agent;
  }

  private async finish(
    id: string,
    outcome: 'deployed' | 'gave_up',
    summary: string,
    opts: { archive?: boolean; silent?: boolean } = {},
  ) {
    const s = this.store.update(id, (r) => {
      r.agent!.finished_at = new Date().toISOString();
      r.agent!.outcome = outcome;
      r.agent!.summary = summary;
      r.pending_inputs = [];
      if (outcome === 'gave_up' && !opts.silent && r.status !== 'ready') {
        r.status = 'failed';
        r.error = `El agente no pudo desplegar: ${summary}`;
      }
    });
    if (!opts.silent) {
      this.events.emit(
        id,
        outcome === 'deployed' ? 'info' : 'critical',
        outcome === 'deployed'
          ? 'El agente desplegó la app'
          : 'El agente se rindió',
        summary,
        { outcome },
        'agent',
      );
    }
    if (
      opts.archive ||
      this.config.get('AGENT_ARCHIVE_ON_FINISH', { infer: true })
    ) {
      await this.conductor
        .archiveWorkspace(s.agent!.workspace_id)
        .catch((e: Error) =>
          this.logger.warn(
            `No se pudo archivar ${s.agent!.workspace_id}: ${e.message}`,
          ),
        );
    }
  }

  /** Vigila las sesiones activas: si el agente se queda quieto sin reportar, insiste una vez y después se rinde. */
  private async monitor() {
    for (const s of this.store.list()) {
      const agent = s.agent;
      if (!agent || agent.finished_at || s.status === 'deleted') continue;
      try {
        if (
          Date.now() - new Date(agent.started_at).getTime() >
          AGENT_TIMEOUT_MS
        ) {
          await this.finish(
            s.sandbox_id,
            'gave_up',
            'Timeout: el agente superó el tiempo máximo',
          );
          continue;
        }
        // Si la VM no llegó a existir (p. ej. falló el clone del repo base) o la borraron, no hay agente.
        const ws = await this.conductor.workspaceStatus(agent.workspace_id);
        if (ws.status === 'deleted' || ws.status === 'archived') {
          const why = `La VM del agente quedó en estado ${ws.status}${ws.errorMessage ? `: ${ws.errorMessage}` : ''}`;
          if (s.status === 'ready')
            await this.finish(
              s.sandbox_id,
              'deployed',
              `${why}, pero la app quedó desplegada.`,
            );
          else await this.finish(s.sandbox_id, 'gave_up', why);
          continue;
        }
        if (ws.status === 'initializing' || ws.status === 'updating') continue;

        const { status, errorMessage, lastError } =
          await this.conductor.sessionStatus(agent.session_id);
        if (status === 'working') {
          if (agent.idle_since)
            this.store.update(
              s.sandbox_id,
              (r) => void delete r.agent!.idle_since,
            );
          continue;
        }
        if (s.status === 'deploying' || s.status === 'provisioning') continue; // el backend sigue desplegando
        if (!agent.idle_since) {
          this.store.update(
            s.sandbox_id,
            (r) => void (r.agent!.idle_since = new Date().toISOString()),
          );
          continue;
        }
        if (Date.now() - new Date(agent.idle_since).getTime() < IDLE_GRACE_MS)
          continue;

        if (!agent.nudged && status !== 'error') {
          this.logger.log(
            `[${s.sandbox_id}] agente idle sin reportar; insistiendo`,
          );
          await this.conductor
            .sendMessage(
              agent.session_id,
              `Sigues a cargo del sandbox ${s.sandbox_id} (status actual: ${s.status}). ` +
                'Continúa hasta que quede desplegado y termina SIEMPRE con `node /tmp/deployer.mjs report deployed "<resumen>"` ' +
                'o `node /tmp/deployer.mjs report gave_up "<motivo>"`.',
            )
            // Si no se puede insistir, igual cuenta como intento: la próxima vez se da por terminado.
            .catch((e: Error) =>
              this.logger.warn(
                `[${s.sandbox_id}] no se pudo insistir al agente: ${e.message}`,
              ),
            );
          this.store.update(s.sandbox_id, (r) => {
            r.agent!.nudged = true;
            delete r.agent!.idle_since;
          });
          continue;
        }
        const why =
          status === 'error'
            ? `La sesión del agente falló: ${errorMessage ?? lastError ?? 'error desconocido'}`
            : 'El agente terminó sin reportar un resultado';
        if (s.status === 'ready')
          await this.finish(
            s.sandbox_id,
            'deployed',
            `${why}, pero la app quedó desplegada.`,
          );
        else await this.finish(s.sandbox_id, 'gave_up', why);
      } catch (err) {
        this.logger.warn(
          `[${s.sandbox_id}] monitor: ${(err as Error).message}`,
        );
      }
    }
  }
}
