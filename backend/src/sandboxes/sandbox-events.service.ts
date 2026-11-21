import { Injectable } from '@nestjs/common';
import type { SandboxEvent } from './sandbox.types.js';

type Listener = (e: SandboxEvent) => void;

/**
 * Bus de eventos por sandbox con historial, para que un cliente que se
 * conecta tarde (UI, motor) reciba todo lo que pasó desde el inicio.
 */
@Injectable()
export class SandboxEventsService {
  private readonly history = new Map<string, SandboxEvent[]>();
  private readonly listeners = new Map<string, Set<Listener>>();

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
    const list = this.history.get(sandboxId) ?? [];
    list.push(event);
    if (list.length > 500) list.shift();
    this.history.set(sandboxId, list);
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
    const format = (e: SandboxEvent) => `event: ${e.source}\ndata: ${JSON.stringify(e)}\n\n`;
    return new ReadableStream<string>({
      start: (controller) => {
        controller.enqueue(': connected\n\n');
        for (const e of this.getHistory(sandboxId)) controller.enqueue(format(e));
        unsubscribe = this.subscribe(sandboxId, (e) => controller.enqueue(format(e)));
        heartbeat = setInterval(() => controller.enqueue(': ping\n\n'), 15_000);
      },
      cancel: () => {
        unsubscribe();
        clearInterval(heartbeat);
      },
    });
  }
}
