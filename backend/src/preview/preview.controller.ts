import { Controller, Get, Headers, Query } from '@nestjs/common';
import { z } from 'zod';
import { checkFrame, type FrameCheck } from './frame-check.js';

const frameCheckQuery = z.object({ url: z.string().min(1).max(2048) });

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 500;

/** Utilidades del navegador simulado. */
@Controller('preview')
export class PreviewController {
  private readonly cache = new Map<string, { at: number; value: FrameCheck }>();

  /** ¿Se puede mostrar `url` en un iframe del frontend? Ver frame-check.ts. */
  @Get('frame-check')
  async frameCheck(
    @Query({ schema: frameCheckQuery }) q: z.infer<typeof frameCheckQuery>,
    @Headers('origin') origin?: string,
  ): Promise<FrameCheck> {
    const key = `${origin ?? ''} ${q.url}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const value = await checkFrame(q.url, origin ?? null);
    if (this.cache.size >= MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}
