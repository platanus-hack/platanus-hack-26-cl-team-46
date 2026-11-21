import { z } from 'zod';

/**
 * Content-Type del cuerpo de POST /clicky/lesson. No es application/json porque la
 * captura pesa más que el límite global de JSON (100 kB): main.ts lee este tipo como
 * raw con un límite propio, y el controlador lo valida con este schema.
 */
export const CLICKY_JSON = 'application/vnd.clicky+json';

/** Audio de push-to-talk: también raw, con su propio límite (main.ts). */
export const MAX_AUDIO_BYTES = 4_000_000;

export const lessonSchema = z.object({
  question: z.string().trim().min(1).max(600),
  elements: z
    .array(
      z.object({
        id: z.string().max(80),
        kind: z.string().max(60),
        text: z.string().max(1500),
      }),
    )
    .max(150)
    .default([]),
  history: z
    .array(z.object({ q: z.string().max(600), a: z.string().max(2000) }))
    .max(6)
    .default([]),
  /** Captura de la pestaña (JPEG/PNG/WebP en data URL) o null si no la compartió. */
  screenshot: z
    .string()
    .max(3_500_000)
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/)
    .nullable()
    .default(null),
  page: z
    .object({ title: z.string().max(120), path: z.string().max(200) })
    .default({ title: '', path: '' }),
  context: z.string().max(1500).default(''),
  /** false: el usuario apagó la voz, no se gasta ElevenLabs. */
  voice: z.boolean().default(true),
  /**
   * Lo que el usuario marcó con el cursor mientras preguntaba (Control + Option, como en
   * HeyClicky): la forma, dónde quedó y los elementos que cubre. Su trazo se ve en la captura.
   */
  annotation: z
    .object({
      shape: z.enum(['circle', 'underline', 'point']),
      box: z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        w: z.number().finite().min(0),
        h: z.number().finite().min(0),
      }),
      elements: z.array(z.string().max(80)).max(6).default([]),
    })
    .nullable()
    .default(null),
});

export type LessonBody = z.infer<typeof lessonSchema>;
