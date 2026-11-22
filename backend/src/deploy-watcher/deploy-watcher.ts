import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Env } from '../config/env.js';
import { RenderClient } from '../render/render.client.js';

const run = promisify(execFile);

/** Commit en la punta de una rama de un repo público (`git ls-remote`, sin token ni cupo de la API). */
export async function remoteHead(
  repoUrl: string,
  branch: string,
): Promise<string | undefined> {
  const { stdout } = await run(
    'git',
    ['ls-remote', repoUrl, `refs/heads/${branch}`],
    { timeout: 20_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
  );
  const sha = stdout.trim().split(/\s+/)[0];
  return /^[0-9a-f]{40}$/.test(sha ?? '') ? sha : undefined;
}

/**
 * Deploy automático desde el repo de la organización de Platanus Hack.
 *
 * Render solo autodespliega repos de un proveedor Git conectado, y su GitHub App
 * no se puede instalar en la organización `platanus-hack`. Los servicios se
 * conectan al repo por su URL pública, y Render los despliega solo a pedido. Este
 * vigilante revisa la punta de la rama cada SELF_DEPLOY_INTERVAL_SECONDS y, si
 * cambió, le pide a Render el deploy de ese commit en cada servicio de
 * SELF_DEPLOY_SERVICE_IDS (backend y frontend). No usa secretos nuevos: solo la
 * RENDER_API_KEY que el backend ya tiene.
 */
@Injectable()
export class DeployWatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeployWatcher.name);
  private timer?: NodeJS.Timeout;
  private checking = false;
  private readonly repoUrl?: string;
  private readonly branch: string;
  private readonly serviceIds: string[];
  private readonly intervalMs: number;

  constructor(
    config: ConfigService<Env, true>,
    private readonly render: RenderClient,
  ) {
    this.repoUrl = config.get('SELF_DEPLOY_REPO_URL', { infer: true });
    this.branch = config.get('SELF_DEPLOY_BRANCH', { infer: true });
    this.serviceIds = config.get('SELF_DEPLOY_SERVICE_IDS', { infer: true });
    this.intervalMs =
      config.get('SELF_DEPLOY_INTERVAL_SECONDS', { infer: true }) * 1000;
  }

  get enabled() {
    return Boolean(this.repoUrl && this.serviceIds.length);
  }

  onModuleInit() {
    if (!this.enabled) return;
    this.logger.log(
      `Deploy automático: ${this.repoUrl}@${this.branch} → ${this.serviceIds.join(', ')} (cada ${this.intervalMs / 1000} s)`,
    );
    this.timer = setInterval(() => void this.check(), this.intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Despliega la punta de la rama en los servicios que no la tengan. Devuelve los servicios disparados. */
  async check(): Promise<string[]> {
    if (!this.enabled || this.checking) return [];
    this.checking = true;
    const triggered: string[] = [];
    try {
      const sha = await remoteHead(this.repoUrl!, this.branch);
      if (!sha) return [];
      for (const id of this.serviceIds) {
        try {
          const last = await this.render.latestDeploy(id);
          // Ya desplegado o en curso (lo pidió otro tick, u otra instancia durante un deploy).
          if (last?.commit?.id === sha) continue;
          await this.render.triggerDeploy(id, { commitId: sha });
          triggered.push(id);
          this.logger.log(`Deploy de ${sha.slice(0, 7)} en ${id}`);
        } catch (err) {
          this.logger.warn(
            `No se pudo desplegar ${sha.slice(0, 7)} en ${id}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `No se pudo leer ${this.repoUrl}@${this.branch}: ${(err as Error).message}`,
      );
    } finally {
      this.checking = false;
    }
    return triggered;
  }
}
