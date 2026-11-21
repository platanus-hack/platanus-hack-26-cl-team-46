import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type {
  CreateWebServiceInput,
  ListLogsQuery,
  RenderDeploy,
  RenderLogsPage,
  RenderOwner,
  RenderPostgres,
  RenderPostgresConnectionInfo,
  RenderRegion,
  RenderEnvVarInput,
  RenderService,
} from './render.types.js';

function envSpecificDetails(
  input: Pick<CreateWebServiceInput, 'runtime' | 'buildCommand' | 'startCommand' | 'dockerfilePath' | 'dockerContext'>,
) {
  return input.runtime === 'docker'
    ? { dockerfilePath: input.dockerfilePath ?? './Dockerfile', dockerContext: input.dockerContext ?? '.' }
    : { buildCommand: input.buildCommand, startCommand: input.startCommand };
}

const BASE_URL = 'https://api.render.com/v1';

export class RenderApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: unknown,
  ) {
    const detail =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : JSON.stringify(body);
    super(`Render API ${method} ${path} → ${status}: ${detail}`);
  }
}

/** Las respuestas de listado de Render vienen como [{ cursor, <recurso> }]. */
type Listed<K extends string, T> = Array<{ cursor: string } & Record<K, T>>;

/**
 * Cliente delgado de la API v1 de Render. No tiene lógica de negocio:
 * la orquestación vive en SandboxesService.
 */
@Injectable()
export class RenderClient {
  private readonly logger = new Logger(RenderClient.name);
  private readonly apiKey: string;
  private ownerIdPromise?: Promise<string>;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.apiKey = this.config.get('RENDER_API_KEY', { infer: true });
  }

  // ---------------------------------------------------------------- owners

  /** ID del workspace de Render (RENDER_OWNER_ID o el primero de la cuenta). */
  ownerId(): Promise<string> {
    this.ownerIdPromise ??= (async () => {
      const configured = this.config.get('RENDER_OWNER_ID', { infer: true });
      if (configured) return configured;
      const owners = await this.request<Listed<'owner', RenderOwner>>('GET', '/owners?limit=20');
      const first = owners[0]?.owner;
      if (!first) throw new Error('La API key de Render no tiene ningún workspace asociado');
      this.logger.log(`Usando workspace de Render "${first.name}" (${first.id})`);
      return first.id;
    })();
    return this.ownerIdPromise;
  }

  // -------------------------------------------------------------- services

  async createWebService(input: CreateWebServiceInput): Promise<{ service: RenderService; deployId?: string }> {
    const body = {
      type: 'web_service',
      name: input.name,
      ownerId: input.ownerId,
      repo: input.repo,
      branch: input.branch,
      rootDir: input.rootDir,
      autoDeployTrigger: 'off',
      envVars: input.envVars ?? [],
      serviceDetails: {
        runtime: input.runtime,
        plan: input.plan,
        region: input.region,
        healthCheckPath: input.healthCheckPath,
        envSpecificDetails: envSpecificDetails(input),
      },
    };
    const res = await this.request<{ service?: RenderService; deployId?: string } & Partial<RenderService>>(
      'POST',
      '/services',
      body,
    );
    // La API devuelve { service, deployId }; por si acaso aceptamos también el servicio plano.
    const service = (res.service ?? res) as RenderService;
    return { service, deployId: res.deployId };
  }

  /** Actualiza runtime/build/start/healthcheck de un servicio existente. No despliega. */
  async updateWebService(
    serviceId: string,
    input: Pick<
      CreateWebServiceInput,
      'runtime' | 'rootDir' | 'healthCheckPath' | 'buildCommand' | 'startCommand' | 'dockerfilePath' | 'dockerContext'
    >,
  ): Promise<RenderService> {
    return this.request('PATCH', `/services/${serviceId}`, {
      rootDir: input.rootDir ?? '',
      serviceDetails: {
        runtime: input.runtime,
        healthCheckPath: input.healthCheckPath ?? '',
        envSpecificDetails: envSpecificDetails(input),
      },
    });
  }

  /** Reemplaza TODAS las env vars del servicio. No despliega. */
  async replaceEnvVars(serviceId: string, envVars: RenderEnvVarInput[]): Promise<void> {
    await this.request('PUT', `/services/${serviceId}/env-vars`, envVars);
  }

  getService(serviceId: string): Promise<RenderService> {
    return this.request('GET', `/services/${serviceId}`);
  }

  async deleteService(serviceId: string): Promise<void> {
    await this.request('DELETE', `/services/${serviceId}`, undefined, { allow404: true });
  }

  async restartService(serviceId: string): Promise<void> {
    await this.request('POST', `/services/${serviceId}/restart`);
  }

  async setEnvVar(serviceId: string, key: string, value: string | { generate: true }): Promise<void> {
    const body = typeof value === 'string' ? { value } : { generateValue: true };
    await this.request('PUT', `/services/${serviceId}/env-vars/${encodeURIComponent(key)}`, body);
  }

  async deleteEnvVar(serviceId: string, key: string): Promise<void> {
    await this.request('DELETE', `/services/${serviceId}/env-vars/${encodeURIComponent(key)}`, undefined, {
      allow404: true,
    });
  }

  // --------------------------------------------------------------- deploys

  /** Gatilla un deploy. Devuelve undefined si Render lo dejó en cola sin id (202). */
  async triggerDeploy(
    serviceId: string,
    opts: { commitId?: string; clearCache?: boolean } = {},
  ): Promise<RenderDeploy | undefined> {
    const res = await this.request<RenderDeploy | undefined>('POST', `/services/${serviceId}/deploys`, {
      clearCache: opts.clearCache ? 'clear' : 'do_not_clear',
      commitId: opts.commitId,
    });
    return res && 'id' in res ? res : undefined;
  }

  getDeploy(serviceId: string, deployId: string): Promise<RenderDeploy> {
    return this.request('GET', `/services/${serviceId}/deploys/${deployId}`);
  }

  async latestDeploy(serviceId: string): Promise<RenderDeploy | undefined> {
    const list = await this.request<Listed<'deploy', RenderDeploy>>('GET', `/services/${serviceId}/deploys?limit=1`);
    return list[0]?.deploy;
  }

  // -------------------------------------------------------------- postgres

  async createPostgres(input: {
    name: string;
    ownerId: string;
    plan: string;
    version: string;
    region: RenderRegion;
    databaseName?: string;
  }): Promise<RenderPostgres> {
    return this.request('POST', '/postgres', {
      ...input,
      // Permitimos conexiones externas para poder crear bases por sandbox desde el backend.
      ipAllowList: [{ cidrBlock: '0.0.0.0/0', description: 'hack26 deployer' }],
    });
  }

  async findPostgresByName(name: string): Promise<RenderPostgres | undefined> {
    const ownerId = await this.ownerId();
    const qs = new URLSearchParams({ name, ownerId, limit: '20' });
    const list = await this.request<Listed<'postgres', RenderPostgres>>('GET', `/postgres?${qs}`);
    return list.map((x) => x.postgres).find((p) => p.name === name);
  }

  getPostgres(postgresId: string): Promise<RenderPostgres> {
    return this.request('GET', `/postgres/${postgresId}`);
  }

  getPostgresConnectionInfo(postgresId: string): Promise<RenderPostgresConnectionInfo> {
    return this.request('GET', `/postgres/${postgresId}/connection-info`);
  }

  async deletePostgres(postgresId: string): Promise<void> {
    await this.request('DELETE', `/postgres/${postgresId}`, undefined, { allow404: true });
  }

  // ------------------------------------------------------------------ logs

  async listLogs(query: ListLogsQuery): Promise<RenderLogsPage> {
    const qs = new URLSearchParams({ ownerId: await this.ownerId() });
    for (const r of query.resource) qs.append('resource', r);
    for (const t of query.type ?? []) qs.append('type', t);
    for (const t of query.text ?? []) qs.append('text', t);
    for (const l of query.level ?? []) qs.append('level', l);
    if (query.startTime) qs.set('startTime', query.startTime);
    if (query.endTime) qs.set('endTime', query.endTime);
    if (query.direction) qs.set('direction', query.direction);
    if (query.limit) qs.set('limit', String(query.limit));
    return this.request('GET', `/logs?${qs}`);
  }

  // ------------------------------------------------------------- transport

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { allow404?: boolean } = {},
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      // Rate limit: reintenta con backoff.
      if (res.status === 429 && attempt < 5) {
        const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt;
        this.logger.warn(`Render rate limit en ${method} ${path}; reintento en ${retryAfter}s`);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }
      if (res.status === 404 && opts.allow404) return undefined as T;

      const text = await res.text();
      let parsed: unknown = undefined;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      if (!res.ok) throw new RenderApiError(res.status, method, path, parsed);
      return parsed as T;
    }
  }
}
