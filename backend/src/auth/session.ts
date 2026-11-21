import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Sesión del usuario: cookie firmada (HMAC-SHA256) y sin estado.
 *
 * La cookie es host-only en el backend (api.mayday.rip), sin `Domain`. Así nunca viaja a
 * los subdominios del proxy de preview (sbx-xxxx.preview.mayday.rip), que reenvían las
 * cookies a la app del sandbox (código del usuario), y esos subdominios no pueden pisarla.
 * mayday.rip y api.mayday.rip son el mismo *site*, así que con SameSite=Lax el fetch del
 * frontend (credentials: 'include') la manda igual.
 */

export interface SessionData {
  /** id numérico de GitHub (estable aunque cambie el login). */
  uid: number;
  login: string;
  /** Expira (epoch ms). */
  exp: number;
}

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const STATE_TTL_MS = 10 * 60 * 1000;

const b64url = (buf: Buffer) => buf.toString('base64url');

function hmac(secret: string, data: string) {
  return createHmac('sha256', secret).update(data).digest();
}

/** `payload.firma` con payload en base64url. */
export function signValue(secret: string, value: unknown): string {
  const payload = b64url(Buffer.from(JSON.stringify(value)));
  return `${payload}.${b64url(hmac(secret, payload))}`;
}

export function verifyValue<T>(
  secret: string,
  token: string | undefined,
): T | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = hmac(secret, payload);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function signSession(secret: string, data: SessionData): string {
  return signValue(secret, data);
}

export function verifySession(
  secret: string,
  token: string | undefined,
  now = Date.now(),
): SessionData | null {
  const s = verifyValue<SessionData>(secret, token);
  if (!s || typeof s.uid !== 'number' || typeof s.login !== 'string')
    return null;
  return s.exp > now ? s : null;
}

/** Lee una cookie del header `Cookie` (sin dependencias). */
export function readCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name)
      return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export interface CookieOptions {
  maxAgeMs: number;
  secure: boolean;
  path?: string;
}

/** Header Set-Cookie host-only (sin Domain), httpOnly y SameSite=Lax. */
export function serializeCookie(name: string, value: string, o: CookieOptions) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${o.path ?? '/'}`,
    `Max-Age=${Math.floor(o.maxAgeMs / 1000)}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (o.secure) parts.push('Secure');
  return parts.join('; ');
}

/** `__Host-` impide que otro subdominio la sobreescriba; exige Secure, así que solo en https. */
export function sessionCookieName(secure: boolean) {
  return secure ? '__Host-mayday_session' : 'mayday_session';
}
export function stateCookieName(secure: boolean) {
  return secure ? '__Host-mayday_oauth' : 'mayday_oauth';
}

// ---- Cifrado de los tokens de GitHub guardados (AES-256-GCM) -------------------------------

function key(secret: string) {
  return createHash('sha256').update(`mayday-tokens:${secret}`).digest();
}

export function encryptToken(secret: string, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(secret), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b64url).join('.');
}

export function decryptToken(secret: string, sealed: string): string | null {
  try {
    const [iv, tag, enc] = sealed
      .split('.')
      .map((p) => Buffer.from(p, 'base64url'));
    const d = createDecipheriv('aes-256-gcm', key(secret), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
