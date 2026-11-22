// Cerebro de Hinty: Claude con la captura, en streaming. En vez de esperar el JSON
// completo, entrega cada beat apenas el modelo cierra su objeto, para que su voz se
// genere y suene mientras el modelo sigue escribiendo los siguientes.
import Anthropic from '@anthropic-ai/sdk';

/** El modelo no pudo responder: `status` es el código HTTP de la API de Claude (0 si no hubo respuesta). */
export class BrainError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Lee `{"beats":[{...},{...}]}` a medida que llega y devuelve cada objeto del arreglo
 * apenas se cierra. Respeta strings y escapes, así una llave dentro de un texto no corta.
 */
export class BeatScanner {
  private buf = '';
  private pos = 0;
  private inArray = false;
  private depth = 0;
  private inString = false;
  private escaped = false;
  private start = -1;

  push(chunk: string): unknown[] {
    this.buf += chunk;
    const out: unknown[] = [];
    if (!this.inArray) {
      const m = /"beats"\s*:\s*\[/.exec(this.buf);
      if (!m) return out;
      this.inArray = true;
      this.pos = m.index + m[0].length;
    }
    for (; this.pos < this.buf.length; this.pos++) {
      const c = this.buf[this.pos];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (c === '\\') this.escaped = true;
        else if (c === '"') this.inString = false;
        continue;
      }
      if (c === '"') this.inString = true;
      else if (c === '{') {
        if (this.depth === 0) this.start = this.pos;
        this.depth++;
      } else if (c === '}') {
        this.depth--;
        if (this.depth === 0 && this.start >= 0) {
          try {
            out.push(JSON.parse(this.buf.slice(this.start, this.pos + 1)));
          } catch {
            // un beat roto se descarta; los demás siguen
          }
          this.start = -1;
        }
      }
    }
    return out;
  }
}

export type BrainEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Si el modelo no termina en este tiempo, se corta (el usuario ya está esperando). */
const BRAIN_TIMEOUT_MS = 60_000;

export async function* streamBeats(opts: {
  client: Anthropic;
  model: string;
  effort: BrainEffort;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  signal: AbortSignal;
}): AsyncGenerator<unknown> {
  // Fallback del servidor ante un rechazo de los clasificadores de seguridad: Hinty habla
  // de ataques todo el rato y eso puede gatillar la categoría `cyber`.
  const fallback = /^claude-(opus|sonnet|fable)-/.test(opts.model)
    ? {
        betas: [
          'server-side-fallback-2026-07-01',
        ] as Anthropic.Beta.AnthropicBeta[],
        fallbacks: 'default' as const,
      }
    : {};
  const stream = opts.client.beta.messages.stream(
    {
      model: opts.model,
      max_tokens: 16_000,
      // El prompt de sistema es igual en todas las preguntas: va cacheado.
      system: [
        {
          type: 'text',
          text: opts.system,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: opts.messages,
      output_config: { effort: opts.effort },
      ...fallback,
    },
    {
      signal: AbortSignal.any([
        opts.signal,
        AbortSignal.timeout(BRAIN_TIMEOUT_MS),
      ]),
      maxRetries: 1,
    },
  );

  let scanner = new BeatScanner();
  try {
    for await (const ev of stream) {
      if (ev.type === 'content_block_start') {
        // Si un modelo rechazó a mitad y siguió el de respaldo, su JSON parte de cero.
        if ((ev.content_block.type as string) === 'fallback')
          scanner = new BeatScanner();
      } else if (
        ev.type === 'content_block_delta' &&
        ev.delta.type === 'text_delta'
      )
        yield* scanner.push(ev.delta.text);
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal')
      throw new BrainError(
        `${opts.model} rechazó la pregunta (${final.stop_details?.category ?? 'sin categoría'})`,
        0,
      );
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) {
      const abort = new Error('Respuesta cancelada');
      abort.name = 'AbortError';
      throw abort;
    }
    if (err instanceof Anthropic.APIError)
      throw new BrainError(err.message.slice(0, 300), err.status ?? 0);
    throw err;
  }
}
