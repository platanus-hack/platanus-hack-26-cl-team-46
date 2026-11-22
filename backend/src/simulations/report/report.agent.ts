import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import {
  repoShortName,
  sandboxDisplayName,
} from '../../sandboxes/sandbox.types.js';
import { SandboxesService } from '../../sandboxes/sandboxes.service.js';
import { SimLlm, type TaskModel } from '../brain/llm.client.js';
import { SimulationStore } from '../simulation.store.js';
import type { SimulationRecord, TimelineEvent } from '../simulation.types.js';
import { SimulationsService } from '../simulations.service.js';
import { TimelineService } from '../timeline.service.js';
import {
  assembleResult,
  computeReportMetrics,
  fallbackResult,
  REPORT_SYSTEM,
  reportPrompts,
  reportSchema,
} from './report.prompt.js';
import type { ReportRecord } from './report.types.js';

/** Estados de cierre que dejan reporte. */
const CLOSED = ['finished', 'stopped', 'failed'];
const CONCURRENCY = 2;
const SWEEP_MS = 60_000;
/** Un "generating" más viejo que esto quedó huérfano (el backend se reinició a mitad). */
const STALE_MS = 10 * 60_000;

/**
 * Agente de reportes: cuando una simulación se cierra, junta TODAS sus fuentes
 * (contexto, plan del atacante, hechos verificados, estado y debrief del
 * observador, y el timeline completo: ataque, notificaciones, chat con el agente
 * de código, acciones y cambios desplegados) y le pide a Claude, por API directa,
 * el reporte final que ve el developer en /result.
 *
 * Lo objetivo (duración, pasos, veredicto, rango) se mide en código; el modelo
 * escribe el análisis. Si la API falla, un respaldo arma un reporte con los
 * hechos, así que toda simulación que partió termina con reporte.
 */
@Injectable()
export class ReportAgent implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportAgent.name);
  private llm?: SimLlm;
  private readonly attempts: TaskModel[];
  private readonly queue: string[] = [];
  private readonly running = new Set<string>();
  private off?: () => void;
  private timer?: NodeJS.Timeout;

  constructor(
    config: ConfigService<Env, true>,
    private readonly store: SimulationStore,
    private readonly timeline: TimelineService,
    private readonly sims: SimulationsService,
    private readonly sandboxes: SandboxesService,
  ) {
    const key = config.get('ANTHROPIC_API_KEY', { infer: true });
    if (key) this.llm = SimLlm.fromApiKey(key);
    const main: TaskModel = {
      model: config.get('SIM_MODEL_REPORT', { infer: true }),
      effort: config.get('SIM_EFFORT_REPORT', { infer: true }),
      maxTokens: 16_000,
      timeoutMs: 300_000,
    };
    // Dos intentos con el modelo principal y uno con el del observador antes del respaldo.
    this.attempts = [
      main,
      main,
      {
        model: config.get('SIM_MODEL_OBSERVER', { infer: true }),
        effort: 'medium',
        maxTokens: 16_000,
        timeoutMs: 240_000,
      },
    ];
  }

  /** Reemplaza el cliente del modelo (tests). */
  useLlm(llm: SimLlm | undefined) {
    this.llm = llm;
  }

  onModuleInit() {
    this.off = this.timeline.onAppend((e) => this.onEvent(e));
    // Al arrancar: retoma lo que quedó en cola o a medias, y genera los que faltan.
    setTimeout(() => this.sweep(), 5_000).unref?.();
    this.timer = setInterval(() => this.sweep(), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    this.off?.();
    clearInterval(this.timer);
  }

  // ------------------------------------------------------------ disparo

  private onEvent(e: TimelineEvent) {
    if (e.type !== 'sim.status' || !CLOSED.includes(String(e.raw?.status)))
      return;
    const s = this.store.get(e.sim_id);
    if (s && needsReport(s)) this.request(e.sim_id, String(e.raw.status));
  }

  /** ¿Esta simulación debería tener reporte y todavía no lo tiene (o quedó colgado)? */
  private sweep() {
    for (const s of this.store.list()) {
      const r = s.report;
      if (!r) {
        if (needsReport(s)) this.request(s.sim_id, s.status);
        continue;
      }
      const stale =
        (r.status === 'generating' &&
          Date.now() - Date.parse(r.started_at ?? r.requested_at) > STALE_MS) ||
        r.status === 'pending';
      if (
        stale &&
        !this.running.has(s.sim_id) &&
        !this.queue.includes(s.sim_id)
      )
        this.enqueue(s.sim_id);
    }
  }

  /** Pide (o vuelve a pedir) el reporte de una simulación cerrada. */
  request(
    simId: string,
    trigger: string,
    opts: { force?: boolean } = {},
  ): ReportRecord {
    const s = this.sims.get(simId);
    if (!CLOSED.includes(s.status))
      throw new ConflictException('La simulación todavía no termina');
    if (this.running.has(simId) || this.queue.includes(simId)) return s.report!;
    if (s.report?.status === 'ready' && !opts.force) return s.report;
    const owner = s.report?.owner ?? this.sims.ownerOf(s);
    const record: ReportRecord = {
      status: 'pending',
      trigger,
      owner,
      title: s.report?.title ?? this.title(s),
      requested_at: new Date().toISOString(),
      closed_at: s.report?.closed_at ?? closedAt(s),
      attempts: 0,
    };
    this.store.update(simId, { report: record });
    this.enqueue(simId);
    return record;
  }

  private enqueue(simId: string) {
    this.queue.push(simId);
    this.pump();
  }

  private pump() {
    while (this.running.size < CONCURRENCY && this.queue.length) {
      const id = this.queue.shift()!;
      if (this.running.has(id)) continue;
      this.running.add(id);
      void this.generate(id).finally(() => {
        this.running.delete(id);
        this.pump();
      });
    }
  }

  // ------------------------------------------------------------ generar

  async generate(simId: string) {
    const s0 = this.store.get(simId);
    if (!s0?.report) return;
    this.patch(simId, {
      status: 'generating',
      started_at: new Date().toISOString(),
      error: undefined,
    });
    const s = this.store.get(simId)!;
    const metrics = computeReportMetrics(s);
    const app = this.app(s);

    if (this.llm) {
      const { stable, prompt } = reportPrompts(s, metrics, app);
      for (const [i, model] of this.attempts.entries()) {
        this.patch(simId, {
          attempts: (this.store.get(simId)!.report!.attempts ?? 0) + 1,
        });
        try {
          const res = await this.llm.structured({
            model,
            system: REPORT_SYSTEM,
            stable,
            prompt,
            schema: reportSchema,
          });
          this.patch(simId, {
            status: 'ready',
            result: assembleResult(res.data, metrics, app.repo),
            generated_at: new Date().toISOString(),
            model: res.model,
            ms: res.ms,
            degraded: false,
          });
          this.logger.log(
            `[${simId}] reporte listo (${res.model}, ${Math.round(res.ms / 1000)} s, ${res.usage.input_tokens}+${res.usage.output_tokens} tokens)`,
          );
          return;
        } catch (err) {
          this.logger.warn(
            `[${simId}] reporte intento ${i + 1} (${model.model}) falló: ${(err as Error).message}`,
          );
          this.patch(simId, { error: (err as Error).message });
        }
      }
    }

    try {
      this.patch(simId, {
        status: 'ready',
        result: fallbackResult(s, metrics, app.repo),
        generated_at: new Date().toISOString(),
        model: undefined,
        degraded: true,
      });
      this.logger.warn(`[${simId}] reporte armado con el respaldo (sin LLM)`);
    } catch (err) {
      this.patch(simId, { status: 'failed', error: (err as Error).message });
      this.logger.error(
        `[${simId}] no se pudo armar el reporte: ${(err as Error).message}`,
      );
    }
  }

  // ------------------------------------------------------------ internos

  private patch(simId: string, patch: Partial<ReportRecord>) {
    this.store.update(simId, (r) => {
      if (r.report) Object.assign(r.report, patch);
    });
  }

  private sandbox(s: SimulationRecord) {
    try {
      return this.sandboxes.get(s.sandbox_id);
    } catch {
      return undefined;
    }
  }

  private title(s: SimulationRecord) {
    const sbx = this.sandbox(s);
    return sbx ? sandboxDisplayName(sbx) : repoShortName(s.repo_url);
  }

  private app(s: SimulationRecord) {
    const sbx = this.sandbox(s);
    return {
      repo: s.report?.title ?? this.title(s),
      deployed_url: sbx?.render?.url ?? null,
    };
  }
}

/** Cerrada y con algo que reportar: terminó, o se cortó después de partir el ataque. */
export function needsReport(s: SimulationRecord): boolean {
  if (!CLOSED.includes(s.status)) return false;
  return (
    s.status === 'finished' ||
    s.timeline.some((e) => e.type === 'control.start')
  );
}

/** Momento del cierre: el último sim.status de cierre del timeline. */
function closedAt(s: SimulationRecord): string {
  const e = [...s.timeline]
    .reverse()
    .find(
      (x) => x.type === 'sim.status' && CLOSED.includes(String(x.raw?.status)),
    );
  return e?.t ?? s.updated_at;
}
