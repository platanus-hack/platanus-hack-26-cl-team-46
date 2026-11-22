// Cerebro de Clicky: Claude (o un modelo de OpenAI) con la captura, en streaming. En vez
// de esperar el JSON completo, entrega cada beat apenas el modelo cierra su objeto, para
// que su voz se genere y suene mientras el modelo sigue escribiendo los siguientes.
import Anthropic from '@anthropic-ai/sdk';

const OPENAI = 'https://api.openai.com/v1';
/** Espera máxima hasta que el modelo empieza a escribir (razona antes, con la captura). */
const FIRST_MS = 45_000;
/** Ya escribiendo, si se queda callado este rato se corta: se colgó. */
const IDLE_MS = 20_000;
/** Tope de toda la respuesta, aunque siga escribiendo (10 beats caben de sobra). */
const MAX_MS = 120_000;

/** Los modelos `claude-*` van por la API de Claude; el resto, por la de OpenAI. */
export const isClaudeModel = (model: string) => model.startsWith('claude-');

/** El modelo no pudo responder: `status` es el código HTTP del proveedor (0 si no hubo respuesta). */
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
  /** Ya se cerró el arreglo de beats: lo que venga después (JSON repetido, texto) se ignora. */
  private closed = false;
  private depth = 0;
  /** Corchetes abiertos dentro del arreglo pero fuera de un beat. */
  private brackets = 0;
  private inString = false;
  private escaped = false;
  private start = -1;

  push(chunk: string): unknown[] {
    const out: unknown[] = [];
    if (this.closed) return out;
    this.buf += chunk;
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
      } else if (this.depth === 0 && c === '[') this.brackets++;
      else if (this.depth === 0 && c === ']') {
        // el "]" que cierra "beats": se termina la lectura
        if (this.brackets-- === 0) {
          this.closed = true;
          break;
        }
      } else if (c === '}') {
        if (this.depth === 0) continue; // una llave suelta fuera de un beat no cuenta
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

/**
 * Plazos del stream: hasta FIRST_MS para el primer trozo, IDLE_MS entre trozos (`touch()` en
 * cada uno reinicia la espera) y MAX_MS para toda la respuesta. Si vence, la señal se corta
 * con un TimeoutError; si la corta quien pidió la respuesta, con su AbortError.
 */
export function deadline(
  signal: AbortSignal,
  { first = FIRST_MS, idle = IDLE_MS, max = MAX_MS } = {},
) {
  const quiet = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        quiet.abort(
          new DOMException('El modelo dejó de responder', 'TimeoutError'),
        ),
      ms,
    );
    timer.unref?.(); // no retiene el proceso
  };
  wait(first);
  return {
    signal: AbortSignal.any([signal, quiet.signal, AbortSignal.timeout(max)]),
    touch: () => wait(idle),
    done: () => clearTimeout(timer),
  };
}

/** Cada trozo de texto del stream SSE de chat/completions. `touch` se llama con cada trozo. */
async function* deltas(
  body: ReadableStream<Uint8Array>,
  touch: () => void,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
    touch();
    pending += decoder.decode(bytes, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const evt = JSON.parse(data) as {
          choices?: { delta?: { content?: string } }[];
        };
        const text = evt.choices?.[0]?.delta?.content;
        if (text) yield text;
      } catch {
        // línea incompleta o de control
      }
    }
  }
}

export interface BrainOptions {
  key: string;
  model: string;
  effort: string;
  /** Carril de OpenAI: "fast" responde hasta 2,5× más rápido al doble de precio. Claude lo ignora. */
  tier?: string;
  /** Conversación en formato chat/completions (system, historial y la última pregunta). */
  messages: unknown[];
  signal: AbortSignal;
}

export function streamBeats(opts: BrainOptions): AsyncGenerator<unknown> {
  return isClaudeModel(opts.model) ? streamClaude(opts) : streamOpenAI(opts);
}

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | (
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      )[];
};

/**
 * Pasa la conversación al formato de la API de Claude: el system va aparte y la captura
 * (data URL) va como imagen base64 antes del texto.
 */
export function toClaudeRequest(messages: unknown[]): {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
} {
  const system: string[] = [];
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages as ChatMessage[]) {
    if (m.role === 'system') {
      system.push(typeof m.content === 'string' ? m.content : '');
      continue;
    }
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const images: Anthropic.Beta.BetaImageBlockParam[] = [];
    const texts: Anthropic.Beta.BetaTextBlockParam[] = [];
    for (const part of m.content) {
      if (part.type === 'text') texts.push({ type: 'text', text: part.text });
      else {
        const data = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/s.exec(
          part.image_url.url,
        );
        if (data)
          images.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: data[1] as 'image/png',
              data: data[2],
            },
          });
      }
    }
    out.push({ role: m.role, content: [...images, ...texts] });
  }
  return { system: system.join('\n\n'), messages: out };
}

async function* streamClaude(opts: BrainOptions): AsyncGenerator<unknown> {
  const { system, messages } = toClaudeRequest(opts.messages);
  const client = new Anthropic({ apiKey: opts.key, maxRetries: 1 });
  // "none" apaga el razonamiento previo; low/medium/high fijan el esfuerzo; "default"
  // deja el del modelo.
  const effort =
    opts.effort === 'none'
      ? { thinking: { type: 'between_tools' as const } }
      : opts.effort === 'default'
        ? {}
        : {
            output_config: {
              effort: opts.effort as 'low' | 'medium' | 'high',
            },
          };
  const limit = deadline(opts.signal);
  try {
    const stream = client.beta.messages.stream(
      {
        model: opts.model,
        max_tokens: 16_000,
        system: [
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
        ],
        messages,
        ...effort,
        // Si los clasificadores de seguridad rechazan (las simulaciones hablan de
        // ataques), el servidor reintenta con otro modelo en vez de cortar.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      },
      { signal: limit.signal },
    );
    const scanner = new BeatScanner();
    for await (const evt of stream) {
      limit.touch(); // cualquier evento (también el razonamiento) cuenta como vivo
      if (evt.type === 'content_block_delta' && evt.delta.type === 'text_delta')
        yield* scanner.push(evt.delta.text);
    }
  } catch (err) {
    // El SDK envuelve el corte en un APIError: se devuelve el motivo real (cancelado o plazo).
    if (limit.signal.aborted) throw limit.signal.reason ?? err;
    if (err instanceof Anthropic.APIError)
      throw new BrainError(String(err.message).slice(0, 300), err.status ?? 0);
    throw err;
  } finally {
    limit.done();
  }
}

async function* streamOpenAI(opts: BrainOptions): AsyncGenerator<unknown> {
  const limit = deadline(opts.signal);
  try {
    yield* readOpenAI(opts, limit);
  } finally {
    limit.done();
  }
}

async function* readOpenAI(
  opts: BrainOptions,
  limit: ReturnType<typeof deadline>,
): AsyncGenerator<unknown> {
  const send = (withEffort: boolean, withTier: boolean) =>
    fetch(`${OPENAI}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        response_format: { type: 'json_object' },
        stream: true,
        ...(withEffort ? { reasoning_effort: opts.effort } : {}),
        ...(withTier ? { service_tier: opts.tier } : {}),
      }),
      signal: limit.signal,
    });

  let withEffort = opts.effort !== 'default';
  let withTier = !!opts.tier && opts.tier !== 'default';
  let res = await send(withEffort, withTier);
  // Un modelo sin reasoning_effort o sin ese carril (si se cambia CLICKY_BRAIN_MODEL):
  // se reintenta sin lo que rechazó, en vez de dejar a Hinty mudo.
  for (let i = 0; i < 2 && res.status === 400; i++) {
    const body = await res.text();
    if (withTier && /service_tier/i.test(body)) withTier = false;
    else if (withEffort && /reasoning/i.test(body)) withEffort = false;
    else throw new BrainError(body.slice(0, 300), 400);
    res = await send(withEffort, withTier);
  }
  if (!res.ok || !res.body)
    throw new BrainError((await res.text()).slice(0, 300), res.status);

  const scanner = new BeatScanner();
  for await (const text of deltas(res.body, limit.touch))
    yield* scanner.push(text);
}
