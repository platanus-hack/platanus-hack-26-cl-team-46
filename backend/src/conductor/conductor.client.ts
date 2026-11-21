import { Injectable } from '@nestjs/common';
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
      env: input.env,
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

  sessionStatus(
    sessionId: string,
  ): Promise<{
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
    if (!this.apiKey) throw new Error('CONDUCTOR_API_KEY no está configurada');
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok)
      throw new Error(`Conductor ${method} ${path} → ${res.status}: ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
