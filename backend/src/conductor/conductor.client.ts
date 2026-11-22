import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

export type ConductorSessionStatus = 'idle' | 'working' | 'error';
export type ConductorWorkspaceStatus =
  'initializing' | 'ready' | 'sleeping' | 'archived' | 'deleted' | 'updating';

export interface CreateWorkspaceInput {
  name: string;
  sessionName: string;
  message: string;
  env: Record<string, string>;
}

/**
 * Cliente mínimo de la API v0 de Conductor (la misma que usa la CLI
 * `conductor`). Cada agente de deploy corre en su propio workspace (VM).
 */
@Injectable()
export class ConductorClient {
  private readonly logger = new Logger(ConductorClient.name);
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.baseUrl = this.config
      .get('CONDUCTOR_API_URL', { infer: true })
      .replace(/\/+$/, '');
    this.apiKey = this.config.get('CONDUCTOR_API_KEY', { infer: true });
  }

  createWorkspace(
    input: CreateWorkspaceInput,
  ): Promise<{ workspaceId: string; sessionId: string; deepLink: string }> {
    const branch = this.config.get('CONDUCTOR_PROJECT_BRANCH', { infer: true });
    return this.request('POST', '/v0/workspaces', {
      projectId: this.config.get('CONDUCTOR_PROJECT_ID', { infer: true }),
      ...(branch ? { branch } : {}),
      name: input.name,
      sessionName: input.sessionName,
      agent: 'claude',
      model: this.config.get('AGENT_MODEL', { infer: true }),
      effort: this.config.get('AGENT_EFFORT', { infer: true }),
      env: agentEnv(
        this.config.get('CONDUCTOR_AGENT_BLANK_ENV', { infer: true }),
        input.env,
      ),
      message: input.message,
    });
  }

  /** Crea otro thread (sesión) dentro de un workspace existente. */
  createSession(input: {
    workspaceId: string;
    name: string;
    message: string;
  }): Promise<{ id: string; deepLink: string }> {
    return this.request('POST', '/v0/sessions', {
      workspaceId: input.workspaceId,
      name: input.name,
      agent: 'claude',
      model: this.config.get('AGENT_MODEL', { infer: true }),
      effort: this.config.get('AGENT_EFFORT', { infer: true }),
      message: input.message,
    });
  }

  sessionStatus(sessionId: string): Promise<{
    status: ConductorSessionStatus;
    errorMessage?: string;
    lastError?: string;
  }> {
    return this.request(
      'GET',
      `/v0/sessions/${encodeURIComponent(sessionId)}/status`,
    );
  }

  workspaceStatus(
    workspaceId: string,
  ): Promise<{ status: ConductorWorkspaceStatus; errorMessage?: string }> {
    return this.request(
      'GET',
      `/v0/workspaces/${encodeURIComponent(workspaceId)}/status`,
    );
  }

  sendMessage(sessionId: string, message: string): Promise<unknown> {
    return this.request(
      'POST',
      `/v0/sessions/${encodeURIComponent(sessionId)}/messages`,
      { message },
    );
  }

  archiveWorkspace(workspaceId: string): Promise<unknown> {
    return this.request(
      'POST',
      `/v0/workspaces/${encodeURIComponent(workspaceId)}/archive`,
    );
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    // Estos mensajes pueden terminar en pantalla (error del sandbox o de la simulación): nunca
    // nombran al proveedor. El detalle completo queda en el log.
    if (!this.apiKey) {
      this.logger.error('CONDUCTOR_API_KEY no está configurada');
      throw new Error('El servicio de agentes no está configurado');
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      this.logger.error(`${method} ${path} → ${res.status}: ${text}`);
      throw new Error(
        `El servicio de agentes respondió con un error (HTTP ${res.status})`,
      );
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

/**
 * Env de la VM de un agente: las credenciales globales de Conductor quedan
 * vacías (las variables del workspace pisan a las globales) y encima van las
 * variables propias del agente.
 */
export function agentEnv(
  blank: string[],
  env: Record<string, string>,
): Record<string, string> {
  return {
    ...Object.fromEntries(blank.map((k) => [k, ''])),
    ...env,
  };
}
