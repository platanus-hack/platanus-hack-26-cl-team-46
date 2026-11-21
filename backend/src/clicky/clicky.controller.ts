import {
  BadRequestException,
  Body,
  Controller,
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
 * simulación en curso (ClickyAccessGuard).
 *
 * - POST /clicky/lesson (Content-Type application/vnd.clicky+json): pregunta, elementos
 *   visibles y captura → beats con lo que dice, lo que marca y su audio.
 * - POST /clicky/transcribe (Content-Type audio/*): audio del push-to-talk → texto.
 */
@Controller('clicky')
@UseGuards(ClickyAccessGuard)
export class ClickyController {
  constructor(private readonly clicky: ClickyService) {}

  @Post('lesson')
  @HttpCode(200)
  async lesson(@Req() req: ClickyRequest, @Body() raw: unknown) {
    const parsed = lessonSchema.safeParse(parseBody(raw));
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      );
    return { beats: await this.clicky.lesson(req.clickySimId, parsed.data) };
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
    throw new BadRequestException(`Cuerpo inválido: se esperaba ${CLICKY_JSON}`);
  }
}
