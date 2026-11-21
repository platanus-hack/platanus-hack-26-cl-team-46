// Cerebro de Clicky: OpenAI con la captura, en streaming. En vez de esperar el JSON
// completo, entrega cada beat apenas el modelo cierra su objeto, para que su voz se
// genere y suene mientras el modelo sigue escribiendo los siguientes.
const OPENAI = 'https://api.openai.com/v1';

/** El modelo no pudo responder: `status` es el código HTTP de OpenAI (0 si no hubo respuesta). */
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

/** Cada trozo de texto del stream SSE de chat/completions. */
async function* deltas(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
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

export async function* streamBeats(opts: {
  key: string;
  model: string;
  effort: string;
  messages: unknown[];
  signal: AbortSignal;
}): AsyncGenerator<unknown> {
  const send = (withEffort: boolean) =>
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
      }),
      signal: AbortSignal.any([opts.signal, AbortSignal.timeout(45_000)]),
    });

  const withEffort = opts.effort !== 'default';
  let res = await send(withEffort);
  if (withEffort && res.status === 400) {
    // Un modelo sin reasoning_effort (si se cambia CLICKY_BRAIN_MODEL): se reintenta sin él.
    const body = await res.text();
    if (!/reasoning/i.test(body)) throw new BrainError(body.slice(0, 300), 400);
    res = await send(false);
  }
  if (!res.ok || !res.body)
    throw new BrainError((await res.text()).slice(0, 300), res.status);

  const scanner = new BeatScanner();
  for await (const text of deltas(res.body)) yield* scanner.push(text);
}
