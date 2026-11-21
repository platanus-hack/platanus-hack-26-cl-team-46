import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../config/env.js';
import { SIM_ROLES, type SimRole } from './simulation.types.js';

/**
 * Token de los threads de una simulación: `<sim_id>.<hmac>`, derivado de
 * AGENT_API_SECRET. Sirve solo para esa simulación. El rol viaja en el header
 * `x-sim-role` (la CLI lo trae fijo). Todos los threads comparten la VM, así
 * que el rol es un control de "carriles" (quién publica qué), no aislamiento.
 */
export function signSimToken(secret: string, simId: string): string {
  return `${simId}.${mac(secret, simId)}`;
}

export function verifySimToken(
  secret: string,
  token: string,
  simId: string,
): boolean {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(secret, simId));
  return (
    token.slice(0, dot) === simId &&
    given.length === expected.length &&
    timingSafeEqual(given, expected)
  );
}

function mac(secret: string, simId: string): string {
  return createHmac('sha256', secret)
    .update(`sim:${simId}`)
    .digest('base64url');
}

export interface SimAgentRequest extends Request {
  simRole: SimRole;
}

@Injectable()
export class SimTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(ctx: ExecutionContext): boolean {
    const secret = this.config.get('AGENT_API_SECRET', { infer: true });
    if (!secret)
      throw new ServiceUnavailableException(
        'AGENT_API_SECRET no está configurado',
      );
    const req = ctx.switchToHttp().getRequest<SimAgentRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const id = String(req.params.id ?? '');
    if (!token || !id || !verifySimToken(secret, token, id)) {
      throw new UnauthorizedException('Token inválido para esta simulación');
    }
    const role = String(req.headers['x-sim-role'] ?? '');
    if (!SIM_ROLES.includes(role as SimRole))
      throw new ForbiddenException(`Rol inválido: ${role || '(vacío)'}`);
    req.simRole = role as SimRole;
    return true;
  }
}
