import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConductorClient } from '../conductor/conductor.client.js';
import { SimulationStore } from './simulation.store.js';
import type {
  SimRole,
  SimThread,
  SimulationRecord,
  TimelineEvent,
} from './simulation.types.js';
import { SimulationsService } from './simulations.service.js';
import { pendingFor } from './timeline.service.js';

const TICK_MS = 4_000;
/** No volver a despertar un thread antes de esto (la sesión tarda en pasar a "working"). */
const REWAKE_COOLDOWN_MS = 15_000;
/** Máximo de eventos por mensaje de despertar; el resto llega en el siguiente. */
const MAX_EVENTS_PER_WAKE = 25;
const MAX_RAW_CHARS = 1_500;

/**
 * Despierta a los threads de Conductor cuando hay eventos que les tocan.
 *
 * Los agentes de Conductor trabajan por turnos: no "escuchan" nada. Cada tick
 * (4 s) se revisa, por thread, si hay eventos nuevos que lo despiertan (según
 * EVENT_TYPES[type].wakes). Si su sesión está idle, se le manda UN mensaje con
 * todos esos eventos y se avanza su cursor. Si está trabajando, se espera a
 * que termine su turno: así los eventos se agrupan y no se encolan mensajes.
 */
@Injectable()
export class SimulationDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SimulationDispatcher.name);
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    private readonly sims: SimulationsService,
    private readonly store: SimulationStore,
    private readonly conductor: ConductorClient,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const s of this.sims.active()) {
        try {
          this.sims.syncSandbox(s.sim_id);
          if (!this.sims.launchingIds.has(s.sim_id)) {
            if (!s.workspace_id) void this.sims.launch(s.sim_id);
            else if (
              s.threads.some((t) => t.mode === 'conductor' && !t.session_id)
            )
              await this.sims.createMissingThreads(s.sim_id);
          }
          for (const t of s.threads)
            await this.maybeWake(this.store.get(s.sim_id)!, t);
        } catch (err) {
          const msg = (err as Error).message;
          this.logger.warn(`[${s.sim_id}] ${msg}`);
          if (/Workspace is (deleted|archived)/i.test(msg))
            await this.failFromWorkspace(s);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private async failFromWorkspace(s: SimulationRecord) {
    const st = await this.conductor
      .workspaceStatus(s.workspace_id!)
      .catch(() => undefined);
    this.sims.fail(
      s.sim_id,
      `El workspace de Conductor no está disponible (${st?.status ?? '?'}): ${st?.errorMessage ?? ''}`.trim(),
    );
  }

  private async maybeWake(s: SimulationRecord, t: SimThread) {
    if (t.mode !== 'conductor' || !t.session_id) return;
    const pending = pendingFor(s.timeline, t.role, t.cursor);
    if (!pending.length) return;
    if (
      t.last_wake_at &&
      Date.now() - new Date(t.last_wake_at).getTime() < REWAKE_COOLDOWN_MS
    )
      return;

    const { status } = await this.conductor.sessionStatus(t.session_id);
    if (status === 'working') return;

    const batch = pending.slice(0, MAX_EVENTS_PER_WAKE);
    await this.conductor.sendMessage(
      t.session_id,
      wakeMessage(s, t.role, batch, pending.length - batch.length),
    );
    this.store.update(s.sim_id, (r) => {
      const x = r.threads.find((y) => y.role === t.role)!;
      x.cursor = Math.max(x.cursor, batch.at(-1)!.seq);
      x.last_wake_at = new Date().toISOString();
      x.wakes += 1;
    });
    this.logger.log(
      `[${s.sim_id}] despertando ${t.role} con ${batch.length} eventos (${status})`,
    );
  }
}

export function wakeMessage(
  s: SimulationRecord,
  role: SimRole,
  events: TimelineEvent[],
  more: number,
): string {
  const lines = events.map((e) => {
    const head = `#${e.seq} ${e.t.slice(11, 19)} · ${e.actor} · \`${e.type}\`${e.vuln_id ? ` · vuln=${e.vuln_id}` : ''}${e.severity !== 'info' ? ` · ${e.severity}` : ''} — ${e.title}`;
    const body = e.body ? `\n  ${e.body.replace(/\n/g, '\n  ')}` : '';
    const raw = Object.keys(e.raw).length
      ? `\n  raw: ${truncate(JSON.stringify(e.raw), MAX_RAW_CHARS)}`
      : '';
    return head + body + raw;
  });
  return [
    `[sim ${s.sim_id}] Eventos nuevos para ti (rol **${role}**, estado de la simulación: ${s.status}):`,
    '',
    ...lines,
    ...(more > 0
      ? [
          '',
          `…y ${more} eventos más (llegan en el próximo mensaje, o usa \`sim inbox\`).`,
        ]
      : []),
    '',
    `Actúa según tu rol con \`node /tmp/sim-${role}.mjs\` y termina tu turno.`,
  ].join('\n');
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…(truncado; usa sim timeline)` : s;
}
