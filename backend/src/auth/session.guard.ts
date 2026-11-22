import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, type AuthUser } from './auth.service.js';

export interface AuthedRequest extends Request {
  authUser: AuthUser | null;
}

/**
 * Exige sesión cuando el login está encendido (401 si no hay). Con el login apagado deja
 * pasar con `authUser = null`. Va por controlador (no global): /agent y /sim tienen sus
 * propios tokens y el proxy de preview no pasa por Nest.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    req.authUser = this.auth.userFrom(req);
    if (this.auth.enabled && !req.authUser)
      throw new UnauthorizedException('Entra con GitHub para continuar');
    return true;
  }
}

/** Usuario de la request (null con el login apagado). Requiere SessionGuard. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser | null =>
    ctx.switchToHttp().getRequest<AuthedRequest>().authUser ?? null,
);
