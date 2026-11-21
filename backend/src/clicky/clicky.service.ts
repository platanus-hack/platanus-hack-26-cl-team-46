import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { LessonBody } from './clicky.schemas.js';
import { speechToText, textToSpeech, type Speech } from './elevenlabs.js';
import { SYSTEM_PROMPT } from './prompt.js';
import { cleanLesson, type Beat } from './protocol.js';

const OPENAI = 'https://api.openai.com/v1';

export type SpokenBeat = Beat & { audio?: Speech };

/**
 * Clicky: arma la explicación (OpenAI, con la captura de pantalla), le pone voz
 * (ElevenLabs) y transcribe lo que dice el usuario. Las keys nunca salen del backend
 * y el gasto queda acotado por simulación.
 */
@Injectable()
export class ClickyService {
  private readonly logger = new Logger(ClickyService.name);
  /** Uso por simulación (en memoria: se reinicia con el backend, y está bien así). */
  private readonly usage = new Map<string, { questions: number; ttsChars: number }>();

  constructor(private readonly config: ConfigService<Env, true>) {}

  private cfg<K extends keyof Env>(k: K): Env[K] {
    return this.config.get(k, { infer: true });
  }

  private use(simId: string) {
    let u = this.usage.get(simId);
    if (!u) this.usage.set(simId, (u = { questions: 0, ttsChars: 0 }));
    return u;
  }

  async lesson(simId: string, input: LessonBody): Promise<SpokenBeat[]> {
    const u = this.use(simId);
    if (u.questions >= this.cfg('CLICKY_MAX_QUESTIONS_PER_SIM'))
      throw new HttpException(
        'Clicky llegó al máximo de preguntas de esta simulación',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    u.questions++;

    const t0 = Date.now();
    const beats = this.cfg('CLICKY_MOCK')
      ? cleanLesson(mockLesson(input), new Set(input.elements.map((e) => e.id)))
      : await this.think(input);
    const spoken = input.voice ? await this.speak(simId, beats) : beats;
    this.logger.log(
      `[${simId}] lesson ${Date.now() - t0} ms · ${beats.length} beats · captura: ${input.screenshot ? 'sí' : 'no'} · voz: ${spoken.some((b) => 'audio' in b && b.audio) ? 'elevenlabs' : 'navegador'}`,
    );
    return spoken;
  }

  async transcribe(simId: string, audio: Buffer, mime: string): Promise<string> {
    if (this.cfg('CLICKY_MOCK')) return '¿Qué está pasando en esta pantalla?';
    const key = this.cfg('ELEVENLABS_API_KEY');
    if (!key)
      throw new ServiceUnavailableException(
        'Falta ELEVENLABS_API_KEY en el backend',
      );
    const text = await speechToText({
      key,
      model: this.cfg('CLICKY_STT_MODEL'),
      audio,
      mime,
    });
    this.logger.log(`[${simId}] transcribe ${audio.length} bytes`);
    return text;
  }

  /** OpenAI con visión: devuelve beats ya validados contra el contrato de marcas. */
  private async think(input: LessonBody): Promise<Beat[]> {
    const key = this.cfg('OPENAI_API_KEY');
    if (!key)
      throw new ServiceUnavailableException('Falta OPENAI_API_KEY en el backend');
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
    const messages = [
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
    const res = await fetch(`${OPENAI}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.cfg('CLICKY_BRAIN_MODEL'),
        messages,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const body = await res.text();
    if (!res.ok) {
      this.logger.error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
      throw new HttpException(
        'El modelo no pudo responder, intenta de nuevo',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const data = JSON.parse(body) as {
      choices?: { message?: { content?: string } }[];
    };
    let plan: unknown = {};
    try {
      plan = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    } catch {
      this.logger.warn('OpenAI devolvió un JSON inválido');
    }
    return cleanLesson(plan, new Set(input.elements.map((e) => e.id)));
  }

  /**
   * Voz de cada beat con ElevenLabs, en paralelo. Si no hay key, se pasa el tope de
   * la simulación o falla un beat, ese beat va sin audio y el navegador usa su voz.
   */
  private async speak(simId: string, beats: Beat[]): Promise<SpokenBeat[]> {
    const key = this.cfg('ELEVENLABS_API_KEY');
    if (!key || this.cfg('CLICKY_MOCK')) return beats;
    const u = this.use(simId);
    const chars = beats.reduce((n, b) => n + b.say.length, 0);
    if (u.ttsChars + chars > this.cfg('CLICKY_MAX_TTS_CHARS_PER_SIM')) {
      this.logger.warn(`[${simId}] tope de voz alcanzado: voz del navegador`);
      return beats;
    }
    u.ttsChars += chars;
    return Promise.all(
      beats.map(async (b, i) => {
        try {
          const audio = await textToSpeech({
            key,
            voiceId: this.cfg('CLICKY_VOICE_ID'),
            model: this.cfg('CLICKY_TTS_MODEL'),
            format: this.cfg('CLICKY_TTS_FORMAT'),
            text: b.say,
            previousText: beats[i - 1]?.say,
            nextText: beats[i + 1]?.say,
          });
          return { ...b, audio };
        } catch (err) {
          this.logger.warn(`[${simId}] TTS: ${(err as Error).message}`);
          return b;
        }
      }),
    );
  }
}

/** Respuesta de ensayo (CLICKY_MOCK=true): usa lo que hay en pantalla, sin IA. */
function mockLesson({ elements, page, screenshot }: LessonBody) {
  const title = elements.find((e) => e.kind.includes('título')) ?? elements[0];
  const button = elements.find((e) => e.kind === 'botón');
  return {
    beats: [
      {
        say: `Estás en ${page.title || 'esta página'}; parto por lo principal de la pantalla.`,
        marks: title
          ? [
              { type: 'spotlight', target: title.id },
              { type: 'ring', target: title.id, label: 'aquí' },
            ]
          : [],
      },
      {
        say: button
          ? `Este botón, ${button.text.slice(0, 40)}, es la siguiente acción.`
          : 'No veo botones en esta parte de la pantalla.',
        marks: button
          ? [{ type: 'target', target: button.id, label: 'siguiente paso' }]
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
          },
          { type: 'button', text: '¿Qué hago ahora?' },
        ],
      },
    ],
  };
}
