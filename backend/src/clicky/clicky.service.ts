import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { SimulationsService } from '../simulations/simulations.service.js';
import { BrainError, streamBeats } from './brain.js';
import type { LessonBody } from './clicky.schemas.js';
import {
  liveSttUrl,
  realtimeSttUrl,
  speechToText,
  textToSpeech,
  type Speech,
} from './elevenlabs.js';
import { SYSTEM_PROMPT } from './prompt.js';
import { cleanBeat, newBudget, type Beat } from './protocol.js';

export type SpokenBeat = Beat & { audio?: Speech };

/** Lo que va por el stream NDJSON de POST /clicky/lesson, una línea por evento. */
export type LessonEvent =
  | ({ type: 'beat'; index: number } & SpokenBeat)
  | { type: 'error'; message: string }
  | { type: 'done' };

/** Si la voz de un beat tarda más que esto, el beat sale sin audio (voz del navegador). */
const TTS_TIMEOUT_MS = 8_000;
/** Duración máxima de una sesión de dictado en vivo. */
const STT_MAX_SECONDS = 90;

/**
 * Clicky: arma la explicación (OpenAI, con la captura), le pone voz (ElevenLabs) y
 * transcribe lo que dice el usuario. Todo en streaming: el primer beat suena mientras el
 * modelo escribe el resto. Las keys nunca salen del backend y el gasto queda acotado
 * por simulación.
 */
@Injectable()
export class ClickyService {
  private readonly logger = new Logger(ClickyService.name);
  /** Uso por simulación (en memoria: se reinicia con el backend, y está bien así). */
  private readonly usage = new Map<
    string,
    { questions: number; ttsChars: number; sttSessions: number }
  >();

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly sims: SimulationsService,
  ) {}

  private cfg<K extends keyof Env>(k: K): Env[K] {
    return this.config.get(k, { infer: true });
  }

  private use(simId: string) {
    let u = this.usage.get(simId);
    if (!u)
      this.usage.set(
        simId,
        (u = { questions: 0, ttsChars: 0, sttSessions: 0 }),
      );
    return u;
  }

  /**
   * Beats en orden, cada uno con su voz, apenas están listos. Los errores antes del
   * primer beat se lanzan (el cliente recibe un HTTP de error); después van en el stream.
   */
  async *lesson(
    simId: string,
    input: LessonBody,
    simStatus = 'running',
  ): AsyncGenerator<LessonEvent> {
    const u = this.use(simId);
    if (u.questions >= this.cfg('CLICKY_MAX_QUESTIONS_PER_SIM'))
      throw new HttpException(
        'Clicky llegó al máximo de preguntas de esta simulación',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const key = this.cfg('OPENAI_API_KEY');
    if (!this.cfg('CLICKY_MOCK') && !key)
      throw new ServiceUnavailableException(
        'Falta OPENAI_API_KEY en el backend',
      );
    u.questions++;

    const t0 = Date.now();
    const abort = new AbortController();
    const ids = new Set(input.elements.map((e) => e.id));
    const budget = newBudget();
    const source = this.cfg('CLICKY_MOCK')
      ? mockBeats(input)
      : streamBeats({
          key: key!,
          model: this.cfg('CLICKY_BRAIN_MODEL'),
          effort: this.cfg('CLICKY_BRAIN_EFFORT'),
          messages: buildMessages(input, simStatus),
          signal: abort.signal,
        });

    // El modelo escribe y, en paralelo, cada beat que llega pide su voz.
    const ready: Promise<SpokenBeat>[] = [];
    let finished = false;
    let failure: unknown = null;
    let wake: () => void = () => {};
    const pump = (async () => {
      let previous: string | undefined;
      try {
        for await (const raw of source) {
          const beat = cleanBeat(raw, ids, budget);
          if (!beat) continue;
          ready.push(
            input.voice
              ? this.speak(simId, beat, previous)
              : Promise.resolve(beat),
          );
          previous = beat.say;
          wake();
        }
      } catch (err) {
        failure = err;
      } finally {
        finished = true;
        wake();
      }
    })();

    let sent = 0;
    let voiced = 0;
    let marks = 0;
    let guided = false;
    try {
      for (;;) {
        if (sent < ready.length) {
          const beat = await ready[sent];
          if (sent === 0)
            this.logger.log(`[${simId}] primer beat en ${Date.now() - t0} ms`);
          if (beat.audio) voiced++;
          marks += beat.marks.length;
          if (beat.marks.some((m) => m.type === 'step')) guided = true;
          yield { type: 'beat', index: sent++, ...beat };
          continue;
        }
        if (finished) break;
        await new Promise<void>((r) => (wake = r));
      }
      if (failure) {
        const message = this.describe(failure);
        if (!sent) throw new HttpException(message, HttpStatus.BAD_GATEWAY);
        yield { type: 'error', message };
      }
      if (!sent && !failure)
        yield {
          type: 'beat',
          index: 0,
          say: 'No supe qué responder a eso; prueba preguntándolo de otra forma.',
          marks: [],
        };
      yield { type: 'done' };
      this.logger.log(
        `[${simId}] lesson ${Date.now() - t0} ms · ${sent} beats · captura: ${input.screenshot ? 'sí' : 'no'} · voz: ${voiced ? `elevenlabs ${voiced}/${sent}` : 'navegador'}`,
      );
    } finally {
      abort.abort(); // si el usuario se fue o preguntó otra cosa, no seguir pagando el modelo
      await pump;
      if (sent) this.record(simId, input, { marks, guided, beats: sent });
    }
  }

  /** Deja la pregunta en el timeline para el reporte (solo con el incidente en curso). */
  private record(
    simId: string,
    input: LessonBody,
    out: { marks: number; guided: boolean; beats: number },
  ) {
    try {
      const stepDone = Boolean(input.walk?.done.length);
      this.sims?.recordHinty(simId, {
        question: stepDone ? input.walk!.goal : input.question,
        stepDone,
        walkGoal: input.walk?.goal,
        ...out,
      });
    } catch (err) {
      this.logger.warn(
        `[${simId}] no se pudo registrar la pregunta a Hinty: ${(err as Error).message}`,
      );
    }
  }

  private describe(err: unknown): string {
    if (err instanceof BrainError) {
      this.logger.error(`OpenAI ${err.status}: ${err.message}`);
      return 'El modelo no pudo responder, intenta de nuevo';
    }
    if ((err as Error)?.name === 'AbortError') return 'Respuesta cancelada';
    this.logger.error(`Clicky: ${(err as Error)?.message}`);
    return 'Se cortó la respuesta, intenta de nuevo';
  }

  /** URL del WebSocket de dictado en vivo (con un token de un solo uso). */
  async liveTranscription(simId: string): Promise<string> {
    const model = this.cfg('CLICKY_STT_LIVE_MODEL');
    if (this.cfg('CLICKY_MOCK')) return liveSttUrl(model, 'mock');
    const key = this.cfg('ELEVENLABS_API_KEY');
    if (!key)
      throw new ServiceUnavailableException(
        'Falta ELEVENLABS_API_KEY en el backend',
      );
    const u = this.use(simId);
    // Se piden por adelantado (uno listo para la próxima pregunta), por eso el doble.
    if (u.sttSessions >= 2 * this.cfg('CLICKY_MAX_QUESTIONS_PER_SIM'))
      throw new HttpException(
        'Clicky llegó al máximo de dictados de esta simulación',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    u.sttSessions++;
    return realtimeSttUrl({ key, model, maxSeconds: STT_MAX_SECONDS });
  }

  async transcribe(
    simId: string,
    audio: Buffer,
    mime: string,
  ): Promise<string> {
    if (this.cfg('CLICKY_MOCK')) return '¿Qué está pasando en esta pantalla?';
    const key = this.cfg('ELEVENLABS_API_KEY');
    if (!key)
      throw new ServiceUnavailableException(
        'Falta ELEVENLABS_API_KEY en el backend',
      );
    const t0 = Date.now();
    const text = await speechToText({
      key,
      model: this.cfg('CLICKY_STT_MODEL'),
      audio,
      mime,
    });
    this.logger.log(
      `[${simId}] transcribe ${audio.length} bytes en ${Date.now() - t0} ms`,
    );
    return text;
  }

  /**
   * Voz de un beat con ElevenLabs. Si no hay key, se pasa el tope de la simulación o
   * falla, el beat va sin audio y el navegador usa su voz.
   */
  private async speak(
    simId: string,
    beat: Beat,
    previousText?: string,
  ): Promise<SpokenBeat> {
    const key = this.cfg('ELEVENLABS_API_KEY');
    if (!key || this.cfg('CLICKY_MOCK')) return beat;
    const u = this.use(simId);
    if (
      u.ttsChars + beat.say.length >
      this.cfg('CLICKY_MAX_TTS_CHARS_PER_SIM')
    ) {
      this.logger.warn(`[${simId}] tope de voz alcanzado: voz del navegador`);
      return beat;
    }
    u.ttsChars += beat.say.length;
    try {
      const audio = await textToSpeech({
        key,
        voiceId: this.cfg('CLICKY_VOICE_ID'),
        model: this.cfg('CLICKY_TTS_MODEL'),
        format: this.cfg('CLICKY_TTS_FORMAT'),
        text: beat.say,
        previousText,
        timeoutMs: TTS_TIMEOUT_MS,
      });
      return { ...beat, audio };
    } catch (err) {
      this.logger.warn(`[${simId}] TTS: ${(err as Error).message}`);
      return beat;
    }
  }
}

const GESTURE = {
  circle: 'encerró',
  underline: 'subrayó',
  point: 'señaló',
} as const;

/** Lo que el usuario marcó con el cursor, dicho para el modelo (su trazo también va en la captura). */
export function describeAnnotation({
  annotation,
  elements,
  screenshot,
}: LessonBody): string {
  const marks = annotation?.marks ?? [];
  if (!marks.length) return '';
  const byId = new Map(elements.map((e) => [e.id, e]));
  const lines = marks.map((m, i) => {
    const marked = m.elements
      .map((id) => byId.get(id))
      .filter((e) => !!e)
      .map((e) => `${e.id} (${e.kind}): ${e.text.slice(0, 120)}`);
    const { x, y, w, h } = m.box;
    return [
      `${marks.length > 1 ? `${i + 1}. ` : ''}${GESTURE[m.shape]} la zona x=${Math.round(x)} y=${Math.round(y)} de ${Math.round(w)}×${Math.round(h)} px`,
      m.said.trim() && ` mientras decía "${m.said.trim()}"`,
      marked.length
        ? `. Cubre:\n   - ${marked.join('\n   - ')}`
        : '. No cubre ningún elemento de la lista: guíate por la captura.',
    ]
      .filter(Boolean)
      .join('');
  });
  return [
    `El usuario marcó la pantalla mientras preguntaba` +
      (screenshot ? ' (su trazo blanco se ve en la captura)' : '') +
      ':',
    ...lines,
    `Empieza por eso: tu primer beat lo marca y lo nombra${marks.length > 1 ? ', y sigue el orden de sus trazos' : ''}.`,
  ].join('\n');
}

/**
 * La simulación es un ejercicio: mientras corre, Clicky explica lo que se ve pero no
 * entrega la contención (descubrirla es la lección, como con el agente de código).
 */
export function phaseNote(simStatus: string): string {
  return simStatus === 'finished'
    ? 'Fase: la simulación terminó. Puedes explicar todo: qué pasó, qué faltó hacer y cuál era el arreglo correcto.'
    : 'Fase: la simulación está en curso y es un ejercicio de entrenamiento. Explica lo que muestra la pantalla y qué significa cada señal, pero no le digas qué acción tomar para contener el ataque ni nombres una vulnerabilidad que no aparezca en pantalla. Guíalo con una pregunta (por ejemplo, "¿esa sesión sigue sirviendo después del cambio?"). Si te pide la respuesta directamente, dale una pista, no la solución. Puedes guiarlo paso a paso para moverse por la pantalla (abrir un panel, leer un log), pero nunca pongas un step, click ni type sobre la acción que contiene el ataque ni escribas por él el pedido que la resuelve.';
}

/** Un elemento de la lista, con su caja: "- e7 (botón) [120 340 160×32] Rotar clave". */
function elementLine(e: LessonBody['elements'][number]): string {
  const box = e.box ? ` [${e.box[0]} ${e.box[1]} ${e.box[2]}×${e.box[3]}]` : '';
  const flags = [e.attack && '[atacante]', e.disabled && '[deshabilitado]']
    .filter(Boolean)
    .join(' ');
  return `- ${e.id} (${e.kind})${box}${flags ? ' ' + flags : ''}: ${e.text}`;
}

/** La guía paso a paso en curso: la meta, lo que ya hizo y qué se espera ahora. */
export function describeWalk({ walk }: LessonBody): string {
  if (!walk) return '';
  const done = walk.done.length
    ? walk.done.map((d, i) => `${i + 1}. ${d}`).join('\n')
    : '(ninguno todavía)';
  return [
    `Guía en curso. La meta del usuario: "${walk.goal}".`,
    `Pasos que ya hizo (la captura es de después del último):\n${done}`,
    walk.done.length >= 15
      ? 'Ya van 15 pasos: cierra la guía en 1 beat, diciendo dónde quedó y qué le falta.'
      : 'Si la meta ya se ve cumplida, dilo en 1 beat con un check sobre la prueba y sin step. Si no, da SOLO el siguiente paso: 1 beat corto que termina con su step. Nunca repitas un paso que ya hizo.',
  ].join('\n');
}

export function buildMessages(
  input: LessonBody,
  simStatus = 'running',
): unknown[] {
  const screen = input.elements.map(elementLine).join('\n');
  const text = [
    input.context && `Contexto de la app: ${input.context}`,
    phaseNote(simStatus),
    `Página: ${input.page.title} (${input.page.path})` +
      (input.viewport
        ? ` · pantalla de ${Math.round(input.viewport.w)}×${Math.round(input.viewport.h)} px`
        : ''),
    input.private &&
      'El usuario tiene el foco en un campo de contraseña: no hay captura. No escribas nada ahí ni le pidas la clave.',
    `Elementos en pantalla (id, tipo, caja [x y ancho×alto], texto):\n${screen || '(ninguno)'}`,
    describeAnnotation(input),
    input.interrupted &&
      `Te interrumpió mientras decías: "${input.interrupted}". Responde lo nuevo sin repetir eso.`,
    describeWalk(input),
    `Pregunta: ${input.walk ? input.walk.goal : input.question}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...input.history.flatMap((h) => [
      { role: 'user', content: h.q },
      { role: 'assistant', content: h.a },
    ]),
    {
      role: 'user',
      content: input.screenshot
        ? [
            { type: 'text', text },
            {
              type: 'image_url',
              image_url: { url: input.screenshot, detail: 'high' },
            },
          ]
        : text,
    },
  ];
}

/** Respuesta de ensayo (CLICKY_MOCK=true): usa lo que hay en pantalla, sin IA, con pausas como el modelo. */
async function* mockBeats(input: LessonBody) {
  for (const beat of mockPlan(input)) {
    await new Promise((r) => setTimeout(r, 250));
    yield beat;
  }
}

const SAFE = (e: { kind: string; text: string; disabled?: boolean }) =>
  e.kind === 'botón' &&
  !e.disabled &&
  !/termin|elimin|borr|reinic|rot|envi|desplieg|deploy|deten|apag/i.test(
    e.text,
  );

export function mockPlan({
  question,
  elements,
  page,
  screenshot,
  annotation,
  walk,
}: LessonBody): unknown[] {
  const title = elements.find((e) => e.kind.includes('título')) ?? elements[0];
  const buttons = elements.filter(SAFE);
  const button = buttons[0] ?? elements.find((e) => e.kind === 'botón');
  const field = elements.find(
    (e) => e.kind === 'campo' || e.kind === 'campo de texto',
  );

  // Guía en curso: el siguiente botón que no hizo, o "listo" al tercer paso.
  if (walk) {
    const next = buttons.find((b) => !walk.done.includes(b.text.slice(0, 40)));
    if (walk.done.length >= 2 || !next)
      return [
        {
          say: 'Listo, llegaste: esto es lo que buscabas.',
          marks: title
            ? [{ type: 'check', target: title.id, at: 'llegaste' }]
            : [],
        },
      ];
    return [
      {
        say: `Bien. Ahora aprieta este botón, ${next.text.slice(0, 30)}.`,
        marks: [
          {
            type: 'step',
            target: next.id,
            label: next.text.slice(0, 40),
            at: 'este botón',
          },
        ],
      },
    ];
  }
  if (
    /gu[ií]a|ll[eé]vame|c[oó]mo (llego|abro|hago|veo)|paso a paso/i.test(
      question,
    )
  )
    return [
      {
        say: 'Te llevo paso a paso, empezando por aquí.',
        marks: title
          ? [
              {
                type: 'point',
                target: title.id,
                label: 'partimos',
                at: 'por aquí',
              },
            ]
          : [],
      },
      {
        say: button
          ? `Primero aprieta este botón, ${button.text.slice(0, 30)}.`
          : 'No veo botones en esta parte de la pantalla.',
        marks: button
          ? [
              {
                type: 'step',
                target: button.id,
                label: button.text.slice(0, 40),
                at: 'este botón',
              },
            ]
          : [],
      },
    ];
  if (/hazlo|haz clic|escr[ií]belo|por m[ií]/i.test(question))
    return [
      {
        say: 'Va, lo hago yo: primero escribo en este campo.',
        marks: field
          ? [
              {
                type: 'type',
                target: field.id,
                value: 'borrador de Hinty',
                at: 'este campo',
              },
            ]
          : [],
      },
      {
        say: button
          ? `Y ahora aprieto este botón, ${button.text.slice(0, 30)}.`
          : 'No veo un botón para apretar.',
        marks: button
          ? [
              {
                type: 'click',
                target: button.id,
                label: 'lo aprieto',
                at: 'este botón',
              },
            ]
          : [],
      },
    ];

  const marks = annotation?.marks ?? [];
  // el primer trazo, en el orden en que los hizo
  const marked =
    marks[0] && elements.find((e) => e.id === marks[0].elements[0]);
  const other = elements.find(
    (e) => e !== marked && e !== title && e.kind !== 'botón',
  );
  const word = other?.text.split(/\s+/).find((w) => w.length >= 4);
  return [
    ...(marked
      ? [
          {
            say: `Esto que marcaste es ${marked.kind}: ${marked.text.slice(0, 40)}.`,
            marks: [
              {
                type: 'ring',
                target: marked.id,
                tone: marked.attack ? 'attack' : undefined,
                label: 'lo tuyo',
                at: 'esto que marcaste',
              },
            ],
          },
        ]
      : []),
    {
      say: `Estás en ${page.title || 'esta página'}; mira primero este título de aquí arriba.`,
      marks: title
        ? [
            { type: 'spotlight', target: title.id },
            {
              type: 'point',
              target: title.id,
              label: 'aquí',
              at: 'este título',
            },
          ]
        : [],
    },
    {
      say: button
        ? `Y este botón, ${button.text.slice(0, 40)}, es la siguiente acción.`
        : 'No veo botones en esta parte de la pantalla.',
      marks: button
        ? [
            {
              type: 'target',
              target: button.id,
              label: 'siguiente paso',
              at: 'este botón',
            },
          ]
        : [],
    },
    {
      say: 'Esto de aquí está bien, esta palabra preocupa y esto no lo sabemos.',
      marks: [
        title && { type: 'check', target: title.id, at: 'está bien' },
        other && {
          type: 'scribble',
          target: other.id,
          text: word,
          at: 'esta palabra',
        },
        button && { type: 'question', target: button.id, at: 'no lo sabemos' },
      ].filter(Boolean),
    },
    {
      say: 'Te dibujo cómo funciona un token de sesión.',
      marks: [
        {
          type: 'board',
          title: 'Cómo funciona un token',
          cols: 3,
          rows: 2,
          at: 'te dibujo',
        },
      ],
    },
    {
      say: 'Primero inicias sesión con tu clave.',
      marks: [
        {
          type: 'node',
          id: 'login',
          text: 'Inicias sesión',
          col: 0,
          row: 0,
          at: 'inicias sesión',
        },
      ],
    },
    {
      say: 'El servidor te entrega un token firmado con JWT_SECRET.',
      marks: [
        {
          type: 'node',
          id: 'token',
          text: 'Token firmado',
          col: 1,
          row: 0,
          at: 'un token',
        },
        {
          type: 'edge',
          from: 'login',
          to: 'token',
          label: 'entrega',
          at: 'te entrega',
        },
      ],
    },
    {
      say: 'Con ese token entras a la app sin volver a escribir la clave.',
      marks: [
        {
          type: 'node',
          id: 'app',
          text: 'Accedes a la app',
          col: 2,
          row: 0,
          at: 'entras a la app',
        },
        {
          type: 'edge',
          from: 'token',
          to: 'app',
          label: 'permite',
          at: 'con ese token',
        },
      ],
    },
    {
      say: 'Pero si alguien roba el secreto, puede firmar tokens falsos.',
      marks: [
        {
          type: 'node',
          id: 'robo',
          text: 'Tokens falsos',
          col: 1,
          row: 1,
          hot: true,
          at: 'tokens falsos',
        },
        {
          type: 'edge',
          from: 'token',
          to: 'robo',
          label: 'si filtran',
          at: 'roba el secreto',
        },
      ],
    },
    {
      say: screenshot
        ? 'Además estoy viendo tu captura de pantalla en tiempo real.'
        : 'No compartiste la pestaña, así que solo leo el texto.',
      marks: [
        {
          type: 'card',
          eyebrow: 'Modo ensayo',
          title: `Veo ${elements.length} elementos`,
          items: [
            screenshot ? 'Captura de pestaña: sí' : 'Captura de pestaña: no',
            'Respuestas de ensayo (CLICKY_MOCK)',
          ],
          at: 'captura',
        },
        { type: 'button', text: 'Guíame paso a paso' },
      ],
    },
  ];
}
