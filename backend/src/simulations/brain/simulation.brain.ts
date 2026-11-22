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
  CLOSED_STATUSES,
  EVENT_TYPES,
  type EngineReplayEvent,
  type IncidentState,
  type SimOpening,
  type SimRole,
  type SimulationRecord,
  type TimelineEvent,
} from '../simulation.types.js';
import { SimulationsService } from '../simulations.service.js';
import { pendingFor, TimelineService } from '../timeline.service.js';
import {
  computeFacts,
  direct,
  planOrder,
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
const GENERATOR_SIGNIFICANT = /^(attack\.|state\.update|incident\.pulse)/;
/** Separación entre las alertas de apertura al partir (la primera sale casi al tiro). */
const OPENING_STAGGER_MS = [800, 20_000, 40_000];
/** Lo que se le pide al generador para la apertura: que escale, no una sola alerta. */
const OPENING_INSTRUCTION =
  'Es la apertura del incidente: devuelve 2 o 3 notificaciones que se lean en orden y escalen (por ejemplo, un contador que sube o un segundo canal que nota lo mismo). La primera sale apenas parte el simulacro y las otras unos 20 y 40 segundos después. Respeta las reglas: solo síntomas observables y alertas que cruzan un umbral.';
/** Una pausa por Hinty no puede dejar la simulación congelada: se reanuda sola pasado esto. */
const MAX_HINTY_PAUSE_MS = 10 * 60_000;
/** Estados en los que el incidente sigue en curso (y se puede cerrar con un debrief). */
const LIVE = ['running', 'paused'];

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
      attackGapMs: config.get('SIM_ATTACK_GAP_SECONDS', { infer: true }) * 1000,
      pulseMs: config.get('SIM_PULSE_SECONDS', { infer: true }) * 1000,
      attackPulseMs: 40_000,
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
    if (s.status === 'starting') void this.prepareOpening(simId);
    if (s.status === 'paused') this.resumeStalePause(s);
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
    if (
      e.type === 'sim.status' &&
      CLOSED_STATUSES.includes(e.raw?.status as SimulationRecord['status'])
    ) {
      this.forget(e.sim_id);
      return;
    }
    if (['attack.plan', 'context.ready', 'deploy.ready'].includes(e.type))
      void this.prepareOpening(e.sim_id);
    if (e.type === 'control.start') this.publishOpening(e.sim_id);
    for (const role of EVENT_TYPES[e.type]?.wakes ?? []) {
      if (e.actor !== role && this.isApi(s, role))
        this.schedule(e.sim_id, role);
    }
    if (this.isApi(s, 'observer')) this.scheduleDirect(e.sim_id);
  }

  private isApi(s: SimulationRecord, role: SimRole) {
    return s.threads.some((t) => t.role === role && t.mode === 'api');
  }

  /** Simulación cerrada: se sueltan sus timers y reintentos pendientes. */
  private forget(simId: string) {
    const prefix = `${simId}:`;
    for (const [k, t] of this.timers) {
      if (!k.startsWith(prefix)) continue;
      clearTimeout(t);
      this.timers.delete(k);
    }
    for (const k of this.rerun) if (k.startsWith(prefix)) this.rerun.delete(k);
    for (const k of this.failures.keys())
      if (k.startsWith(prefix)) this.failures.delete(k);
  }

  private schedule(simId: string, role: SimRole) {
    const k = key(simId, role);
    if (this.running.has(k)) {
      this.rerun.add(k);
      return;
    }
    if (this.timers.has(k)) return;
    // Tras un fallo se respeta el backoff: el timer corre recién cuando termina
    // (y tick() vuelve a agendar si hiciera falta).
    const f = this.failures.get(k);
    const backoff = f ? Math.max(0, f.nextAt - Date.now()) : 0;
    this.timers.set(
      k,
      setTimeout(
        () => {
          this.timers.delete(k);
          void this.run(simId, role);
        },
        Math.max(DEBOUNCE_MS[role] ?? 1_000, backoff),
      ),
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
    // Si mientras escribía la simulación se cerró, no se publican avisos sueltos.
    if (!LIVE.includes(this.store.get(s.sim_id)?.status ?? '')) return;
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
    // Si mientras pensaba la simulación se cerró (terminó o la detuvieron), no pisar el cierre.
    if (!LIVE.includes(this.store.get(s.sim_id)?.status ?? '')) return;
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
      if (a.type === 'pulse') {
        const st = s.state;
        this.sims.postFromAgent(simId, 'observer', {
          type: 'incident.pulse',
          title: a.reason,
          body: st?.summary ?? '',
          raw: a.attacking
            ? { attacking: true, vuln_id: st?.current_vuln ?? null }
            : { attacker_active: true, compromised: st?.compromised ?? [] },
        });
        continue;
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

  // ------------------------------------------------------------ apertura

  private readonly preparing = new Set<string>();

  /**
   * Antes de partir, el generador escribe las primeras alertas a partir del primer
   * ataque del plan (los pasos reales del motor, o el hallazgo del plan). Salen apenas
   * el developer parte: así no espera a que el atacante avance para ver algo.
   */
  async prepareOpening(simId: string, opts: { force?: boolean } = {}) {
    const s = this.store.get(simId);
    if (!s || this.preparing.has(simId)) return;
    if (!opts.force && (s.status !== 'starting' || s.opening)) return;
    if (opts.force && !['starting', 'ready'].includes(s.status)) return;
    if (!s.attack_plan || !s.context || !s.tools_detected) return;
    if (!this.llm || !this.isApi(s, 'generator')) {
      this.setOpening(simId, { status: 'skipped', notifications: [] });
      return;
    }
    const pending = openingEvents(s);
    if (!pending.length) {
      this.setOpening(simId, { status: 'skipped', notifications: [] });
      return;
    }
    const vulnId = pending[0].vuln_id ?? undefined;
    this.preparing.add(simId);
    this.setOpening(simId, {
      status: 'preparing',
      vuln_id: vulnId,
      notifications: [],
    });
    try {
      const channels = this.sims.channels(s);
      const res = await runGenerator(
        this.llm,
        this.models.generator,
        { ...s, status: 'running' },
        channels,
        this.app(s),
        pending,
        undefined,
        OPENING_INSTRUCTION,
      );
      this.record(simId, 'generator', res);
      this.setOpening(simId, {
        status: 'ready',
        vuln_id: vulnId,
        notifications: res.data.notifications
          .filter((n) => channels.includes(n.channel))
          .map((n) => ({
            channel: n.channel,
            title: n.title,
            body: n.body,
            severity: n.severity,
            vuln_id: n.vuln_id ?? null,
            ...(n.from ? { from: n.from } : {}),
            ...(n.channel === 'slack' && n.room ? { room: n.room } : {}),
          })),
      });
    } catch (err) {
      this.logger.warn(
        `[${simId}] alertas de apertura: ${(err as Error).message}`,
      );
      this.setOpening(simId, {
        status: 'failed',
        vuln_id: vulnId,
        notifications: [],
        error: (err as Error).message.slice(0, 300),
      });
    } finally {
      this.preparing.delete(simId);
    }
  }

  /**
   * Si el developer cambió el primer incidente en el informe, la apertura escrita era de
   * otro ataque: se reescribe antes de partir (la transición de pixeles cubre la espera).
   * Con un tope: si tarda, se parte sin apertura y el generador sigue en vivo.
   */
  async ensureOpeningForFirst(simId: string, timeoutMs = 20_000) {
    const s = this.store.get(simId);
    if (!s?.opening || s.opening.status === 'skipped') return;
    const first = planOrder(s.attack_plan)[0];
    if (!first || s.opening.vuln_id === first) return;
    const done = this.prepareOpening(simId, { force: true });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((r) => {
      timer = setTimeout(() => r('timeout'), timeoutMs);
    });
    const result = await Promise.race([done, timeout]);
    clearTimeout(timer);
    if (result === 'timeout')
      this.store.update(simId, (r) => {
        if (r.opening && r.opening.vuln_id !== first)
          r.opening.status = 'failed';
      });
  }

  private setOpening(simId: string, opening: SimOpening) {
    this.store.update(simId, { opening });
    this.sims.checkReady(simId);
  }

  /** Al partir: las alertas de apertura, la primera casi al tiro y el resto escalonadas. */
  private publishOpening(simId: string) {
    const s = this.store.get(simId);
    const o = s?.opening;
    if (!o || o.status !== 'ready' || o.published) return;
    this.store.update(simId, (r) => {
      r.opening!.published = true;
    });
    o.notifications.forEach((n, i) => {
      const t = setTimeout(
        () => {
          const cur = this.store.get(simId);
          if (!cur || !['running', 'paused'].includes(cur.status)) return;
          this.sims.postFromAgent(simId, 'generator', {
            type: 'notify',
            title: n.title,
            body: n.body,
            severity: n.severity,
            vuln_id: n.vuln_id,
            raw: {
              channel: n.channel,
              opening: true,
              ...(n.from ? { from: n.from } : {}),
              ...(n.room ? { room: n.room } : {}),
            },
          });
        },
        OPENING_STAGGER_MS[i] ?? 14_000 + i * 7_000,
      );
      t.unref?.();
    });
  }

  /** Seguro: si una pausa (Hinty abierto) quedó colgada, se reanuda sola. */
  private resumeStalePause(s: SimulationRecord) {
    const last = [...s.timeline]
      .reverse()
      .find((e) => e.type === 'control.pause');
    if (!last || Date.now() - Date.parse(last.t) < MAX_HINTY_PAUSE_MS) return;
    this.sims.postFromAgent(s.sim_id, 'observer', {
      type: 'control.resume',
      title: 'La pausa duró demasiado: el incidente continúa',
      raw: { reason: 'auto' },
    });
  }

  // ------------------------------------------------------------ debrief

  async finish(simId: string, reason: string) {
    if (!this.llm || this.finishing.has(simId)) return;
    const s0 = this.store.get(simId);
    if (!s0 || !LIVE.includes(s0.status)) return;
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
        const s = this.store.get(simId);
        // Un Stop (o un cierre por otra vía) durante el debrief manda: no se pisa con finished.
        if (!s || !LIVE.includes(s.status)) return;
        try {
          const res = await runDebrief(this.llm, model, s, this.app(s));
          this.record(simId, 'observer', res);
          if (!LIVE.includes(this.store.get(simId)?.status ?? '')) return;
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
      if (!LIVE.includes(this.store.get(simId)?.status ?? '')) return;
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

/**
 * Los eventos del primer ataque, como si ya hubieran pasado: los pasos reales que
 * repetirá el motor o, sin motor, el primer hallazgo del plan.
 */
export function openingEvents(s: SimulationRecord): TimelineEvent[] {
  const now = new Date().toISOString();
  const ev = (
    i: number,
    e: Pick<EngineReplayEvent, 'type' | 'vuln_id' | 'title'> &
      Partial<Pick<EngineReplayEvent, 'severity' | 'body' | 'raw'>>,
  ): TimelineEvent => ({
    seq: 1_000_000_000 + i,
    t: now,
    sim_id: s.sim_id,
    actor: 'hacker',
    type: e.type,
    visibility: 'internal',
    vuln_id: e.vuln_id,
    source: 'hacker',
    severity: e.severity ?? 'info',
    title: e.title,
    body: e.body ?? '',
    raw: e.raw ?? {},
  });
  const first = planOrder(s.attack_plan)[0];
  if (!first) return [];
  const replay = s.engine?.replay?.[first];
  if (replay?.length)
    return replay.map((e, i) => ev(i, { ...e, vuln_id: e.vuln_id ?? first }));
  const finding = (
    (s.attack_plan?.findings as Array<Record<string, unknown>>) ?? []
  ).find((f) => f.vuln_id === first);
  const text = (v: unknown) => (typeof v === 'string' ? v : '');
  return [
    ev(0, {
      type: 'attack.success',
      vuln_id: first,
      severity: 'critical',
      title: text(finding?.title) || `El atacante explota ${first}`,
      body: [text(finding?.exploit_summary), text(finding?.symptoms)]
        .filter(Boolean)
        .join('\n'),
      raw: {},
    }),
  ];
}
