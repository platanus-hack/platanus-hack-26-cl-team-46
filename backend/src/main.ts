import { Logger, StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { IncomingMessage } from 'node:http';
import { AppModule, ObserveInstrument } from './app.module.js';
import { CLICKY_JSON, MAX_AUDIO_BYTES } from './clicky/clicky.schemas.js';
import { rejectForeignOrigins } from './auth/origin-check.js';
import { createPreviewProxy } from './preview/preview-proxy.js';
import { SandboxStore } from './sandboxes/sandbox.store.js';

/**
 * Rutas que reciben parches (`git diff --binary` del agente, redeploy con parche,
 * `sim push`): necesitan más que los 100 kB del resto de la API.
 */
const PATCH_ROUTES =
  /^\/(agent\/sandboxes\/[^/?#]+\/changes|sandboxes\/[^/?#]+\/redeploy|sim\/[^/?#]+\/changes)\/?(?:[?#]|$)/i;
const PATCH_BODY_LIMIT = '10mb';
/** Igual que el `type` por defecto del parser JSON: solo application/json. */
const isJson = (req: IncomingMessage) =>
  (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() ===
  'application/json';
const isPatchRoute = (req: IncomingMessage) => PATCH_ROUTES.test(req.url ?? '');

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    instrument: ObserveInstrument,
  });
  // Proxy de previsualización (sbx-xxxx.<dominio de preview>): va antes que todo,
  // incluso de los body parsers, para reenviar el body tal cual a la app del sandbox.
  const previewTemplate = process.env.PREVIEW_URL_TEMPLATE;
  if (previewTemplate) {
    const store = app.get(SandboxStore, { strict: false });
    const logger = new Logger('PreviewProxy');
    app.use(
      createPreviewProxy({
        template: previewTemplate,
        resolve: (id) => {
          const sbx = store.get(id);
          return sbx && sbx.status !== 'deleted'
            ? (sbx.render?.url ?? null)
            : null;
        },
        log: (m) => logger.warn(m),
      }),
    );
  }
  // JSON normal con el límite de siempre (100 kB), salvo las rutas de parches (10 MB).
  // Clicky manda la captura de pantalla y el audio con sus propios tipos, que se leen
  // como raw con un límite mayor solo para eso.
  app.useBodyParser('json', {
    limit: PATCH_BODY_LIMIT,
    type: (req) => isJson(req) && isPatchRoute(req),
  });
  app.useBodyParser('json', {
    limit: '100kb',
    type: (req) => isJson(req) && !isPatchRoute(req),
  });
  app.useBodyParser('raw', {
    type: [CLICKY_JSON, 'audio/*'],
    limit: MAX_AUDIO_BYTES,
  });
  // En Render hay un balanceador delante: req.ip debe ser el del cliente (límite por IP de Clicky).
  if (process.env.RENDER) app.set('trust proxy', 1);
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());
  // credentials: el frontend manda la cookie de sesión (fetch con credentials: 'include').
  // maxAge: el navegador reusa el preflight 10 min en vez de repetirlo en cada request.
  app.enableCors({ origin: origins, credentials: true, maxAge: 600 });
  // Los subdominios del preview (código del usuario) son del mismo *site* que el frontend:
  // sus formularios mandarían la cookie de sesión. Se rechaza cualquier escritura que venga
  // de un origen que no sea el frontend (CSRF).
  app.use(rejectForeignOrigins(origins));
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
