import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * ¿Se puede mostrar una URL dentro de un iframe? El navegador simulado lo
 * necesita para avisar cuando un sitio no se deja embeber (X-Frame-Options o
 * CSP frame-ancestors): desde el frontend no se pueden leer esos headers de
 * otro origen.
 *
 * Es un fetch a una URL que elige el usuario, así que está acotado contra SSRF:
 * solo http/https en puertos estándar, el host tiene que resolver a IPs
 * públicas (se revalida en cada redirect), no se lee el body y hay timeout.
 * Riesgo residual: DNS rebinding entre la validación y la conexión; como solo
 * devolvemos si el sitio es embebible (nunca headers ni contenido), el impacto
 * es mínimo.
 */

export type FrameCheck =
  | { embeddable: true }
  | {
      embeddable: false;
      reason: 'blocked' | 'unreachable' | 'invalid' | 'private';
      detail?: string;
    };

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  PRIVATE.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  PRIVATE.addSubnet(net, prefix, 'ipv6');

export function isPrivateIp(ip: string): boolean {
  const v4mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4mapped) return PRIVATE.check(v4mapped[1], 'ipv4');
  const family = isIP(ip);
  if (!family) return true;
  return PRIVATE.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Decide con los headers de la respuesta. `origin` es el del frontend que
 * embebe (para `frame-ancestors` con orígenes explícitos).
 */
export function embeddableFromHeaders(
  headers: Headers,
  origin: string | null,
): boolean {
  const xfo = headers.get('x-frame-options');
  // DENY, SAMEORIGIN y el obsoleto ALLOW-FROM: ninguno deja embeber desde otro origen.
  if (xfo && xfo.trim()) return false;
  const csp = headers.get('content-security-policy');
  const fa = csp
    ?.split(';')
    .map((d) => d.trim())
    .find((d) => /^frame-ancestors\b/i.test(d));
  if (!fa) return true;
  const sources = fa.split(/\s+/).slice(1);
  if (sources.includes('*')) return true;
  if (!origin) return false;
  const scheme = new URL(origin).protocol; // "https:"
  return sources.some((src) => {
    if (src === scheme) return true;
    if (src.startsWith("'")) return false; // 'none', 'self'
    if (src.includes('*')) {
      const re = new RegExp(
        `^${src.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*|\*/g, '[^/]+')}$`,
      );
      return re.test(origin);
    }
    return src.replace(/\/$/, '') === origin;
  });
}

async function assertPublic(url: URL): Promise<FrameCheck | null> {
  if (!['http:', 'https:'].includes(url.protocol))
    return { embeddable: false, reason: 'invalid' };
  if (url.port && !['80', '443'].includes(url.port))
    return { embeddable: false, reason: 'private' };
  if (url.username || url.password)
    return { embeddable: false, reason: 'invalid' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let ips: string[];
  try {
    ips = isIP(host)
      ? [host]
      : (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    return { embeddable: false, reason: 'unreachable', detail: 'dns' };
  }
  if (!ips.length || ips.some(isPrivateIp))
    return { embeddable: false, reason: 'private' };
  return null;
}

export interface FrameCheckOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  /** Para tests: saltarse la validación de IPs (el upstream de prueba es local). */
  allowPrivate?: boolean;
}

export async function checkFrame(
  raw: string,
  origin: string | null,
  opts: FrameCheckOptions = {},
): Promise<FrameCheck> {
  const { timeoutMs = 5000, maxRedirects = 4 } = opts;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { embeddable: false, reason: 'invalid' };
  }
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!opts.allowPrivate) {
      const bad = await assertPublic(url);
      if (bad) return bad;
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
          accept: 'text/html,*/*;q=0.8',
        },
      });
    } catch (e) {
      return {
        embeddable: false,
        reason: 'unreachable',
        detail: (e as Error).name,
      };
    }
    // Solo interesan los headers: el body no se lee.
    await res.body?.cancel().catch(() => undefined);
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      try {
        url = new URL(location, url);
      } catch {
        return { embeddable: false, reason: 'invalid' };
      }
      continue;
    }
    return embeddableFromHeaders(res.headers, origin)
      ? { embeddable: true }
      : { embeddable: false, reason: 'blocked' };
  }
  return { embeddable: false, reason: 'unreachable', detail: 'redirects' };
}
