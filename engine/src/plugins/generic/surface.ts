/**
 * Superficie de ataque de una app desconocida y la sesión del atacante.
 *
 * Junta las rutas del repo (discovery) y del spec OpenAPI publicado por la app,
 * resuelve en vivo el prefijo real (setGlobalPrefix, app.use('/api'…)) y
 * distingue respuestas reales del fallback de una SPA (200 HTML para todo).
 * La sesión se obtiene con la credencial conocida o una cuenta desechable.
 */
import { decodeJwt, type RecordedResponse, type RecordingClient } from '../../core/http.ts';
import { hex } from '../../core/rng.ts';
import type { AttackContext } from '../../core/types.ts';
import type { FileRef, RepoModel, RouteDef } from '../../discovery/types.ts';

export interface Endpoint {
  method: string;
  /** Ruta tal como está en el código, con el prefijo resuelto: /api/orders/:id */
  template: string;
  /** Ruta concreta para pedirla (parámetros → 1). */
  path: string;
  params: string[];
  auth?: string;
  ref?: FileRef;
  /** ¿Respondió algo real (no 404 ni el fallback de la SPA)? */
  live?: boolean;
}

export interface Surface {
  endpoints: Endpoint[];
  prefixes: string[];
  /** Status y forma de una ruta inexistente: para no confundir el fallback con un hallazgo. */
  fallback: { status: number; html: boolean };
}

export interface Session {
  token?: string;
  cookie?: string;
  userId?: string | number;
  email: string;
  password: string;
  role?: string;
  loginPath?: string;
  /** Ruta de registro, si la cuenta la creó el atacante. */
  registeredAt?: string;
  /** Campos con los que el login funcionó: email o username. */
  idField: 'email' | 'username';
}

const SKIP_PATH = /\*|\/(health|healthz|metrics|favicon|static|assets|_next)\b/;
export const LOGIN_RE = /(log-?in|sign-?in|authenticate|auth\/token|sessions?|\/token)$/i;
export const REGISTER_RE = /(register|sign-?up|signup|users|accounts)$/i;
const ME_RE = /\/(me|whoami|profile|current-?user|users\/me|auth\/me|account)$/i;
const ID_KEYS = /^(id|_id|userId|user_id|uid|sub)$/;

export function isHtml(res: RecordedResponse): boolean {
  return /text\/html/i.test(res.headers['content-type'] ?? '') || /^\s*<(!doctype|html)/i.test(res.text);
}

export function isJson(res: RecordedResponse): boolean {
  return res.json !== undefined || /application\/(.+\+)?json/i.test(res.headers['content-type'] ?? '');
}

const MISSING_RE = /Cannot (GET|POST|PUT|PATCH|DELETE|HEAD) \/|"detail"\s*:\s*"Not Found"|route not found|no route matches|^\s*Not Found\s*$/i;

/**
 * ¿La ruta existe? Un 404 con cuerpo propio ("User not found") sí es una ruta
 * real; el 404 del framework ("Cannot POST /x"), el 405 y el fallback HTML de la
 * SPA no.
 */
export function isReal(res: RecordedResponse, fb: Surface['fallback']): boolean {
  if (res.status === 405) return false;
  if (fb.html && res.status === fb.status && isHtml(res)) return false;
  if (res.status === 404) return !(isHtml(res) || !res.text.trim() || MISSING_RE.test(res.text));
  return true;
}

function concrete(p: string): string {
  return p.replace(/:(\w+)\??/g, '1').replace(/\{(\w+)\}/g, '1').replace(/<(?:\w+:)?(\w+)>/g, '1');
}

function normalize(p: string): string {
  return p.replace(/\{(\w+)\}/g, ':$1').replace(/<(?:\w+:)?(\w+)>/g, ':$1').replace(/\/+$/, '') || '/';
}

function joinPath(prefix: string, p: string): string {
  if (!prefix || p.startsWith(`${prefix}/`) || p === prefix) return p;
  return `${prefix}${p === '/' ? '' : p}`;
}

/** Busca recursivamente un valor por nombre de clave (token, id…). */
export function findKey(obj: unknown, re: RegExp, depth = 0): unknown {
  if (!obj || typeof obj !== 'object' || depth > 4) return undefined;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (re.test(k) && (typeof v === 'string' || typeof v === 'number')) return v;
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const hit = findKey(v, re, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

const TOKEN_KEY = /^(access_?token|accessToken|token|jwt|id_?token|auth_?token|authToken)$/i;
const SESSION_COOKIE = /^(token|jwt|access_?token|session|sid|connect\.sid|auth|.*session.*)$/i;

function sessionFrom(res: RecordedResponse): { token?: string; cookie?: string } | null {
  if (res.status < 200 || res.status >= 300) return null;
  const token = findKey(res.json, TOKEN_KEY);
  if (typeof token === 'string' && token.length >= 16) return { token };
  const setCookie = res.headers['set-cookie'];
  if (setCookie) {
    const pairs = setCookie
      .split(/,(?=\s*[^;,=\s]+=)/)
      .map((c) => c.split(';')[0].trim())
      .filter((c) => SESSION_COOKIE.test(c.split('=')[0]) && c.split('=')[1]);
    if (pairs.length) return { cookie: pairs.join('; ') };
  }
  return null;
}

export interface GenericInput {
  repo?: RepoModel;
  /** Secretos candidatos leídos del repo (JWT_SECRET de .env.example, etc.). */
  repoSecrets: string[];
}

/**
 * Estado compartido por los ataques de una corrida: la superficie y la sesión se
 * resuelven una vez (con el cliente del primer ataque que las pide).
 */
export class GenericState {
  readonly refs = new Map<string, FileRef>();
  private surfaceP?: Promise<Surface>;
  private sessionP?: Promise<Session | null>;
  private mePath?: string | null;

  readonly input: GenericInput;

  constructor(input: GenericInput) {
    this.input = input;
  }

  surface(ctx: AttackContext): Promise<Surface> {
    this.surfaceP ??= this.resolveSurface(ctx);
    return this.surfaceP;
  }

  session(ctx: AttackContext): Promise<Session | null> {
    this.sessionP ??= this.resolveSession(ctx);
    return this.sessionP;
  }

  auth(s: Session | null): { token?: string; cookie?: string } {
    return s ? { token: s.token, cookie: s.cookie } : {};
  }

  // ───────────────────────────── superficie ─────────────────────────────

  private async resolveSurface(ctx: AttackContext): Promise<Surface> {
    const http = ctx.http;
    const miss = await http.get(`/__mayday-${hex(ctx.rng, 6)}`, { noRedirect: true });
    const fallback = { status: miss.status, html: isHtml(miss) };

    const routes: RouteDef[] = [...(this.input.repo?.routes ?? [])];
    routes.push(...(await this.liveOpenapi(http)));
    const prefixes = [...new Set(['', ...(this.input.repo?.prefixes ?? []), '/api'])];

    // Dedup por método + ruta normalizada.
    const seen = new Set<string>();
    const raw: Endpoint[] = [];
    for (const r of routes) {
      const method = r.method === 'ALL' || r.method === 'USE' ? 'GET' : r.method;
      const template = normalize(r.path);
      if (SKIP_PATH.test(template) || !template.startsWith('/')) continue;
      const key = `${method} ${template}`;
      if (seen.has(key)) continue;
      seen.add(key);
      raw.push({ method, template, path: concrete(template), params: r.params ?? [], auth: r.auth, ref: r.ref });
    }

    // Resolver el prefijo por archivo de origen (routers montados con app.use('/api/x')):
    // se prueba primero el prefijo que se parece al nombre del archivo y gana la
    // respuesta más "de API" (JSON o 401/403 > otra respuesta real > HTML).
    const byFile = new Map<string, Endpoint[]>();
    for (const e of raw) byFile.set(e.ref?.file ?? '(live)', [...(byFile.get(e.ref?.file ?? '(live)') ?? []), e]);
    let budget = 90;
    const endpoints: Endpoint[] = [];
    const score = (res: RecordedResponse) =>
      !isReal(res, fallback) ? 0 : isJson(res) || res.status === 401 || res.status === 403 ? 3 : isHtml(res) ? 1 : 2;
    for (const [file, eps] of byFile) {
      const probe =
        eps.find((e) => e.method === 'GET' && !e.params.length && e.template !== '/') ??
        eps.find((e) => e.method === 'GET') ??
        eps[0];
      const stem = file.split('/').pop()!.replace(/\.(controller|routes?|router|views?|api)?\.?[jt]sx?$|\.py$/, '').toLowerCase();
      const ordered = [...prefixes].sort((a, b) => Number(b.toLowerCase().endsWith(`/${stem}`)) - Number(a.toLowerCase().endsWith(`/${stem}`)));
      let chosen: string | undefined;
      let best = 0;
      for (const pre of ordered) {
        if (budget-- <= 0) break;
        const res = probe.method === 'GET'
          ? await http.get(joinPath(pre, probe.path), { noRedirect: true })
          : await http.request({ method: probe.method, path: joinPath(pre, probe.path), body: {}, noRedirect: true });
        const sc = score(res);
        if (sc > best) {
          best = sc;
          chosen = pre;
          probe.live = true;
        }
        if (sc === 3) break;
      }
      for (const e of eps) {
        const pre = chosen ?? '';
        endpoints.push({ ...e, template: joinPath(pre, e.template), path: joinPath(pre, e.path), live: e === probe ? probe.live : undefined });
      }
    }
    ctx.log(`  · superficie: ${endpoints.length} ruta(s) (${endpoints.filter((e) => e.live).length} verificada(s) en vivo), fallback ${fallback.status}${fallback.html ? ' html' : ''}`);
    return { endpoints, prefixes, fallback };
  }

  /** Spec OpenAPI publicado por la app (Nest /api-json, FastAPI /openapi.json…). */
  private async liveOpenapi(http: RecordingClient): Promise<RouteDef[]> {
    const paths = ['/openapi.json', '/api-json', '/api/docs-json', '/swagger.json', '/v3/api-docs', '/api/openapi.json', '/docs/openapi.json'];
    for (const p of paths) {
      const res = await http.get(p, { noRedirect: true });
      const spec = res.json as { paths?: Record<string, Record<string, unknown>>; servers?: Array<{ url?: string }> } | undefined;
      if (res.status !== 200 || !spec?.paths) continue;
      const base = (() => {
        try {
          return new URL(spec.servers?.[0]?.url ?? '', 'http://x').pathname.replace(/\/$/, '');
        } catch {
          return '';
        }
      })();
      const out: RouteDef[] = [];
      for (const [route, ops] of Object.entries(spec.paths)) {
        for (const [method, op] of Object.entries(ops ?? {})) {
          if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
          const sec = (op as { security?: unknown[] })?.security;
          out.push({
            method: method.toUpperCase(),
            path: `${base}${route}`,
            ref: { file: `${p} (publicado por la app)`, commit: 'live' },
            auth: Array.isArray(sec) ? (sec.length ? 'user' : 'none') : undefined,
            params: [...route.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
            source: 'openapi',
          });
        }
      }
      return out;
    }
    return [];
  }

  // ─────────────────────────────── sesión ───────────────────────────────

  async loginPaths(ctx: AttackContext): Promise<string[]> {
    const s = await this.surface(ctx);
    const fromCode = s.endpoints.filter((e) => e.method === 'POST' && LOGIN_RE.test(e.template)).map((e) => e.path);
    const guesses = ['/auth/login', '/login', '/auth/signin', '/signin', '/users/login', '/sessions', '/auth/token', '/token']
      .flatMap((p) => s.prefixes.map((pre) => joinPath(pre, p)));
    return [...new Set([...fromCode, ...guesses])];
  }

  async registerPaths(ctx: AttackContext): Promise<string[]> {
    const s = await this.surface(ctx);
    const fromCode = s.endpoints
      .filter((e) => e.method === 'POST' && REGISTER_RE.test(e.template) && !LOGIN_RE.test(e.template))
      .map((e) => e.path);
    const guesses = ['/auth/register', '/register', '/auth/signup', '/signup', '/users']
      .flatMap((p) => s.prefixes.map((pre) => joinPath(pre, p)));
    return [...new Set([...fromCode, ...guesses])];
  }

  /** Intenta el login en las rutas candidatas con email o username. */
  async login(ctx: AttackContext, email: string, password: string, opts: { paths?: string[] } = {}): Promise<Session | null> {
    const s = await this.surface(ctx);
    const paths = opts.paths ?? (await this.loginPaths(ctx));
    let tried = 0;
    for (const p of paths) {
      for (const idField of ['email', 'username'] as const) {
        if (tried++ > 24) return null;
        const res = await ctx.http.post(p, { [idField]: email, password }, { noRedirect: true });
        if (!isReal(res, s.fallback)) break; // la ruta no existe: siguiente
        const got = sessionFrom(res);
        if (got) {
          const claims = got.token ? decodeJwt(got.token) : null;
          const userId = (findKey(res.json, ID_KEYS) ?? (claims ? findKey(claims, ID_KEYS) : undefined)) as string | number | undefined;
          const role = findKey(res.json, /^role$/i) ?? (claims ? findKey(claims, /^role$/i) : undefined);
          return { ...got, userId, email, password, role: typeof role === 'string' ? role : undefined, loginPath: p, idField };
        }
        // Credencial rechazada o campo equivocado: probar con username antes de seguir.
      }
    }
    return null;
  }

  /** Registra una cuenta desechable (mutante). extra = campos adicionales del body. */
  async register(ctx: AttackContext, extra: Record<string, unknown> = {}): Promise<Session | null> {
    const s = await this.surface(ctx);
    const tag = hex(ctx.rng, 6);
    const email = `rt-${tag}@redteam.local`;
    const password = `Rt-${hex(ctx.rng, 4)}-${hex(ctx.rng, 4)}!`;
    const body = { email, username: `rt_${tag}`, name: `redteam ${tag}`, password, password_confirmation: password, confirmPassword: password, ...extra };
    for (const p of (await this.registerPaths(ctx)).slice(0, 8)) {
      const res = await ctx.http.post(p, body, { noRedirect: true });
      if (!isReal(res, s.fallback) || res.status >= 400) continue;
      ctx.tracker.add(`cuenta desechable ${email} (registrada en ${p})`);
      const direct = sessionFrom(res);
      const logged = direct
        ? { ...direct, email, password, idField: 'email' as const, userId: findKey(res.json, ID_KEYS) as string | number | undefined }
        : (await this.login(ctx, email, password)) ?? (await this.login(ctx, `rt_${tag}`, password));
      if (logged) return { ...logged, registeredAt: p };
    }
    return null;
  }

  private async resolveSession(ctx: AttackContext): Promise<Session | null> {
    const creds = [
      ...(ctx.target.weak_login ? [ctx.target.weak_login] : []),
      ...ctx.target.seed_users.filter((u) => u.password && u.role !== 'admin').map((u) => ({ email: u.email, password: u.password! })),
    ];
    for (const c of creds.slice(0, 2)) {
      const s = await this.login(ctx, c.email, c.password);
      if (s) return s;
    }
    return this.register(ctx);
  }

  /** Identidad de una sesión: GET a /me, /profile… (la ruta se descubre una vez). */
  async me(ctx: AttackContext, s: Session): Promise<{ path: string; body: Record<string, unknown> } | null> {
    if (this.mePath === null) return null;
    const surf = await this.surface(ctx);
    const fromCode = surf.endpoints.filter((e) => e.method === 'GET' && ME_RE.test(e.template)).map((e) => e.path);
    const guesses = ['/me', '/users/me', '/auth/me', '/profile', '/user', '/auth/profile', '/account']
      .flatMap((p) => surf.prefixes.map((pre) => joinPath(pre, p)));
    const candidates = this.mePath ? [this.mePath] : [...new Set([...fromCode, ...guesses])].slice(0, 16);
    for (const p of candidates) {
      const res = await ctx.http.get(p, { ...this.auth(s), noRedirect: true });
      if (res.status === 200 && res.json && typeof res.json === 'object') {
        const body = res.json as Record<string, unknown>;
        if (findKey(body, ID_KEYS) !== undefined || findKey(body, /^email$/i) !== undefined) {
          this.mePath = p;
          if (s.userId === undefined) s.userId = findKey(body, ID_KEYS) as string | number | undefined;
          return { path: p, body };
        }
      }
    }
    if (!this.mePath) this.mePath = null;
    return null;
  }
}
