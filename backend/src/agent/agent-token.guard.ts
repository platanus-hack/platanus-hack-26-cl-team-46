import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../config/env.js';
import { verifyAgentToken } from './agent-token.js';

/**
 * Protege /agent/sandboxes/:id/*. Exige `Authorization: Bearer <token>`,
 * con un token derivado de AGENT_API_SECRET para ese sandbox en particular.
 */
@Injectable()
export class AgentTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(ctx: ExecutionContext): boolean {
    const secret = this.config.get('AGENT_API_SECRET', { infer: true });
    if (!secret)
      throw new ServiceUnavailableException(
        'AGENT_API_SECRET no está configurado',
      );
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const id = String(req.params.id ?? '');
    if (!token || !id || !verifyAgentToken(secret, token, id)) {
      throw new UnauthorizedException(
        'Token de agente inválido para este sandbox',
      );
    }
    return true;
  }
}
