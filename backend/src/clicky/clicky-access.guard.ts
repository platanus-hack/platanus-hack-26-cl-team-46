import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service.js';
import type { Env } from '../config/env.js';
import type { SimulationRecord } from '../simulations/simulation.types.js';
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
  /** La simulación completa: de ahí sale lo que Hinty sabe del simulacro (sim-brief.ts). */
  clickySim: SimulationRecord;
}

/**
 * Acceso a Clicky: solo con una simulación en curso o terminada (`x-sim-id`) y con un límite
 * de preguntas por minuto por IP. Con el login encendido (src/auth), además la simulación
 * tiene que ser del usuario de la sesión. El tope por simulación vive en ClickyService.
 */
@Injectable()
export class ClickyAccessGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly sims: SimulationsService,
    private readonly config: ConfigService<Env, true>,
    private readonly auth: AuthService,
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
    const user = this.auth.userFrom(req);
    if (this.auth.enabled && !user)
      throw new UnauthorizedException('Entra con GitHub para continuar');
    const sim = this.sims.get(simId); // 404 si no existe
    this.auth.assertAccess(user, this.sims.ownerOf(sim), `Simulación ${simId}`);
    if (!CLICKY_ACTIVE.includes(sim.status))
      throw new ConflictException(
        `La simulación está ${sim.status}: Clicky solo responde con una simulación en curso o terminada`,
      );
    req.clickySimId = simId;
    req.clickySimStatus = sim.status;
    req.clickySim = sim;
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
