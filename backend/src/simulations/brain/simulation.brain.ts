import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { SandboxesService } from '../../sandboxes/sandboxes.service.js';
import { SimulationStore } from '../simulation.store.js';
import {
  EVENT_TYPES,
  type IncidentState,
  type SimRole,
  type SimulationRecord,
  type TimelineEvent,
} from '../simulation.types.js';
import { SimulationsService } from '../simulations.service.js';
import { pendingFor, TimelineService } from '../timeline.service.js';
import {
  computeFacts,
  DEFAULT_DIRECTOR,
  direct,
  type DirectorOptions,
} from './facts.js';
import { SimLlm, type StructuredResult, type TaskModel } from './llm.client.js';
import { collectRepoFiles } from './repo-files.js';
import {
  initialState,
  runContext,
  runDebrief,
  runGenerator,
  runObserver,
  toSimContext,
  type AppInfo,
} from './tasks.js';

export type BrainTask = 'context' | 'generator' | 'observer' | 'debrief';

/** Espera antes de llamar al modelo: junta los eventos que llegan en ráfaga (step, success, done). */
const DEBOUNCE_MS: Partial<Record<SimRole, number>> = {
  infra: 0,
  generator: 1_500,
  observer: 2_500,
};
const RETRY_BASE_MS = 10_000;
const MAX_ATTEMPTS = 3;

/** Eventos que justifican re-escribir el estado del incidente con el modelo. */
const OBSERVER_SIGNIFICANT =
  /^(attack\.(success|blocked|done|verify)|change\.|user\.action)/;
/** Eventos que pueden producir una notificación. */
const GENERATOR_SIGNIFICANT = /^(attack\.|state\.update)/;

/**
 * Los roles que corren dentro del backend con la API de Claude (mode=api):
 * - infra → contexto de la app (una llamada al quedar arriba el deploy),
 * - generator → notificaciones,
 * - observer → director en código + estado del incidente + debrief.
 *
 * Mismo contrato que los threads de Conductor: leen el timeline con su cursor
 * y publican con los permisos de su rol (EVENT_TYPES). Se disparan al
 * aparecer el evento, sin esperar el tick del dispatcher.
 */
@Injectable()
export class SimulationBrain implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SimulationBrain.name);
  private llm?: SimLlm;
  private readonly models: Record<BrainTask, TaskModel>;
  private readonly director: DirectorOptions;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly running = new Set<string>();
  private readonly rerun = new Set<string>();
  private readonly failures = new Map<
    string,
    { count: number; nextAt: number }
  >();
  private readonly directScheduled = new Set<string>();
  private readonly finishing = new Set<string>();
  private off?: () => void;

  constructor(
    config: ConfigService<Env, true>,
    private readonly sims: SimulationsService,
    private readonly store: SimulationStore,
    private readonly timeline: TimelineService,
    private readonly sandboxes: SandboxesService,
  ) {
    const key = config.get('ANTHROPIC_API_KEY', { infer: true });
    if (key) this.llm = SimLlm.fromApiKey(key);
    const m = (
      model: keyof Env,
      effort: keyof Env,
      maxTokens: number,
      timeoutMs: number,
    ): TaskModel => ({
      model: config.get(model, { infer: true }) as string,
      effort: config.get(effort, { infer: true }) as TaskModel['effort'],
      maxTokens,
      timeoutMs,
    });
    this.models = {
      context: m('SIM_MODEL_CONTEXT', 'SIM_EFFORT_CONTEXT', 8_000, 120_000),
      generator: m(
        'SIM_MODEL_GENERATOR',
        'SIM_EFFORT_GENERATOR',
        8_000,
        90_000,
      ),
      observer: m('SIM_MODEL_OBSERVER', 'SIM_EFFORT_OBSERVER', 12_000, 120_000),
      debrief: m('SIM_MODEL_DEBRIEF', 'SIM_EFFORT_DEBRIEF', 16_000, 300_000),
    };
    this.director = {
      ...DEFAULT_DIRECTOR,
      maxIncidents: config.get('SIM_MAX_INCIDENTS', { infer: true }),
    };
  }

  get enabled() {
    return !!this.llm;
  }

  /** Reemplaza el cliente del modelo (tests). */
  useLlm(llm: SimLlm) {
    this.llm = llm;
  }

  onModuleInit() {
    this.off = this.timeline.onAppend((e) => this.onEvent(e));
  }

  onModuleDestroy() {
    this.off?.();
    for (const t of this.timers.values()) clearTimeout(t);
  }

  /** Lo llama el dispatcher en cada tick: escalamiento por tiempo y reintentos. */
  tick(simId: string) {
    const s = this.store.get(simId);
    if (!s) return;
    if (this.isApi(s, 'observer')) this.scheduleDirect(simId);
    for (const t of s.threads) {
      if (t.mode !== 'api') continue;
      if (!pendingFor(s.timeline, t.role, t.cursor).length) continue;
      const f = this.failures.get(key(simId, t.role));
      if (f && Date.now() < f.nextAt) continue;
      this.schedule(simId, t.role);
    }
  }

  // ------------------------------------------------------------ disparo

  private onEvent(e: TimelineEvent) {
    const s = this.store.get(e.sim_id);
    if (!s) return;
    for (const role of EVENT_TYPES[e.type]?.wakes ?? []) {
      if (e.actor !== role && this.isApi(s, role))
        this.schedule(e.sim_id, role);
    }
    if (this.isApi(s, 'observer')) this.scheduleDirect(e.sim_id);
  }

  private isApi(s: SimulationRecord, role: SimRole) {
    return s.threads.some((t) => t.role === role && t.mode === 'api');
  }

  private schedule(simId: string, role: SimRole) {
    const k = key(simId, role);
    if (this.running.has(k)) {
      this.rerun.add(k);
      return;
    }
    if (this.timers.has(k)) return;
    this.timers.set(
      k,
      setTimeout(() => {
        this.timers.delete(k);
        void this.run(simId, role);
      }, DEBOUNCE_MS[role] ?? 1_000),
    );
  }

  private async run(simId: string, role: SimRole) {
    const k = key(simId, role);
    if (!this.llm || this.running.has(k)) return;
    this.running.add(k);
    try {
      const s = this.store.get(simId);
      const thread = s?.threads.find((t) => t.role === role);
      if (!s || !thread || thread.mode !== 'api') return;
      const pending = pendingFor(s.timeline, role, thread.cursor);
      if (!pending.length) return;
      if (role === 'infra') await this.runInfra(s, pending);
      else if (role === 'generator') await this.runGenerator(s, pending);
      else if (role === 'observer') await this.runObserver(s, pending);
      this.sims.advanceCursor(simId, role, pending.at(-1)!.seq);
      this.failures.delete(k);
      this.store.update(simId, (r) => {
        const t = r.threads.find((x) => x.role === role)!;
        delete t.last_error;
      });
    } catch (err) {
      this.onFailure(simId, role, err as Error);
    } finally {
      this.running.delete(k);
      if (this.rerun.delete(k)) this.schedule(simId, role);
    }
  }

  private onFailure(simId: string, role: SimRole, err: Error) {
    const k = key(simId, role);
    const f = this.failures.get(k) ?? { count: 0, nextAt: 0 };
    f.count += 1;
    f.nextAt = Date.now() + RETRY_BASE_MS * 2 ** (f.count - 1);
    this.failures.set(k, f);
    this.logger.warn(
      `[${simId}] ${role} falló (intento ${f.count}): ${err.message}`,
    );
    this.store.update(simId, (r) => {
      const t = r.threads.find((x) => x.role === role);
      if (t) t.last_error = err.message.slice(0, 500);
    });
    if (f.count >= MAX_ATTEMPTS) {
      // Saltar estos eventos para no quedar en un loop; la simulación sigue.
      const s = this.store.get(simId);
      const t = s?.threads.find((x) => x.role === role);
      const last =
        s && t ? pendingFor(s.timeline, role, t.cursor).at(-1) : undefined;
      if (last) this.sims.advanceCursor(simId, role, last.seq);
      this.failures.delete(k);
      this.sims.postFromAgent(simId, role, {
        type: 'agent.note',
        title: `${role}: se saltaron eventos después de ${MAX_ATTEMPTS} intentos`,
        body: err.message.slice(0, 1000),
      });
      if (role === 'infra' && s && !s.context) this.postFallbackContext(s);
    }
  }

  private record(simId: string, role: SimRole, res: StructuredResult<unknown>) {
    this.store.update(simId, (r) => {
      const t = r.threads.find((x) => x.role === role)!;
      t.model = res.model;
      t.last_ms = res.ms;
      t.wakes += 1;
      t.last_wake_at = new Date().toISOString();
    });
    const u = res.usage;
    this.logger.log(
      `[${simId}] ${role} ${res.model} ${res.ms} ms · in ${u.input_tokens} (cache ${u.cache_read_input_tokens}) · out ${u.output_tokens}`,
    );
  }

  private app(s: SimulationRecord): AppInfo {
    const sbx = this.sandboxes.get(s.sandbox_id);
    return {
      deployed_url: sbx.render?.url ?? null,
      seed_users: (sbx.manifest?.seed_users ?? []).map((u) => ({
        email: u.email,
        ...(u.role ? { role: u.role } : {}),
      })),
    };
  }

  // ------------------------------------------------------------ infra

  private async runInfra(s: SimulationRecord, pending: TimelineEvent[]) {
    // Sin thread de infra: los pedidos de arquitectura los hace el coder con su CLI.
    for (const e of pending.filter((x) => x.type === 'infra.request')) {
      this.sims.postFromAgent(s.sim_id, 'infra', {
        type: 'infra.reply',
        title: 'Hazlo tú con la CLI: no hay thread de infra',
        body: 'En esta simulación no hay agente de infra. Tienes `sim env set|generate|unset`, `sim restart` y `sim push` (también para Dockerfile o .sandbox/manifest.json).',
        raw: { request_seq: e.seq },
      });
    }
    if (s.context || !pending.some((e) => e.type === 'deploy.ready')) return;
    const dir = await this.sandboxes.sourceDir(s.sandbox_id);
    const { tree, files } = await collectRepoFiles(dir);
    const sbx = this.sandboxes.get(s.sandbox_id);
    const res = await runContext(this.llm!, this.models.context, {
      tree,
      files,
      app: this.app(s),
      deployNotes: sbx.agent?.summary,
    });
    this.record(s.sim_id, 'infra', res);
    const ctx = toSimContext(res.data);
    this.sims.postFromAgent(s.sim_id, 'infra', {
      type: 'context.ready',
      title: 'Contexto del repo listo',
      body: ctx.summary,
      raw: ctx,
    });
  }

  /** Si el modelo no pudo, un contexto mínimo para que el resto siga (personas = usuarios seed). */
  private postFallbackContext(s: SimulationRecord) {
    const app = this.app(s);
    this.sims.postFromAgent(s.sim_id, 'infra', {
      type: 'context.ready',
      title: 'Contexto mínimo del repo',
      body: s.repo_url,
      raw: {
        summary: `App del repo ${s.repo_url}, desplegada en ${app.deployed_url ?? 'el sandbox'}.`,
        personas: app.seed_users.map((u) => ({
          name: u.email.split('@')[0].replace(/[._]/g, ' '),
          email: u.email,
          role: u.role,
        })),
      },
    });
  }

  // ------------------------------------------------------------ generator

  private async runGenerator(s: SimulationRecord, pending: TimelineEvent[]) {
    if (!['running', 'paused'].includes(s.status)) return;
    if (!pending.some((e) => GENERATOR_SIGNIFICANT.test(e.type))) return;
    const channels = this.sims.channels(s);
    const res = await runGenerator(
      this.llm!,
      this.models.generator,
      s,
      channels,
      this.app(s),
      pending,
    );
    this.record(s.sim_id, 'generator', res);
    for (const n of res.data.notifications) {
      if (!channels.includes(n.channel)) continue;
      this.sims.postFromAgent(s.sim_id, 'generator', {
        type: 'notify',
        title: n.title,
        body: n.body,
        severity: n.severity,
        vuln_id: n.vuln_id,
        raw: {
          channel: n.channel,
          ...(n.from ? { from: n.from } : {}),
          ...(n.channel === 'slack' && n.room ? { room: n.room } : {}),
        },
      });
    }
  }

  // ------------------------------------------------------------ observer

  private async runObserver(s: SimulationRecord, pending: TimelineEvent[]) {
    if (pending.some((e) => e.type === 'control.finish')) {
      void this.finish(s.sim_id, 'El developer pidió terminar');
      return;
    }
    if (!['running', 'paused'].includes(s.status)) {
      if (!s.state && s.attack_plan) this.postState(s.sim_id, initialState(s));
      return;
    }
    if (!pending.some((e) => OBSERVER_SIGNIFICANT.test(e.type))) {
      if (pending.some((e) => e.type === 'control.start'))
        this.postState(s.sim_id, {
          ...(s.state ?? initialState(s)),
          phase: 'under_attack',
          summary: 'El ataque comenzó.',
        });
      return;
    }
    const res = await runObserver(
      this.llm!,
      this.models.observer,
      s,
      this.app(s),
      pending,
    );
    this.record(s.sim_id, 'observer', res);
    // Si mientras pensaba la simulación terminó, no pisar el cierre.
    if (this.store.get(s.sim_id)?.status === 'finished') return;
    this.postState(s.sim_id, res.data);
  }

  private postState(simId: string, state: IncidentState) {
    this.sims.postFromAgent(simId, 'observer', {
      type: 'state.update',
      title: firstLine(state.summary ?? 'Estado del incidente'),
      vuln_id: state.current_vuln,
      raw: state,
    });
  }

  private scheduleDirect(simId: string) {
    if (this.directScheduled.has(simId)) return;
    this.directScheduled.add(simId);
    setImmediate(() => {
      this.directScheduled.delete(simId);
      try {
        this.runDirector(simId);
      } catch (err) {
        this.logger.warn(`[${simId}] director: ${(err as Error).message}`);
      }
    });
  }

  /** El ritmo de la simulación: re-verificar, escalar o cerrar. Sin LLM. */
  private runDirector(simId: string) {
    const s = this.store.get(simId);
    if (!s || !this.isApi(s, 'observer') || this.finishing.has(simId)) return;
    for (const a of direct(s, Date.now(), this.director)) {
      if (a.type === 'finish') {
        void this.finish(simId, a.reason);
        return;
      }
      this.sims.postFromAgent(simId, 'observer', {
        type: `control.${a.type}`,
        title: `${a.type} ${a.vuln_id}`,
        body: a.reason,
        vuln_id: a.vuln_id,
        raw: { vuln_id: a.vuln_id },
      });
    }
  }

  // ------------------------------------------------------------ debrief

  async finish(simId: string, reason: string) {
    if (!this.llm || this.finishing.has(simId)) return;
    const s0 = this.store.get(simId);
    if (!s0 || !['running', 'paused'].includes(s0.status)) return;
    this.finishing.add(simId);
    try {
      this.sims.postFromAgent(simId, 'observer', {
        type: 'agent.note',
        title: 'Preparando el debrief',
        body: reason,
      });
      const attempts: TaskModel[] = [
        this.models.debrief,
        this.models.debrief,
        { ...this.models.observer, maxTokens: 16_000 },
      ];
      for (const [i, model] of attempts.entries()) {
        const s = this.store.get(simId)!;
        if (s.status === 'finished') return;
        try {
          const res = await runDebrief(this.llm, model, s, this.app(s));
          this.record(simId, 'observer', res);
          this.sims.postFromAgent(simId, 'observer', {
            type: 'sim.finished',
            title: 'Simulación terminada',
            body: res.data.summary,
            raw: res.data,
          });
          return;
        } catch (err) {
          this.logger.warn(
            `[${simId}] debrief intento ${i + 1} (${model.model}) falló: ${(err as Error).message}`,
          );
        }
      }
      this.postFallbackDebrief(simId);
    } finally {
      this.finishing.delete(simId);
    }
  }

  /** Último recurso: un debrief con los hechos, para que la simulación nunca quede colgada. */
  private postFallbackDebrief(simId: string) {
    const s = this.store.get(simId)!;
    const f = computeFacts(s.timeline, s.attack_plan);
    const played = f.order.filter((id) => f.vulns[id].status !== 'pending');
    this.sims.postFromAgent(simId, 'observer', {
      type: 'sim.finished',
      title: 'Simulación terminada',
      body: s.state?.summary ?? 'La simulación terminó.',
      raw: {
        summary: s.state?.summary ?? 'La simulación terminó.',
        outcome: f.attacker_active ? 'breached' : 'partially_contained',
        per_vuln: played.map((id) => ({
          vuln_id: id,
          what_happened: s.state?.vulns?.[id]?.note ?? '',
          where: '',
          what_you_did: '',
          verdict: f.vulns[id].status === 'fixed' ? 'correct' : 'partial',
          correct_fix: '',
          real_case: '',
        })),
        highlights: [],
        score: 0,
        degraded: true,
      },
    });
  }
}

function key(simId: string, role: SimRole) {
  return `${simId}:${role}`;
}

function firstLine(s: string): string {
  return (s.split('\n').find((x) => x.trim()) ?? s).slice(0, 100);
}
