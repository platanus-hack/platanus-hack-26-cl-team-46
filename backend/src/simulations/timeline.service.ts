import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SimulationStore } from './simulation.store.js';
import {
  canPost,
  EVENT_TYPES,
  type Severity,
  type SimActor,
  type SimRole,
  type TimelineEvent,
} from './simulation.types.js';

export interface AppendInput {
  type: string;
  title: string;
  body?: string;
  severity?: Severity;
  vuln_id?: string | null;
  raw?: Record<string, unknown>;
}

type Listener = (e: TimelineEvent) => void;

/**
 * Un cliente SSE que no lee (pestaña colgada, red lenta) acumula eventos en memoria.
 * Pasado este atraso (en chunks) se cierra su stream; EventSource reconecta y sigue
 * desde el último id que recibió.
 */
export const SSE_MAX_BACKLOG = 500;

/** Eventos posteriores a `cursor` que despiertan a `role` (y que no publicó él mismo). */
export function pendingFor(
  timeline: TimelineEvent[],
  role: SimRole,
  cursor: number,
): TimelineEvent[] {
  return timeline.filter(
    (e) =>
      e.seq > cursor &&
      e.actor !== role &&
      EVENT_TYPES[e.type]?.wakes.includes(role),
  );
}

/**
 * El timeline de cada simulación: append-only, con permisos por actor (quién
 * puede publicar qué tipo) y suscripciones en vivo para el SSE y el dispatcher.
 */
@Injectable()
export class TimelineService {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly global = new Set<Listener>();

  constructor(private readonly store: SimulationStore) {}

  append(
    simId: string,
    actor: SimActor,
    input: AppendInput,
    opts: { trusted?: boolean } = {},
  ): TimelineEvent {
    const spec = EVENT_TYPES[input.type];
    if (!spec)
      throw new BadRequestException(
        `Tipo de evento desconocido: ${input.type}`,
      );
    if (!opts.trusted && !canPost(actor, input.type)) {
      throw new ForbiddenException(
        `El rol ${actor} no puede publicar ${input.type}`,
      );
    }
    let event!: TimelineEvent;
    this.store.update(simId, (s) => {
      const raw = input.raw ?? {};
      event = {
        seq: s.next_seq++,
        t: new Date().toISOString(),
        sim_id: simId,
        actor,
        type: input.type,
        visibility: spec.visibility,
        vuln_id: input.vuln_id ?? null,
        source:
          input.type === 'notify' && typeof raw.channel === 'string'
            ? raw.channel
            : actor,
        severity: input.severity ?? 'info',
        title: input.title,
        body: input.body ?? '',
        raw,
      };
      s.timeline.push(event);
    });
    for (const l of this.listeners.get(simId) ?? []) {
      try {
        l(event);
      } catch {
        // un stream roto no puede impedir que el evento quede publicado
      }
    }
    for (const l of this.global) {
      try {
        l(event);
      } catch {
        // un oyente roto no puede impedir que el evento quede publicado
      }
    }
    return event;
  }

  /** Oyente de todos los eventos de todas las simulaciones (dispatcher y cerebro). */
  onAppend(listener: Listener): () => void {
    this.global.add(listener);
    return () => this.global.delete(listener);
  }

  list(
    simId: string,
    opts: {
      since?: number;
      view?: 'user' | 'all';
      types?: string[];
      limit?: number;
    } = {},
  ) {
    const s = this.store.get(simId);
    let events = s?.timeline ?? [];
    if (opts.since !== undefined)
      events = events.filter((e) => e.seq > opts.since!);
    if (opts.view === 'user')
      events = events.filter((e) => e.visibility === 'user');
    if (opts.types?.length) {
      events = events.filter((e) =>
        opts.types!.some((t) =>
          t.endsWith('.*') ? e.type.startsWith(t.slice(0, -1)) : e.type === t,
        ),
      );
    }
    if (opts.limit) events = events.slice(-opts.limit);
    return events;
  }

  subscribe(simId: string, listener: Listener): () => void {
    const set = this.listeners.get(simId) ?? new Set();
    set.add(listener);
    this.listeners.set(simId, set);
    return () => {
      set.delete(listener);
      if (!set.size && this.listeners.get(simId) === set)
        this.listeners.delete(simId);
    };
  }

  /** Suscriptores en vivo de una simulación (streams SSE abiertos). */
  listenerCount(simId: string): number {
    return this.listeners.get(simId)?.size ?? 0;
  }

  /** SSE: historial + en vivo. view=user filtra lo que ve el developer. */
  sseStream(
    simId: string,
    view: 'user' | 'all',
    since?: number,
  ): ReadableStream<string> {
    let unsubscribe = () => {};
    let heartbeat: NodeJS.Timeout | undefined;
    let closed = false;
    const visible = (e: TimelineEvent) =>
      view === 'all' || e.visibility === 'user';
    const format = (e: TimelineEvent) =>
      `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
    const cleanup = () => {
      closed = true;
      unsubscribe();
      clearInterval(heartbeat);
    };
    return new ReadableStream<string>({
      start: (controller) => {
        const send = (chunk: string) => {
          if (closed) return;
          // Sin backpressure el atraso crece sin tope: se corta y el cliente reconecta.
          if ((controller.desiredSize ?? 0) < -SSE_MAX_BACKLOG) {
            cleanup();
            try {
              controller.close();
            } catch {
              // ya estaba cerrado
            }
            return;
          }
          try {
            controller.enqueue(chunk);
          } catch {
            cleanup();
          }
        };
        // El historial va en un solo chunk: no cuenta como atraso del cliente.
        send(
          ': connected\n\n' +
            this.list(simId, { since, view }).map(format).join(''),
        );
        if (closed) return;
        unsubscribe = this.subscribe(simId, (e) => {
          if (visible(e)) send(format(e));
        });
        heartbeat = setInterval(() => send(': ping\n\n'), 15_000);
        heartbeat.unref?.();
      },
      cancel: cleanup,
    });
  }
}
