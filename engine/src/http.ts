/**
 * Cliente HTTP que graba cada request/response. La telemetría ES el producto:
 * si no capturamos el intercambio, no hay diagnóstico ni lección.
 *
 * Usa fetch nativo (Node >= 18). Cero dependencias externas.
 */
import { jitter, randomIdentity, type EvasionProfile, type Identity } from './evasion.ts';
import type { HttpExchange } from './types.ts';

const BODY_LIMIT = 4000; // caracteres de evidencia por respuesta

export interface RequestOptions {
  method?: string;
  path: string; // relativo a baseUrl, p. ej. "/api/notes?q=..."
  headers?: Record<string, string>;
  body?: unknown;
  /** Token Bearer, si aplica. */
  token?: string;
  /** Cookie cruda, si aplica. */
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
}

export class RecordingClient {
  readonly exchanges: HttpExchange[] = [];
  private readonly baseUrl: string;
  private readonly identity: Identity;
  private readonly profile?: EvasionProfile;

  constructor(baseUrl: string, identity: Identity, profile?: EvasionProfile) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.identity = identity;
    this.profile = profile;
  }

  /** Identidad de este request: rota por request en modo stealth. */
  private pickIdentity(): Identity {
    if (this.profile?.rotateIdentity === 'per-request') return randomIdentity();
    return this.identity;
  }

  async request(opts: RequestOptions): Promise<RecordedResponse> {
    if (this.profile) await jitter(this.profile);
    const method = opts.method ?? 'GET';
    const url = this.baseUrl + opts.path;
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
    if (opts.body !== undefined) {
      headers['content-type'] = headers['content-type'] ?? 'application/json';
      bodyInit = headers['content-type'].includes('json')
        ? JSON.stringify(opts.body)
        : String(opts.body);
    }

    const t0 = Date.now();
    const res = await fetch(url, {
      method,
      headers,
      body: bodyInit,
      redirect: opts.noRedirect ? 'manual' : 'follow',
    });
    const durationMs = Date.now() - t0;
    const text = await res.text();

    let json: unknown = undefined;
    const ct = res.headers.get('content-type') ?? '';
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
      at: new Date().toISOString(),
      method,
      path: opts.path,
      url,
      reqHeaders: redact(headers),
      reqBody: redactBody(opts.body),
      status: res.status,
      resHeaders: { 'content-type': ct, ...pickHeaders(resHeaders) },
      resBodyExcerpt: text.slice(0, BODY_LIMIT),
      durationMs,
    };
    this.exchanges.push(exchange);

    return { status: res.status, headers: resHeaders, text, json, exchange };
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

/** Resume un request para los pasos del ataque: "GET /api/notes/3". */
export function reqLine(method: string, path: string): string {
  return `${method} ${path}`;
}

function pickHeaders(h: Record<string, string>): Record<string, string> {
  const keep = ['set-cookie', 'content-disposition', 'content-length'];
  const out: Record<string, string> = {};
  for (const k of keep) if (h[k]) out[k] = h[k];
  return out;
}

/** No guardamos el valor completo de tokens/cookies en la evidencia. */
function redact(h: Record<string, string>): Record<string, string> {
  const out = { ...h };
  if (out['authorization']) out['authorization'] = 'Bearer <token>';
  if (out['cookie']) out['cookie'] = '<cookie>';
  return out;
}

function redactBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const k of Object.keys(clone)) {
    if (/password|secret|token/i.test(k)) clone[k] = '<redacted>';
  }
  return clone;
}

/** Decodifica el payload de un JWT sin verificar firma (solo para diagnóstico). */
export function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    const json = Buffer.from(part, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}
