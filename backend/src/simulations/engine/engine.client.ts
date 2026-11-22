import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';

/** Lo que devuelve una corrida del motor (engine/modal_app.py › run_engagement). */
export interface EngineRunResult {
  ok: boolean;
  exit_code: number;
  duration_s: number;
  log: string;
  stderr: string;
  artifacts: Record<string, unknown>;
}

export type EngineRunStatus =
  | { status: 'running' }
  | { status: 'done'; result: EngineRunResult }
  | { status: 'failed'; error: string };

/**
 * Cliente de la API privada del motor en Modal (engine/docs/MODAL.md):
 * POST /runs lanza una corrida y GET /runs/:id dice si terminó. Autentica con
 * un Proxy Auth Token de Modal.
 */
@Injectable()
export class EngineClient {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get enabled(): boolean {
    return Boolean(this.url && this.key && this.secret);
  }

  async start(spec: Record<string, unknown>): Promise<string> {
    const res = await this.fetch('/runs', {
      method: 'POST',
      body: JSON.stringify(spec),
    });
    const body = (await res.json().catch(() => ({}))) as {
      call_id?: string;
      detail?: string;
    };
    if (!res.ok || !body.call_id)
      throw new Error(
        `El motor rechazó la corrida (${res.status}): ${body.detail ?? 'sin detalle'}`,
      );
    return body.call_id;
  }

  async status(callId: string): Promise<EngineRunStatus> {
    const res = await this.fetch(`/runs/${encodeURIComponent(callId)}`);
    if (res.status === 202) return { status: 'running' };
    const body = (await res.json().catch(() => ({}))) as {
      status?: string;
      result?: EngineRunResult;
      error?: string;
      detail?: string;
    };
    // Terminal solo si la API del motor lo dice (410 expiró, 404 con detalle propio).
    // 5xx, 401 o un 404 del gateway de Modal son transitorios: se lanza y se
    // reintenta en el próximo sondeo (EngineHacker corta por tiempo máximo).
    if (res.status === 410 || (res.status === 404 && body.detail))
      return {
        status: 'failed',
        error: `El motor respondió ${res.status}: ${body.detail ?? ''}`.trim(),
      };
    if (!res.ok)
      throw new Error(`El motor respondió ${res.status} (se reintenta)`);
    if (body.status === 'done' && body.result)
      return { status: 'done', result: body.result };
    return { status: 'failed', error: body.error ?? 'La corrida falló' };
  }

  private fetch(path: string, init: RequestInit = {}) {
    return fetch(`${this.url!.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'Modal-Key': this.key!,
        'Modal-Secret': this.secret!,
      },
      signal: AbortSignal.timeout(30_000),
    });
  }

  private get url() {
    return this.config.get('ENGINE_URL', { infer: true });
  }
  private get key() {
    return this.config.get('ENGINE_MODAL_KEY', { infer: true });
  }
  private get secret() {
    return this.config.get('ENGINE_MODAL_SECRET', { infer: true });
  }
}
