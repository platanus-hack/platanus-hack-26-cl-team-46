import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Proxy de previsualización: sirve la app desplegada de un sandbox bajo un
 * subdominio nuestro (`sbx-xxxx.preview.mayday.rip`) para que el frontend la
 * embeba en un iframe del mismo *site* que mayday.rip. Así las cookies
 * `SameSite=Lax` de la app (sesiones, JWT en cookie) funcionan dentro del
 * navegador simulado, cosa que no pasa con el iframe directo a onrender.com.
 *
 * Solo atiende sandboxes que existen en nuestro store: nunca es un proxy abierto.
 *
 * Además inyecta un script chico (`/__mayday/bridge.js`) en el HTML, que le
 * avisa al navegador simulado la URL y el título de cada página, y acepta
 * atrás/adelante/recargar desde afuera.
 */

export const BRIDGE_PATH = '/__mayday/bridge.js';

/** `https://{sandbox}.preview.mayday.rip` → función que extrae el sandbox de un Host. */
export function previewHostMatcher(
  template: string,
): (host: string | undefined) => string | null {
  const url = new URL(template.replace('{sandbox}', 'SANDBOX'));
  const [prefix, suffix] = url.host
    .toLowerCase()
    .split('SANDBOX'.toLowerCase());
  return (host) => {
    if (!host) return null;
    const h = host.toLowerCase();
    if (!h.startsWith(prefix) || !h.endsWith(suffix)) return null;
    const id = h.slice(prefix.length, h.length - suffix.length);
    return /^sbx-[a-z0-9]{4,32}$/.test(id) ? id : null;
  };
}

export function previewUrl(template: string, sandboxId: string): string {
  return template.replace('{sandbox}', sandboxId).replace(/\/$/, '');
}

/** Quita `Domain=` (sería el de onrender) para que la cookie quede en el host del preview. */
export function rewriteSetCookie(cookie: string): string {
  return cookie
    .split(';')
    .filter((part) => !/^\s*domain\s*=/i.test(part))
    .join(';');
}

/** Saca `frame-ancestors` del CSP (el resto se respeta: es parte de la postura de seguridad de la app). */
export function stripFrameAncestors(csp: string): string {
  return csp
    .split(';')
    .filter((d) => !/^\s*frame-ancestors\b/i.test(d))
    .join(';')
    .trim();
}

/** Inserta el script del puente y cambia el origen de la app por el del preview. */
export function rewriteHtml(
  html: string,
  appOrigin: string,
  previewOrigin: string,
): string {
  const tag = `<script src="${BRIDGE_PATH}"></script>`;
  const body = html.split(appOrigin).join(previewOrigin);
  const head = body.match(/<head[^>]*>/i);
  if (head) return body.replace(head[0], `${head[0]}${tag}`);
  return `${tag}${body}`;
}

/** Script del puente. Corre dentro de la app embebida. */
export const BRIDGE_JS = `(() => {
  if (window.parent === window) return;
  const send = () => window.parent.postMessage({ type: 'mayday:nav', url: location.href, title: document.title }, '*');
  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    history[fn] = function (...args) { const r = orig.apply(this, args); send(); return r; };
  }
  addEventListener('popstate', send);
  addEventListener('hashchange', send);
  addEventListener('DOMContentLoaded', send);
  new MutationObserver(send).observe(document.querySelector('title') || document.documentElement, { subtree: true, childList: true, characterData: true });
  addEventListener('message', (e) => {
    if (e.source !== window.parent || !e.data || typeof e.data.type !== 'string') return;
    if (e.data.type === 'mayday:back') history.back();
    if (e.data.type === 'mayday:forward') history.forward();
    if (e.data.type === 'mayday:reload') location.reload();
  });
  send();
})();
`;

/** Headers que no se reenvían (hop-by-hop o que fetch calcula solo). */
const SKIP_REQUEST = new Set([
  'host',
  'connection',
  'keep-alive',
  'content-length',
  'transfer-encoding',
  'upgrade',
  'accept-encoding',
]);
const SKIP_RESPONSE = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding',
  'content-length',
  'x-frame-options',
  'set-cookie',
  'location',
  'content-security-policy',
]);

/**
 * Cuánto se espera a que la app responda los headers. Holgado: un servicio free
 * de Render dormido tarda cerca de un minuto en despertar. El body no tiene tope
 * (descargas, SSE de la app).
 */
const UPSTREAM_HEADERS_TIMEOUT_MS = 90_000;
/** HTML más grande que esto no se reescribe: se sirve tal cual, en streaming. */
export const MAX_REWRITE_HTML_BYTES = 5 * 1024 * 1024;

const UNAVAILABLE_HTML =
  '<body style="font:15px system-ui;padding:40px;color:#444">No se pudo conectar con la app. Puede estar redesplegándose: recarga en unos segundos.</body>';

export interface PreviewProxyOptions {
  /** `https://{sandbox}.preview.mayday.rip` */
  template: string;
  /** URL pública de la app del sandbox, o null si no existe o no está desplegada. */
  resolve: (sandboxId: string) => string | null;
  log?: (msg: string) => void;
  /** Espera máxima por los headers de la app (default UPSTREAM_HEADERS_TIMEOUT_MS). */
  headersTimeoutMs?: number;
}

export function createPreviewProxy(opts: PreviewProxyOptions) {
  const match = previewHostMatcher(opts.template);

  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';
    const sandboxId = match(
      req.headers['x-forwarded-host']?.toString() ?? req.headers.host,
    );
    if (!sandboxId) return next();

    if (url.split('?')[0] === BRIDGE_PATH) {
      res.setHeader('content-type', 'text/javascript; charset=utf-8');
      res.setHeader('cache-control', 'no-cache');
      return res.end(BRIDGE_JS);
    }

    const target = opts.resolve(sandboxId);
    if (!target) {
      res.statusCode = 404;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.end(
        '<body style="font:15px system-ui;padding:40px;color:#444">Este sandbox no existe o todavía no está desplegado.</body>',
      );
    }

    const appOrigin = new URL(target).origin;
    const previewOrigin = new URL(previewUrl(opts.template, sandboxId)).origin;

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || SKIP_REQUEST.has(k)) continue;
      headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }
    // El navegador manda Origin/Referer del preview: la app espera los suyos (CSRF, CORS).
    for (const k of ['origin', 'referer']) {
      const v = headers.get(k);
      if (v) headers.set(k, v.split(previewOrigin).join(appOrigin));
    }
    headers.set('accept-encoding', 'identity');
    headers.set('x-forwarded-host', new URL(previewOrigin).host);

    const hasBody = !['GET', 'HEAD'].includes(method);
    // Se aborta si la app no responde a tiempo o si el navegador se va.
    const abort = new AbortController();
    const headersTimer = setTimeout(
      () => abort.abort(new Error('la app no respondió a tiempo')),
      opts.headersTimeoutMs ?? UPSTREAM_HEADERS_TIMEOUT_MS,
    );
    res.on('close', () => abort.abort());
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(appOrigin + url, {
        method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
        // @ts-expect-error: duplex es obligatorio en Node para mandar un stream como body.
        duplex: hasBody ? 'half' : undefined,
        redirect: 'manual',
        signal: abort.signal,
      });
    } catch (e) {
      if (res.writableEnded || res.destroyed) return; // el navegador se fue
      opts.log?.(`preview ${sandboxId}: ${(e as Error).message}`);
      res.statusCode = 502;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      return res.end(UNAVAILABLE_HTML);
    } finally {
      clearTimeout(headersTimer);
    }

    res.statusCode = upstream.status;
    upstream.headers.forEach((v, k) => {
      if (!SKIP_RESPONSE.has(k)) res.setHeader(k, v);
    });
    const csp = upstream.headers.get('content-security-policy');
    if (csp) res.setHeader('content-security-policy', stripFrameAncestors(csp));
    const location = upstream.headers.get('location');
    if (location)
      res.setHeader('location', location.split(appOrigin).join(previewOrigin));
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length)
      res.setHeader('set-cookie', cookies.map(rewriteSetCookie));

    if (!upstream.body || method === 'HEAD') return res.end();
    // Si la app corta la conexión a mitad de camino, se responde 502 (o se cierra
    // la respuesta) en vez de dejar un error sin manejar que bota el proceso.
    try {
      if ((upstream.headers.get('content-type') ?? '').includes('text/html')) {
        await sendHtml(upstream.body, res, (html) =>
          rewriteHtml(html, appOrigin, previewOrigin),
        );
        return;
      }
      await pipeline(Readable.fromWeb(upstream.body as never), res);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      // El navegador se fue (navegó a otra página): no es un error de la app.
      if (code !== 'ERR_STREAM_PREMATURE_CLOSE' && !abort.signal.aborted)
        opts.log?.(`preview ${sandboxId}: ${(e as Error).message}`);
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.removeHeader('content-security-policy');
        res.end(UNAVAILABLE_HTML);
      } else {
        res.destroy();
      }
    }
  };
}

/**
 * Lee el HTML hasta MAX_REWRITE_HTML_BYTES y lo manda reescrito. Si es más
 * grande, lo manda tal cual en streaming (sin el puente) para no cargar en
 * memoria una respuesta arbitraria de la app.
 */
async function sendHtml(
  body: ReadableStream<Uint8Array>,
  res: ServerResponse,
  rewrite: (html: string) => string,
): Promise<void> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      res.end(rewrite(Buffer.concat(chunks).toString('utf8')));
      return;
    }
    chunks.push(value);
    size += value.byteLength;
    if (size > MAX_REWRITE_HTML_BYTES) break;
  }
  async function* rest() {
    yield* chunks;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  }
  await pipeline(Readable.from(rest()), res);
}
