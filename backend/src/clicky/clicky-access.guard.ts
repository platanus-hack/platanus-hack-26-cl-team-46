import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../config/env.js';
import { SimulationsService } from '../simulations/simulations.service.js';

/**
 * Estados en que Clicky responde: en curso y también terminada (para repasar qué pasó).
 * Con una simulación fallida o detenida no hay nada que mirar.
 */
export const CLICKY_ACTIVE = [
  'starting',
  'ready',
  'running',
  'paused',
  'finished',
];

export interface ClickyRequest extends Request {
  clickySimId: string;
  /** Estado de la simulación: en curso, Clicky guía sin dar la solución; terminada, explica todo. */
  clickySimStatus: string;
}

/**
 * Acceso a Clicky: solo con una simulación en curso o terminada (`x-sim-id`) y con un límite
 * de preguntas por minuto por IP. No es autenticación de usuario (la app no tiene
 * login); acota quién puede gastar las keys y cuánto. El tope por simulación vive
 * en ClickyService.
 */
@Injectable()
export class ClickyAccessGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly sims: SimulationsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<ClickyRequest>();
    this.rateLimit(req.ip ?? 'unknown');
    const simId = String(req.headers['x-sim-id'] ?? '');
    if (!/^sim-[a-f0-9]{8}$/.test(simId))
      throw new HttpException(
        'Clicky funciona dentro de una simulación (falta x-sim-id)',
        HttpStatus.UNAUTHORIZED,
      );
    const sim = this.sims.get(simId); // 404 si no existe
    if (!CLICKY_ACTIVE.includes(sim.status))
      throw new ConflictException(
        `La simulación está ${sim.status}: Clicky solo responde con una simulación en curso o terminada`,
      );
    req.clickySimId = simId;
    req.clickySimStatus = sim.status;
    return true;
  }

  private rateLimit(ip: string) {
    const max = this.config.get('CLICKY_RATE_LIMIT', { infer: true });
    const now = Date.now();
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < 60_000);
    recent.push(now);
    this.hits.set(ip, recent);
    if (this.hits.size > 5000)
      for (const [k, v] of this.hits)
        if (now - (v.at(-1) ?? 0) > 60_000) this.hits.delete(k);
    if (recent.length > max)
      throw new HttpException(
        'Demasiadas preguntas seguidas, espera un momento',
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }
}
