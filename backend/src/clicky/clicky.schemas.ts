import { z } from 'zod';

/**
 * Content-Type del cuerpo de POST /clicky/lesson. No es application/json porque la
 * captura pesa más que el límite global de JSON (100 kB): main.ts lee este tipo como
 * raw con un límite propio, y el controlador lo valida con este schema.
 */
export const CLICKY_JSON = 'application/vnd.clicky+json';

/** Audio de push-to-talk: también raw, con su propio límite (main.ts). */
export const MAX_AUDIO_BYTES = 4_000_000;

/**
 * Texto que se recorta a `n` en vez de rechazarse: un campo largo (una respuesta de 10 beats,
 * un título de página) no debe dejar a Hinty mudo con un 400. `hard` es el tope contra abuso.
 * El kit recorta a los mismos largos (kit/index.js › LIMITS).
 */
const clipped = (n: number, hard = n * 4) =>
  z
    .string()
    .max(hard)
    .transform((s) => s.slice(0, n));

/** Lista que se recorta a `n` (las últimas, con `last`) en vez de rechazarse. */
const upTo = <T extends z.ZodType>(item: T, n: number, last = false) =>
  z
    .array(item)
    .max(n * 4)
    .transform((a) => (last ? a.slice(-n) : a.slice(0, n)));

/** Límites del cuerpo de POST /clicky/lesson (el kit usa los mismos). */
export const LIMITS = {
  question: 600,
  historyTurns: 6,
  answer: 2000,
  said: 300,
} as const;

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
  elements: upTo(z.string().max(80), 6).default([]),
  said: clipped(LIMITS.said).default(''),
});

export const lessonSchema = z.object({
  question: z
    .string()
    .max(LIMITS.question * 4)
    .trim()
    .min(1)
    .transform((s) => s.slice(0, LIMITS.question)),
  /**
   * Lo que hay en pantalla (kit/harvest.js): alias corto (e1, e2…), tipo, texto y caja en
   * pixeles del viewport. El mismo número va dibujado en la captura.
   */
  elements: upTo(
    z.object({
      id: z.string().max(80),
      kind: clipped(60),
      text: clipped(1500),
      box: z.array(z.number().finite()).length(4).optional(),
      attack: z.boolean().optional(),
      disabled: z.boolean().optional(),
      /** Apretarlo saca de la simulación (otra página, otra pestaña): Hinty no lo aprieta. */
      exit: z.boolean().optional(),
    }),
    200,
  ).default([]),
  viewport: z
    .object({
      w: z.number().finite().positive(),
      h: z.number().finite().positive(),
    })
    .nullable()
    .default(null),
  /** Lo que ya conversaron (las últimas 6): va al modelo como dato, no como sus turnos. */
  history: upTo(
    z.object({ q: clipped(LIMITS.question), a: clipped(LIMITS.answer) }),
    LIMITS.historyTurns,
    true,
  ).default([]),
  /** Captura de la pestaña (JPEG/PNG/WebP en data URL) o null si no la compartió. */
  screenshot: z
    .string()
    .max(3_500_000)
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/)
    .nullable()
    .default(null),
  page: z
    .object({ title: clipped(120), path: clipped(200) })
    .default({ title: '', path: '' }),
  /** Se acepta por compatibilidad, pero no se usa: el contexto lo arma el backend. */
  context: clipped(1500).default(''),
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
      elements: upTo(z.string().max(80), 6).default([]),
      marks: upTo(stroke, 6).default([]),
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
      goal: z
        .string()
        .max(LIMITS.question * 4)
        .trim()
        .min(1)
        .transform((s) => s.slice(0, LIMITS.question)),
      done: upTo(clipped(120), 15, true).default([]),
    })
    .nullable()
    .default(null),
  /** Lo que Hinty estaba diciendo cuando el usuario lo interrumpió para preguntar otra cosa. */
  interrupted: clipped(600).default(''),
  /** El usuario tiene el foco en un campo de clave: no hay captura y no se escribe ahí. */
  private: z.boolean().default(false),
});

export type LessonBody = z.infer<typeof lessonSchema>;
