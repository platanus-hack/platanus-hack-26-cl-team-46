import type { IncomingMessage, ServerResponse } from 'node:http';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Rutas que usa el navegador con la cookie de sesión. /agent y /sim van server-to-server con sus tokens. */
const BROWSER_ROUTES = /^\/(auth|sandboxes|simulations|clicky)(\/|$|\?)/;

/**
 * Middleware anti-CSRF: en las rutas del navegador, una escritura (POST/PUT/DELETE…) con un
 * header Origin que no es el del frontend responde 403. Sin Origin (curl, scripts) pasa:
 * los navegadores siempre lo mandan en escrituras cross-origin.
 */
export function rejectForeignOrigins(allowed: string[]) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const origin = req.headers.origin;
    if (
      origin &&
      !SAFE.has(req.method ?? 'GET') &&
      BROWSER_ROUTES.test(req.url ?? '') &&
      !allowed.includes(origin)
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
