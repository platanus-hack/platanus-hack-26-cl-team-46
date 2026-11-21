import {
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthService, type AuthUser } from './auth.service.js';
import { CurrentUser, SessionGuard } from './session.guard.js';
import {
  readCookie,
  serializeCookie,
  SESSION_TTL_MS,
  sessionCookieName,
  signValue,
  STATE_TTL_MS,
  stateCookieName,
  verifyValue,
} from './session.js';

interface OAuthState {
  nonce: string;
  next: string;
  exp: number;
}

/** Solo rutas internas del frontend: evita redirecciones abiertas (`//evil.com`, `https://…`). */
export function safeNext(next: unknown): string {
  return typeof next === 'string' && /^\/(?![/\\])/.test(next)
    ? next
    : '/start/repos';
}

/**
 * Login con GitHub (GitHub App, sin revisión de GitHub).
 *
 * GET  /auth/github/login?next=/ruta → github.com/login/oauth/authorize
 * GET  /auth/github/callback          → cookie de sesión y vuelta al frontend
 * GET  /auth/me                       → { enabled, user, install_url }
 * POST /auth/logout
 * GET  /auth/repos                    → repos que el usuario compartió con la app
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('github/login')
  login(@Query('next') next: string | undefined, @Res() res: Response) {
    if (!this.auth.enabled)
      return res.redirect(
        `${this.auth.frontendUrl}/start/github?error=not_configured`,
      );
    const nonce = randomBytes(16).toString('hex');
    const state: OAuthState = {
      nonce,
      next: safeNext(next),
      exp: Date.now() + STATE_TTL_MS,
    };
    res.setHeader(
      'Set-Cookie',
      serializeCookie(
        stateCookieName(this.auth.secureCookies),
        signValue(this.auth.sessionSecret, state),
        { maxAgeMs: STATE_TTL_MS, secure: this.auth.secureCookies },
      ),
    );
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', this.auth.clientId!);
    url.searchParams.set('redirect_uri', this.auth.callbackUrl);
    url.searchParams.set('state', nonce);
    return res.redirect(url.toString());
  }

  @Get('github/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') stateParam: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const front = this.auth.frontendUrl;
    const secure = this.auth.secureCookies;
    const clearState = serializeCookie(stateCookieName(secure), '', {
      maxAgeMs: 0,
      secure,
    });
    const fail = (reason: string) => {
      res.setHeader('Set-Cookie', clearState);
      return res.redirect(`${front}/start/github?error=${reason}`);
    };
    if (!this.auth.enabled) return fail('not_configured');
    if (error) return fail('denied');

    const state = verifyValue<OAuthState>(
      this.auth.sessionSecret,
      readCookie(req.headers.cookie, stateCookieName(secure)),
    );
    const ok =
      !!code &&
      !!stateParam &&
      !!state &&
      state.exp > Date.now() &&
      state.nonce.length === stateParam.length &&
      timingSafeEqual(Buffer.from(state.nonce), Buffer.from(stateParam));
    if (!ok) return fail('state');

    try {
      const user = await this.auth.completeLogin(code);
      res.setHeader('Set-Cookie', [
        clearState,
        serializeCookie(
          sessionCookieName(secure),
          this.auth.sessionCookieValue(user),
          {
            maxAgeMs: SESSION_TTL_MS,
            secure,
          },
        ),
      ]);
      return res.redirect(`${front}${safeNext(state.next)}`);
    } catch {
      return fail('exchange');
    }
  }

  @Get('me')
  me(@Req() req: Request) {
    const user = this.auth.userFrom(req);
    return {
      enabled: this.auth.enabled,
      install_url: this.auth.installUrl,
      user: user
        ? { ...this.auth.profile(user.github_id), admin: user.admin }
        : null,
    };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res() res: Response) {
    const secure = this.auth.secureCookies;
    res.setHeader(
      'Set-Cookie',
      serializeCookie(sessionCookieName(secure), '', { maxAgeMs: 0, secure }),
    );
    return res.json({ ok: true });
  }

  @Get('repos')
  @UseGuards(SessionGuard)
  repos(@CurrentUser() user: AuthUser | null) {
    if (!user) return [];
    return this.auth.listRepos(user.github_id);
  }
}
