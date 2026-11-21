import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
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

  constructor(private readonly config: ConfigService<Env, true>) {}

  private cfg<K extends keyof Env>(k: K): Env[K] {
    return this.config.get(k, { infer: true });
  }

  private use(simId: string) {
    let u = this.usage.get(simId);
    if (!u)
      this.usage.set(simId, (u = { questions: 0, ttsChars: 0, sttSessions: 0 }));
    return u;
  }

  /**
   * Beats en orden, cada uno con su voz, apenas están listos. Los errores antes del
   * primer beat se lanzan (el cliente recibe un HTTP de error); después van en el stream.
   */
  async *lesson(simId: string, input: LessonBody): AsyncGenerator<LessonEvent> {
    const u = this.use(simId);
    if (u.questions >= this.cfg('CLICKY_MAX_QUESTIONS_PER_SIM'))
      throw new HttpException(
        'Clicky llegó al máximo de preguntas de esta simulación',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const key = this.cfg('OPENAI_API_KEY');
    if (!this.cfg('CLICKY_MOCK') && !key)
      throw new ServiceUnavailableException('Falta OPENAI_API_KEY en el backend');
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
          messages: buildMessages(input),
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
          ready.push(input.voice ? this.speak(simId, beat, previous) : Promise.resolve(beat));
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
    try {
      for (;;) {
        if (sent < ready.length) {
          const beat = await ready[sent];
          if (sent === 0)
            this.logger.log(`[${simId}] primer beat en ${Date.now() - t0} ms`);
          if (beat.audio) voiced++;
          yield { type: 'beat', index: sent++, ...beat };
          continue;
        }
        if (finished) break;
        await new Promise<void>((r) => (wake = r));
      }
      if (failure) {
        const message = this.describe(failure);
        if (!sent)
          throw new HttpException(message, HttpStatus.BAD_GATEWAY);
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
      throw new ServiceUnavailableException('Falta ELEVENLABS_API_KEY en el backend');
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

  async transcribe(simId: string, audio: Buffer, mime: string): Promise<string> {
    if (this.cfg('CLICKY_MOCK')) return '¿Qué está pasando en esta pantalla?';
    const key = this.cfg('ELEVENLABS_API_KEY');
    if (!key)
      throw new ServiceUnavailableException('Falta ELEVENLABS_API_KEY en el backend');
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
    if (u.ttsChars + beat.say.length > this.cfg('CLICKY_MAX_TTS_CHARS_PER_SIM')) {
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

function buildMessages(input: LessonBody): unknown[] {
  const screen = input.elements
    .map((e) => `- ${e.id} (${e.kind}): ${e.text}`)
    .join('\n');
  const text = [
    input.context && `Contexto de la app: ${input.context}`,
    `Página: ${input.page.title} (${input.page.path})`,
    `Elementos en pantalla:\n${screen || '(ninguno)'}`,
    `Pregunta: ${input.question}`,
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
            { type: 'image_url', image_url: { url: input.screenshot, detail: 'high' } },
          ]
        : text,
    },
  ];
}

/** Respuesta de ensayo (CLICKY_MOCK=true): usa lo que hay en pantalla, sin IA, con pausas como el modelo. */
async function* mockBeats({ elements, page, screenshot }: LessonBody) {
  const title = elements.find((e) => e.kind.includes('título')) ?? elements[0];
  const button = elements.find((e) => e.kind === 'botón');
  const beats = [
    {
      say: `Estás en ${page.title || 'esta página'}; mira primero este título de aquí arriba.`,
      marks: title
        ? [
            { type: 'spotlight', target: title.id },
            { type: 'ring', target: title.id, label: 'aquí', at: 'este título' },
          ]
        : [],
    },
    {
      say: button
        ? `Y este botón, ${button.text.slice(0, 40)}, es la siguiente acción.`
        : 'No veo botones en esta parte de la pantalla.',
      marks: button
        ? [{ type: 'target', target: button.id, label: 'siguiente paso', at: 'este botón' }]
        : [],
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
        { type: 'button', text: '¿Qué hago ahora?' },
      ],
    },
  ];
  for (const beat of beats) {
    await new Promise((r) => setTimeout(r, 250));
    yield beat;
  }
}
