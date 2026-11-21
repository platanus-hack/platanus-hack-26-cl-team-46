import { Logger, StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, ObserveInstrument } from './app.module.js';
import { CLICKY_JSON, MAX_AUDIO_BYTES } from './clicky/clicky.schemas.js';
import { createPreviewProxy } from './preview/preview-proxy.js';
import { SandboxStore } from './sandboxes/sandbox.store.js';

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
  // JSON normal con el límite de siempre (100 kB). Clicky manda la captura de pantalla
  // y el audio con sus propios tipos, que se leen como raw con un límite mayor solo para eso.
  app.useBodyParser('json', { limit: '100kb' });
  app.useBodyParser('raw', {
    type: [CLICKY_JSON, 'audio/*'],
    limit: MAX_AUDIO_BYTES,
  });
  // En Render hay un balanceador delante: req.ip debe ser el del cliente (límite por IP de Clicky).
  if (process.env.RENDER) app.set('trust proxy', 1);
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(','),
  });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
