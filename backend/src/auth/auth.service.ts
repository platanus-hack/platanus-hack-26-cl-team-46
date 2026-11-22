import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage } from 'node:http';
import type { Env } from '../config/env.js';
import {
  decryptToken,
  encryptToken,
  readCookie,
  SESSION_TTL_MS,
  sessionCookieName,
  signSession,
  verifySession,
} from './session.js';
import { UsersStore, type UserRecord } from './users.store.js';

/** El usuario de la request (lo que necesitan los controladores). */
export interface AuthUser {
  github_id: number;
  login: string;
  admin: boolean;
}

/** Dueño de un sandbox (se guarda en el record). */
export interface Owner {
  github_id: number;
  login: string;
}

/** Repo como lo muestra el onboarding (mismo shape que la API de GitHub, recortado). */
export interface RepoView {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  pushed_at: string | null;
  fork: boolean;
  archived: boolean;
  size: number;
  private: boolean;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

const GITHUB_API = 'https://api.github.com';

/**
 * Login con GitHub (GitHub App) y reglas de acceso.
 *
 * - Apagado (sin GITHUB_APP_CLIENT_ID/SECRET o SESSION_SECRET): la API queda abierta como
 *   antes y nadie es dueño de nada. Sirve para desarrollo y mientras no exista la app.
 * - Encendido: /sandboxes y /simulations exigen sesión; cada uno ve y toca solo lo suyo.
 *   Los logins de ADMIN_GITHUB_LOGINS (el equipo) ven todo.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly secret?: string;
  readonly appSlug?: string;
  private readonly admins: string[];
  readonly frontendUrl: string;
  readonly callbackUrl: string;
  /** Cookies Secure (__Host-) cuando el backend se sirve por https. */
  readonly secureCookies: boolean;

  constructor(
    config: ConfigService<Env, true>,
    private readonly users: UsersStore,
  ) {
    this.clientId = config.get('GITHUB_APP_CLIENT_ID', { infer: true });
    this.clientSecret = config.get('GITHUB_APP_CLIENT_SECRET', { infer: true });
    this.secret = config.get('SESSION_SECRET', { infer: true });
    this.appSlug = config.get('GITHUB_APP_SLUG', { infer: true });
    this.admins = config.get('ADMIN_GITHUB_LOGINS', { infer: true });
    const cors = config
      .get('CORS_ORIGIN', { infer: true })
      .split(',')[0]
      .trim();
    this.frontendUrl = (
      config.get('FRONTEND_URL', { infer: true }) ?? cors
    ).replace(/\/+$/, '');
    const backend =
      config.get('PUBLIC_BACKEND_URL', { infer: true }) ??
      `http://localhost:${config.get('PORT', { infer: true })}`;
    this.callbackUrl =
      config.get('AUTH_CALLBACK_URL', { infer: true }) ??
      `${backend.replace(/\/+$/, '')}/auth/github/callback`;
    this.secureCookies = this.callbackUrl.startsWith('https://');
    if (!this.enabled)
      this.logger.warn(
        'Login con GitHub apagado (faltan GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET o SESSION_SECRET): la API queda abierta',
      );
  }

  get enabled(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.secret);
  }

  get sessionSecret(): string {
    if (!this.secret) throw new Error('SESSION_SECRET no configurado');
    return this.secret;
  }

  /** Link para que el usuario comparta (más) repos con la app. */
  get installUrl(): string | null {
    return this.appSlug
      ? `https://github.com/apps/${this.appSlug}/installations/new`
      : null;
  }

  // ------------------------------------------------------------------ sesión

  /** Usuario de la request, o null si no hay sesión válida (o el login está apagado). */
  userFrom(req: IncomingMessage): AuthUser | null {
    if (!this.enabled) return null;
    const raw = readCookie(
      req.headers.cookie,
      sessionCookieName(this.secureCookies),
    );
    const s = verifySession(this.sessionSecret, raw);
    // Cargamos el usuario en cada request: si no existe en el store, la sesión no vale.
    if (!s || !this.users.get(s.uid)) return null;
    return {
      github_id: s.uid,
      login: s.login,
      admin: this.admins.includes(s.login.toLowerCase()),
    };
  }

  sessionCookieValue(user: UserRecord): string {
    return signSession(this.sessionSecret, {
      uid: user.github_id,
      login: user.login,
      exp: Date.now() + SESSION_TTL_MS,
    });
  }

  // ------------------------------------------------------------------ acceso

  /**
   * ¿Puede `user` ver o tocar algo de `owner`? Con el login apagado, todo es de todos.
   * Lo que no tiene dueño (creado antes del login) solo lo ven los admins.
   */
  canAccess(user: AuthUser | null, owner: Owner | undefined): boolean {
    if (!this.enabled) return true;
    if (!user) return false;
    if (user.admin) return true;
    return owner?.github_id === user.github_id;
  }

  /** 404 (no 403) para no confirmar que el recurso existe. */
  assertAccess(user: AuthUser | null, owner: Owner | undefined, what: string) {
    if (!this.canAccess(user, owner))
      throw new NotFoundException(`${what} no existe`);
  }

  ownerOf(user: AuthUser | null): Owner | undefined {
    return user ? { github_id: user.github_id, login: user.login } : undefined;
  }

  // ------------------------------------------------------------------ GitHub

  /** Cambia el `code` del callback por tokens, carga el perfil y guarda el usuario. */
  async completeLogin(code: string): Promise<UserRecord> {
    const tokens = await this.tokenRequest({
      code,
      redirect_uri: this.callbackUrl,
    });
    const res = await this.gh(tokens.access_token!, '/user');
    if (!res.ok) throw new UnauthorizedException('GitHub no entregó el perfil');
    const u = (await res.json()) as {
      id: number;
      login: string;
      name: string | null;
      avatar_url: string;
    };
    return this.users.upsert({
      github_id: u.id,
      login: u.login,
      name: u.name,
      avatar_url: u.avatar_url,
      ...this.sealTokens(tokens),
    });
  }

  profile(githubId: number) {
    const u = this.users.get(githubId);
    return u
      ? { login: u.login, name: u.name, avatar_url: u.avatar_url }
      : null;
  }

  /** Token vigente del usuario (lo renueva si venció y hay refresh token). */
  async tokenFor(githubId: number): Promise<string> {
    const u = this.users.get(githubId);
    if (!u) throw new UnauthorizedException('Vuelve a entrar con GitHub');
    const soon = Date.now() + 60_000;
    if (!u.token_expires_at || new Date(u.token_expires_at).getTime() > soon) {
      const t = decryptToken(this.sessionSecret, u.token);
      if (t) return t;
    }
    const refresh =
      u.refresh_token && decryptToken(this.sessionSecret, u.refresh_token);
    if (!refresh)
      throw new UnauthorizedException(
        'Tu sesión de GitHub venció: vuelve a entrar',
      );
    const tokens = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refresh,
    });
    this.users.upsert({ ...u, ...this.sealTokens(tokens) });
    return tokens.access_token!;
  }

  /** Repos que el usuario compartió con la app (todas sus instalaciones). */
  async listRepos(githubId: number): Promise<RepoView[]> {
    const token = await this.tokenFor(githubId);
    const inst = await this.json<{ installations: { id: number }[] }>(
      token,
      '/user/installations?per_page=100',
    );
    const lists = await Promise.all(
      inst.installations.map((i) =>
        this.json<{ repositories: RepoView[] }>(
          token,
          `/user/installations/${i.id}/repositories?per_page=100`,
        ).then((r) => r.repositories),
      ),
    );
    const seen = new Set<number>();
    return lists
      .flat()
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .map(pickRepo)
      .sort((a, b) => (b.pushed_at ?? '').localeCompare(a.pushed_at ?? ''));
  }

  /**
   * ¿El usuario puede desplegar este repo? Sí si lo ve con su token (compartido con la app)
   * o si es público. Devuelve si es privado: los privados se clonan con su token.
   */
  async checkRepoAccess(
    githubId: number,
    owner: string,
    repo: string,
  ): Promise<{ private: boolean }> {
    const token = await this.tokenFor(githubId);
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const mine = await this.gh(token, path);
    if (mine.ok)
      return { private: ((await mine.json()) as { private: boolean }).private };
    const pub = await fetch(`${GITHUB_API}${path}`, { headers: ghHeaders() });
    if (pub.ok) return { private: false };
    throw new ForbiddenException(
      `No tienes acceso a ${owner}/${repo}, o no lo compartiste con Mayday`,
    );
  }

  /**
   * Antes de crear un sandbox: con login, el repo tiene que ser público o compartido con la
   * app. Devuelve si es privado (se clona con el token del dueño). Los repos de nuestra org
   * (`kind: 'org'`, la app víctima) no se revisan: se clonan con el token de la org.
   */
  async repoAccessFor(
    user: AuthUser | null,
    repoUrl: string,
    kind: string,
  ): Promise<boolean> {
    if (!user || kind !== 'external') return false;
    const [owner, repo] = new URL(repoUrl).pathname
      .replace(/^\/+/, '')
      .split('/');
    if (!owner || !repo)
      throw new BadRequestException(
        'repo_url debe ser https://github.com/dueño/repo',
      );
    return (await this.checkRepoAccess(user.github_id, owner, repo)).private;
  }

  // ------------------------------------------------------------------ helpers

  private sealTokens(t: TokenResponse) {
    const now = Date.now();
    return {
      token: encryptToken(this.sessionSecret, t.access_token!),
      token_expires_at: t.expires_in
        ? new Date(now + t.expires_in * 1000).toISOString()
        : undefined,
      refresh_token: t.refresh_token
        ? encryptToken(this.sessionSecret, t.refresh_token)
        : undefined,
      refresh_expires_at: t.refresh_token_expires_in
        ? new Date(now + t.refresh_token_expires_in * 1000).toISOString()
        : undefined,
    };
  }

  private async tokenRequest(
    params: Record<string, string>,
  ): Promise<TokenResponse> {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        ...params,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!body.access_token)
      throw new UnauthorizedException(
        `GitHub rechazó el login: ${body.error_description ?? body.error ?? res.status}`,
      );
    return body;
  }

  private gh(token: string, path: string) {
    return fetch(`${GITHUB_API}${path}`, {
      headers: { ...ghHeaders(), Authorization: `Bearer ${token}` },
    });
  }

  private async json<T>(token: string, path: string): Promise<T> {
    const res = await this.gh(token, path);
    if (res.status === 401)
      throw new UnauthorizedException(
        'Tu sesión de GitHub venció: vuelve a entrar',
      );
    if (!res.ok) throw new Error(`GitHub respondió ${res.status} en ${path}`);
    return (await res.json()) as T;
  }
}

function ghHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function pickRepo(r: RepoView): RepoView {
  return {
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    html_url: r.html_url,
    description: r.description,
    language: r.language,
    stargazers_count: r.stargazers_count,
    pushed_at: r.pushed_at,
    fork: r.fork,
    archived: r.archived,
    size: r.size,
    private: r.private,
  };
}
