/**
 * Cliente HTTP que graba cada request/response. La telemetría ES el producto.
 *
 * Garantías de seguridad:
 *  - Scope guard: cada request y cada redirect se validan contra el origen
 *    autorizado (protocolo + host + puerto). Un redirect fuera de scope se
 *    aborta y NO se sigue.
 *  - Saneamiento de evidencia: tokens JWT, hashes bcrypt, emails y teléfonos se
 *    enmascaran en lo que se persiste, para no dejar datos reales en artefactos.
 *
 * Aleatoriedad (identidad por request, jitter) vía RNG seeded (rng.ts).
 * Usa fetch nativo (Node >= 18). Cero dependencias externas.
 */
import { randomIdentity, type EvasionProfile, type Identity } from './evasion.ts';
import { realClock, type Clock, type RNG } from './rng.ts';
import type { HttpExchange } from './types.ts';

const BODY_LIMIT = 4000; // caracteres de evidencia por respuesta
const MAX_REDIRECTS = 5;

export class ScopeError extends Error {
  constructor(url: string, scope: string) {
    super(`fuera de scope: ${url} no pertenece a ${scope}`);
    this.name = 'ScopeError';
  }
}

export interface RequestOptions {
  method?: string;
  path: string; // relativo a baseUrl, p. ej. "/api/notes?q=..."
  headers?: Record<string, string>;
  body?: unknown;
  /** Cuerpo literal, sin serializar (p. ej. JSON malformado a propósito). */
  rawBody?: string;
  token?: string;
  cookie?: string;
  /** No seguir redirects (para capturar el 302). */
  noRedirect?: boolean;
}

export interface RecordedResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  json: unknown;
  exchange: HttpExchange;
  /** URL final tras seguir redirects en scope. */
  finalUrl: string;
}

export interface ClientOpts {
  profile?: EvasionProfile;
  rng?: RNG;
  clock?: Clock;
}

export class RecordingClient {
  readonly exchanges: HttpExchange[] = [];
  private readonly baseUrl: string;
  /** Origen autorizado: `${protocol}//${host}` (incluye puerto). */
  readonly scope: string;
  private readonly identity: Identity;
  private readonly profile?: EvasionProfile;
  private readonly rng?: RNG;
  private readonly clock: Clock;

  constructor(baseUrl: string, identity: Identity, opts: ClientOpts = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.scope = new URL(this.baseUrl).origin;
    this.identity = identity;
    this.profile = opts.profile;
    this.rng = opts.rng;
    this.clock = opts.clock ?? realClock;
  }

  private inScope(url: string): boolean {
    try {
      return new URL(url).origin === this.scope;
    } catch {
      return false;
    }
  }

  private pickIdentity(): Identity {
    if (this.profile?.rotateIdentity === 'per-request' && this.rng) return randomIdentity(this.rng);
    return this.identity;
  }

  private async delay() {
    if (!this.profile || this.profile.maxDelayMs <= 0 || !this.rng) return;
    const d = Math.floor(this.profile.minDelayMs + this.rng() * (this.profile.maxDelayMs - this.profile.minDelayMs));
    if (d > 0) await new Promise((r) => setTimeout(r, d));
  }

  async request(opts: RequestOptions): Promise<RecordedResponse> {
    await this.delay();
    const method = opts.method ?? 'GET';
    let url = this.baseUrl + opts.path;
    if (!this.inScope(url)) throw new ScopeError(url, this.scope);

    const id = this.pickIdentity();
    const headers: Record<string, string> = {
      'user-agent': id.userAgent,
      // trust proxy = true en la víctima: la IP del atacante sale del primer XFF.
      'x-forwarded-for': id.ip,
      ...(opts.headers ?? {}),
    };
    if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
    if (opts.cookie) headers['cookie'] = opts.cookie;

    let bodyInit: string | undefined;
    if (opts.rawBody !== undefined) {
      bodyInit = opts.rawBody;
    } else if (opts.body !== undefined) {
      headers['content-type'] = headers['content-type'] ?? 'application/json';
      bodyInit = headers['content-type'].includes('json') ? JSON.stringify(opts.body) : String(opts.body);
    }

    const t0 = this.clock.now();
    let res = await fetch(url, { method, headers, body: bodyInit, redirect: 'manual' });
    let curMethod = method;

    // Seguimiento de redirects con scope guard (salvo noRedirect).
    let hops = 0;
    while (!opts.noRedirect && res.status >= 300 && res.status < 400 && res.headers.get('location') && hops < MAX_REDIRECTS) {
      const next = new URL(res.headers.get('location')!, url).toString();
      if (!this.inScope(next)) {
        // Redirect fuera de scope: se aborta, no se sigue. Se registra el 3xx.
        break;
      }
      url = next;
      // 301/302/303 → GET; 307/308 conservan método.
      if (res.status === 301 || res.status === 302 || res.status === 303) curMethod = 'GET';
      res = await fetch(url, { method: curMethod, headers, redirect: 'manual' });
      hops++;
    }

    const durationMs = this.clock.now() - t0;
    const text = await res.text();
    const ct = res.headers.get('content-type') ?? '';

    let json: unknown = undefined;
    if (ct.includes('application/json')) {
      try {
        json = JSON.parse(text);
      } catch {
        /* no era JSON válido */
      }
    }

    const resHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (resHeaders[k] = v));

    const exchange: HttpExchange = {
      at: this.clock.iso(),
      method,
      path: opts.path,
      url,
      reqHeaders: redactHeaders(headers),
      reqBody: opts.rawBody ?? redactBody(opts.body, headers['content-type']),
      status: res.status,
      resHeaders: sanitizeHeaders({ 'content-type': ct, ...pickHeaders(resHeaders) }),
      resBodyExcerpt: sanitizeText(text.slice(0, BODY_LIMIT)),
      durationMs,
    };
    this.exchanges.push(exchange);

    return { status: res.status, headers: resHeaders, text, json, exchange, finalUrl: url };
  }

  get(path: string, opts: Partial<RequestOptions> = {}) {
    return this.request({ ...opts, method: 'GET', path });
  }
  post(path: string, body?: unknown, opts: Partial<RequestOptions> = {}) {
    return this.request({ ...opts, method: 'POST', path, body });
  }
  patch(path: string, body?: unknown, opts: Partial<RequestOptions> = {}) {
    return this.request({ ...opts, method: 'PATCH', path, body });
  }
  del(path: string, opts: Partial<RequestOptions> = {}) {
    return this.request({ ...opts, method: 'DELETE', path });
  }
}

export function reqLine(method: string, path: string): string {
  return `${method} ${path}`;
}

// ───────────────────────── saneamiento de evidencia ─────────────────────────

const JWT_RE = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BCRYPT_RE = /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g;
const EMAIL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const PHONE_RE = /\+?\d[\d ()\-]{8,}\d/g;

/** Enmascara secretos y PII en texto que se va a persistir como evidencia. */
export function sanitizeText(text: string): string {
  return text
    .replace(JWT_RE, '<jwt>')
    .replace(BCRYPT_RE, '<bcrypt>')
    .replace(EMAIL_RE, (_m, a, dom) => `${a}***@${dom}`)
    .replace(PHONE_RE, '<phone>');
}

function sanitizeHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (k.toLowerCase() === 'set-cookie') {
      out[k] = v.replace(/((?:token|session|sid)=)[^;]+/gi, '$1<redacted>');
    } else {
      out[k] = sanitizeText(v);
    }
  }
  return out;
}

function pickHeaders(h: Record<string, string>): Record<string, string> {
  const keep = ['set-cookie', 'content-disposition', 'content-length'];
  const out: Record<string, string> = {};
  for (const k of keep) if (h[k]) out[k] = h[k];
  return out;
}

function redactHeaders(h: Record<string, string>): Record<string, string> {
  const out = { ...h };
  if (out['authorization']) out['authorization'] = 'Bearer <token>';
  if (out['cookie']) out['cookie'] = '<cookie>';
  return out;
}

const SENSITIVE_KEY = /password|secret|token|authorization|cookie/i;

/** Redacta campos sensibles en bodies JSON y form-urlencoded (string). */
export function redactBody(body: unknown, contentType?: string): unknown {
  if (body == null) return body;
  if (typeof body === 'string') {
    // form-urlencoded: k=v&k=v
    if ((contentType ?? '').includes('urlencoded') || /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(body)) {
      return body
        .split('&')
        .map((pair) => {
          const eq = pair.indexOf('=');
          const k = eq >= 0 ? pair.slice(0, eq) : pair;
          return SENSITIVE_KEY.test(decodeURIComponent(k)) ? `${k}=<redacted>` : pair;
        })
        .join('&');
    }
    return sanitizeText(body);
  }
  if (typeof body === 'object') {
    const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    for (const k of Object.keys(clone)) {
      if (SENSITIVE_KEY.test(k)) clone[k] = '<redacted>';
      else if (typeof clone[k] === 'string') clone[k] = sanitizeText(clone[k] as string);
    }
    return clone;
  }
  return body;
}

/** Decodifica el payload de un JWT sin verificar firma (solo para diagnóstico). */
export function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
