import {
  BadRequestException,
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  Req,
  UnsupportedMediaTypeException,
  UseGuards,
} from '@nestjs/common';
import {
  ClickyAccessGuard,
  type ClickyRequest,
} from './clicky-access.guard.js';
import { CLICKY_JSON, lessonSchema } from './clicky.schemas.js';
import { ClickyService } from './clicky.service.js';

/**
 * Copiloto en pantalla del simulador. Todas las rutas exigen `x-sim-id` de una
 * simulación en curso o terminada (ClickyAccessGuard).
 *
 * - POST /clicky/lesson (Content-Type application/vnd.clicky+json): pregunta, elementos
 *   visibles y captura → NDJSON, una línea por beat (lo que dice, lo que marca, en qué
 *   palabra y su audio) apenas está listo, y al final `{"type":"done"}`.
 * - POST /clicky/stt-session: dirección del WebSocket de dictado en vivo (token de un uso).
 * - POST /clicky/transcribe (Content-Type audio/*): respaldo, el audio entero → texto.
 */
@Controller('clicky')
@UseGuards(ClickyAccessGuard)
export class ClickyController {
  constructor(private readonly clicky: ClickyService) {}

  @Post('lesson')
  @HttpCode(200)
  @Header('Content-Type', 'application/x-ndjson; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('X-Accel-Buffering', 'no')
  async *lesson(@Req() req: ClickyRequest, @Body() raw: unknown) {
    const parsed = lessonSchema.safeParse(parseBody(raw));
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      );
    yield* this.clicky.lesson(
      req.clickySimId,
      parsed.data,
      req.clickySimStatus,
    );
  }

  @Post('stt-session')
  @HttpCode(200)
  async sttSession(@Req() req: ClickyRequest) {
    return { url: await this.clicky.liveTranscription(req.clickySimId) };
  }

  @Post('transcribe')
  @HttpCode(200)
  async transcribe(@Req() req: ClickyRequest, @Body() audio: unknown) {
    const mime = String(req.headers['content-type'] ?? '');
    if (!mime.startsWith('audio/') || !Buffer.isBuffer(audio))
      throw new UnsupportedMediaTypeException('Se esperaba audio');
    if (audio.length < 1000)
      throw new BadRequestException('Audio demasiado corto');
    return { text: await this.clicky.transcribe(req.clickySimId, audio, mime) };
  }
}

/** El cuerpo llega como Buffer (CLICKY_JSON, ver main.ts) o ya parseado si vino como JSON chico. */
function parseBody(raw: unknown): unknown {
  if (!Buffer.isBuffer(raw)) return raw;
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new BadRequestException(
      `Cuerpo inválido: se esperaba ${CLICKY_JSON}`,
    );
  }
}
