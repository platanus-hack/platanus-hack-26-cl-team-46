import type { IncomingMessage, ServerResponse } from 'node:http';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
/**
 * Únicas rutas que aceptan escrituras con un Origin ajeno: /agent y /sim van
 * server-to-server (VMs, motor) con sus propios tokens, nunca con la cookie.
 * Sin distinguir mayúsculas, igual que el router de Express.
 */
const SERVER_ROUTES = /^\/(agent|sim)(\/|$)/i;

/** Ruta sin query ni fragmento. No se normaliza más: solo puede achicar la excepción. */
function pathOf(url: string | undefined): string {
  return (url ?? '/').split(/[?#]/)[0];
}

const normalizeOrigin = (o: string) =>
  o.trim().replace(/\/+$/, '').toLowerCase();

/**
 * Middleware anti-CSRF: una escritura (POST/PUT/DELETE…) con un header Origin que no es el
 * del frontend responde 403, en todas las rutas salvo las de agentes. Sin Origin (curl,
 * scripts) pasa: los navegadores siempre lo mandan en escrituras cross-origin.
 */
export function rejectForeignOrigins(allowed: string[]) {
  const ok = new Set(allowed.map(normalizeOrigin));
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const origin = req.headers.origin;
    if (
      origin &&
      !SAFE.has((req.method ?? 'GET').toUpperCase()) &&
      !SERVER_ROUTES.test(pathOf(req.url)) &&
      !ok.has(normalizeOrigin(origin))
    ) {
      res.statusCode = 403;
      res.setHeader('content-type', 'application/json');
      return res.end(
        JSON.stringify({ statusCode: 403, message: 'Origen no permitido' }),
      );
    }
    next();
  };
}
