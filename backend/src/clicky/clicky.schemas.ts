import { z } from 'zod';

/**
 * Content-Type del cuerpo de POST /clicky/lesson. No es application/json porque la
 * captura pesa más que el límite global de JSON (100 kB): main.ts lee este tipo como
 * raw con un límite propio, y el controlador lo valida con este schema.
 */
export const CLICKY_JSON = 'application/vnd.clicky+json';

/** Audio de push-to-talk: también raw, con su propio límite (main.ts). */
export const MAX_AUDIO_BYTES = 4_000_000;

const box = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().min(0),
  h: z.number().finite().min(0),
});

const SHAPES = ['circle', 'underline', 'point'] as const;

/** Un trazo del usuario: su forma, dónde quedó, qué cubre y lo que iba diciendo mientras. */
const stroke = z.object({
  shape: z.enum(SHAPES),
  box,
  elements: z.array(z.string().max(80)).max(6).default([]),
  said: z.string().max(300).default(''),
});

export const lessonSchema = z.object({
  question: z.string().trim().min(1).max(600),
  /**
   * Lo que hay en pantalla (kit/harvest.js): alias corto (e1, e2…), tipo, texto y caja en
   * pixeles del viewport. El mismo número va dibujado en la captura.
   */
  elements: z
    .array(
      z.object({
        id: z.string().max(80),
        kind: z.string().max(60),
        text: z.string().max(1500),
        box: z.array(z.number().finite()).length(4).optional(),
        attack: z.boolean().optional(),
        disabled: z.boolean().optional(),
      }),
    )
    .max(200)
    .default([]),
  viewport: z
    .object({
      w: z.number().finite().positive(),
      h: z.number().finite().positive(),
    })
    .nullable()
    .default(null),
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
   * Lo que el usuario marcó con el cursor mientras preguntaba (modo marcar + shift, como en
   * HeyClicky): uno o varios trazos, cada uno con lo que iba diciendo. Se aceptan los dos
   * formatos (un trazo suelto o `marks`) y quedan siempre como `{ marks }`.
   */
  annotation: z
    .object({
      shape: z.enum(SHAPES).optional(),
      box: box.optional(),
      elements: z.array(z.string().max(80)).max(6).default([]),
      marks: z.array(stroke).max(6).default([]),
    })
    .transform(({ shape, box: b, elements, marks }) => ({
      marks: marks.length
        ? marks
        : shape && b
          ? [{ shape, box: b, elements, said: '' }]
          : [],
    }))
    .nullable()
    .default(null),
  /**
   * Guía paso a paso en curso: la meta del usuario y los pasos que ya hizo. Cada vez que
   * completa uno, el kit vuelve a preguntar con una captura nueva por el siguiente.
   */
  walk: z
    .object({
      goal: z.string().trim().min(1).max(600),
      done: z.array(z.string().max(120)).max(15).default([]),
    })
    .nullable()
    .default(null),
  /** Lo que Hinty estaba diciendo cuando el usuario lo interrumpió para preguntar otra cosa. */
  interrupted: z.string().max(600).default(''),
  /** El usuario tiene el foco en un campo de clave: no hay captura y no se escribe ahí. */
  private: z.boolean().default(false),
});

export type LessonBody = z.infer<typeof lessonSchema>;
