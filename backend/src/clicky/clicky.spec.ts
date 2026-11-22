import {
  ConflictException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ClickyAccessGuard } from './clicky-access.guard.js';
import { lessonSchema } from './clicky.schemas.js';
import {
  BeatScanner,
  isClaudeModel,
  streamBeats,
  toClaudeRequest,
} from './brain.js';
import {
  buildMessages,
  ClickyService,
  describeAnnotation,
  describeWalk,
  mockPlan,
  type LessonEvent,
} from './clicky.service.js';
import { liveSttUrl, textToSpeech, wordStarts } from './elevenlabs.js';
import { anchorWord, cleanLesson, MAX_ACTIONS, MAX_BEATS } from './protocol.js';

const ctx = (headers: Record<string, string>, ip = '1.2.3.4') => {
  const req = { headers, ip } as never;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
};

/** Login apagado por defecto (como antes del login con GitHub). */
const authOff = {
  enabled: false,
  userFrom: () => null,
  assertAccess: () => {},
};

const guard = (status: string, limit = 20, auth: object = authOff) =>
  new ClickyAccessGuard(
    {
      get: vi.fn(() => ({ status })),
      ownerOf: vi.fn(() => ({ github_id: 1, login: 'duena' })),
    } as never,
    { get: vi.fn(() => limit) } as never,
    auth as never,
  );

describe('ClickyAccessGuard', () => {
  it('deja pasar con una simulación en curso', () => {
    expect(
      guard('running').canActivate(ctx({ 'x-sim-id': 'sim-0a1b2c3d' })),
    ).toBe(true);
  });

  it('rechaza sin x-sim-id o con un id mal formado', () => {
    expect(() => guard('running').canActivate(ctx({}))).toThrow(HttpException);
    expect(() =>
      guard('running').canActivate(ctx({ 'x-sim-id': '../etc' })),
    ).toThrow(HttpException);
  });

  it('deja pasar una simulación terminada, para repasarla', () => {
    expect(
      guard('finished').canActivate(ctx({ 'x-sim-id': 'sim-0a1b2c3d' })),
    ).toBe(true);
  });

  it('rechaza una simulación fallida o detenida', () => {
    expect(() =>
      guard('failed').canActivate(ctx({ 'x-sim-id': 'sim-0a1b2c3d' })),
    ).toThrow(ConflictException);
    expect(() =>
      guard('stopped').canActivate(ctx({ 'x-sim-id': 'sim-0a1b2c3d' })),
    ).toThrow(ConflictException);
  });

  it('con login: sin sesión responde 401', () => {
    const auth = {
      enabled: true,
      userFrom: () => null,
      assertAccess: () => {},
    };
    expect(() =>
      guard('running', 20, auth).canActivate(
        ctx({ 'x-sim-id': 'sim-0a1b2c3d' }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('con login: la simulación de otro usuario responde 404', () => {
    const auth = {
      enabled: true,
      userFrom: () => ({ github_id: 2, login: 'otro', admin: false }),
      assertAccess: (_u: unknown, owner: { github_id: number }) => {
        if (owner.github_id !== 2) throw new NotFoundException();
      },
    };
    expect(() =>
      guard('running', 20, auth).canActivate(
        ctx({ 'x-sim-id': 'sim-0a1b2c3d' }),
      ),
    ).toThrow(NotFoundException);
  });

  it('limita las preguntas por minuto por IP', () => {
    const g = guard('running', 2);
    const c = ctx({ 'x-sim-id': 'sim-0a1b2c3d' });
    g.canActivate(c);
    g.canActivate(c);
    expect(() => g.canActivate(c)).toThrow(/Demasiadas/);
    expect(g.canActivate(ctx({ 'x-sim-id': 'sim-0a1b2c3d' }, '5.6.7.8'))).toBe(
      true,
    );
  });
});

describe('lessonSchema', () => {
  it('acepta una pregunta con captura JPEG', () => {
    const r = lessonSchema.safeParse({
      question: 'hola',
      screenshot: 'data:image/jpeg;base64,AAAA',
    });
    expect(r.success).toBe(true);
  });

  it('rechaza capturas que no son imágenes en data URL', () => {
    expect(
      lessonSchema.safeParse({
        question: 'hola',
        screenshot: 'https://evil.example/x.png',
      }).success,
    ).toBe(false);
    expect(lessonSchema.safeParse({ question: '' }).success).toBe(false);
  });
});

describe('wordStarts', () => {
  it('da el segundo en que empieza cada palabra', () => {
    const chars = 'Hola mundo'.split('');
    const r = wordStarts({
      characters: chars,
      character_start_times_seconds: chars.map((_, i) => i * 0.1),
      character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.1),
    });
    expect(r.words).toEqual([0, 0.5]);
    expect(r.duration).toBeCloseTo(1);
  });
});

describe('cleanLesson', () => {
  it('descarta marcas con ids que no están en pantalla y tipos desconocidos', () => {
    const beats = cleanLesson(
      {
        beats: [
          {
            say: 'Mira aquí',
            marks: [
              { type: 'ring', target: 'a' },
              { type: 'ring', target: 'x' },
              { type: 'eval', code: 'alert(1)' },
            ],
          },
        ],
      },
      new Set(['a']),
    );
    expect(beats[0].marks).toEqual([
      { type: 'ring', target: 'a', label: undefined, n: undefined, word: 1 },
    ]);
  });

  it('ancla cada marca a la palabra que la nombra', () => {
    const [beat] = cleanLesson(
      {
        beats: [
          {
            say: 'Mira primero el título y después este botón rojo',
            marks: [
              { type: 'spotlight', target: 'a' },
              { type: 'ring', target: 'a', at: 'el título' },
              { type: 'target', target: 'b', at: 'Este Botón' },
              { type: 'button', text: '¿Y ahora?' },
            ],
          },
        ],
      },
      new Set(['a', 'b']),
    );
    expect(beat.marks.map((m) => m.word)).toEqual([0, 2, 6, 8]);
  });

  it('reparte a lo largo de la frase las marcas sin ancla', () => {
    const [beat] = cleanLesson(
      {
        beats: [
          {
            say: 'uno dos tres cuatro cinco seis',
            marks: [
              { type: 'ring', target: 'a' },
              { type: 'underline', target: 'a', at: 'no está' },
            ],
          },
        ],
      },
      new Set(['a']),
    );
    expect(beat.marks.map((m) => m.word)).toEqual([1, 4]);
  });
});

describe('pizarra por piezas', () => {
  const ids = new Set<string>();
  const marks = (beats: unknown[]) =>
    cleanLesson({ beats }, ids).map((b) => b.marks);

  it('arma la pizarra beat a beat: abrir, cajas y flechas entre cajas ya dibujadas', () => {
    const [open, first, second] = marks([
      {
        say: 'Te dibujo cómo funciona',
        marks: [{ type: 'board', title: 'Token', cols: 9, rows: 2 }],
      },
      {
        say: 'Primero inicias sesión',
        marks: [
          {
            type: 'node',
            id: 'a',
            text: 'Inicias sesión',
            col: 0,
            row: 0,
            at: 'inicias',
          },
        ],
      },
      {
        say: 'y recibes un token',
        marks: [
          { type: 'edge', from: 'a', to: 'b', label: 'entrega' },
          {
            type: 'node',
            id: 'b',
            text: 'Token',
            col: 1,
            row: 0,
            at: 'un token',
          },
          { type: 'edge', from: 'a', to: 'b', label: 'entrega', at: 'recibes' },
        ],
      },
    ]);
    expect(open[0]).toMatchObject({ type: 'board', cols: 4, rows: 2 });
    expect(first[0]).toMatchObject({
      type: 'node',
      id: 'a',
      col: 0,
      row: 0,
      word: 1,
    });
    // la flecha antes de su caja se descarta; la que va después queda
    expect(second.map((m) => m.type)).toEqual(['node', 'edge']);
    // anclada a "recibes" (1), pero su caja "un token" va en la 2: la flecha espera a la caja
    expect(second[1]).toMatchObject({ from: 'a', to: 'b', word: 2 });
  });

  it('sin pizarra abierta no hay cajas, y una celda ocupada pasa a la siguiente libre', () => {
    expect(
      marks([
        { say: 'hola', marks: [{ type: 'node', id: 'a', text: 'x' }] },
      ])[0],
    ).toEqual([]);
    const [, , dup] = marks([
      { say: 'abro', marks: [{ type: 'board', title: 't', cols: 2, rows: 1 }] },
      {
        say: 'uno',
        marks: [{ type: 'node', id: 'a', text: 'A', col: 0, row: 0 }],
      },
      {
        say: 'dos',
        marks: [{ type: 'node', id: 'b', text: 'B', col: 0, row: 0 }],
      },
    ]);
    expect(dup[0]).toMatchObject({ id: 'b', col: 1, row: 0 });
  });

  it('una sola pizarra o chart por respuesta', () => {
    const [, second] = marks([
      { say: 'abro', marks: [{ type: 'board', title: 't' }] },
      {
        say: 'otra',
        marks: [
          { type: 'board', title: 'u' },
          {
            type: 'chart',
            title: 'c',
            bars: [
              { label: 'a', value: 1 },
              { label: 'b', value: 2 },
            ],
          },
        ],
      },
    ]);
    expect(second).toEqual([]);
  });

  it('cajas con tono (ataque, defensa, clave) y flechas de ataque; `hot` vale como clave', () => {
    const [, boxes, arrows] = marks([
      { say: 'abro', marks: [{ type: 'board', title: 't', cols: 3, rows: 2 }] },
      {
        say: 'las cajas',
        marks: [
          {
            type: 'node',
            id: 'a',
            text: 'Atacante',
            col: 0,
            row: 0,
            tone: 'attack',
          },
          { type: 'node', id: 'b', text: 'Token', col: 1, row: 0, hot: true },
          {
            type: 'node',
            id: 'c',
            text: 'Defensa',
            col: 2,
            row: 0,
            tone: 'defense',
          },
          {
            type: 'node',
            id: 'd',
            text: 'Raro',
            col: 0,
            row: 1,
            tone: 'purple',
          },
        ],
      },
      {
        say: 'las flechas',
        marks: [
          { type: 'edge', from: 'a', to: 'b', label: 'roba', tone: 'problem' },
          { type: 'edge', from: 'b', to: 'c', label: 'abre', tone: 'calm' },
        ],
      },
    ]);
    const tones = (ms: unknown[]) =>
      ms.map((m) => (m as { tone?: string }).tone);
    expect(tones(boxes)).toEqual(['attack', 'key', 'defense', undefined]);
    expect(tones(arrows)).toEqual(['attack', undefined]);
  });

  it('un solo ejemplo de la vida diaria por respuesta, con el texto acotado', () => {
    const [first, second] = marks([
      {
        say: 'Es como una pulsera de festival',
        marks: [
          {
            type: 'example',
            text: 'Es como la pulsera de un festival: quien la tenga, entra. '.repeat(
              4,
            ),
          },
          { type: 'example' },
        ],
      },
      {
        say: 'otro',
        marks: [{ type: 'example', text: 'Rotar es cambiar la chapa' }],
      },
    ]);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ type: 'example' });
    expect(
      (first[0] as unknown as { text: string }).text.length,
    ).toBeLessThanOrEqual(110);
    expect(second).toEqual([]);
  });

  it('arquitectura: zonas por rangos de celdas, íconos conocidos y pasos numerados', () => {
    const [open, boxes, arrows] = marks([
      {
        say: 'abro con sus zonas',
        marks: [
          { type: 'board', title: 't', cols: 3, rows: 2 },
          {
            type: 'zone',
            label: 'Internet',
            cols: [0, 0],
            rows: [0, 9],
            tone: 'attack',
          },
          { type: 'zone', label: 'Tu app', cols: [2, 1], rows: 1 },
          { type: 'zone', label: '' },
        ],
      },
      {
        say: 'las cajas',
        marks: [
          {
            type: 'node',
            id: 'a',
            text: 'Atacante',
            col: 0,
            row: 0,
            icon: 'attacker',
          },
          {
            type: 'node',
            id: 'b',
            text: 'API',
            col: 1,
            row: 0,
            icon: 'rocket',
          },
        ],
      },
      {
        say: 'las flechas',
        marks: [
          { type: 'edge', from: 'a', to: 'b', tone: 'attack', n: 2 },
          { type: 'edge', from: 'b', to: 'a', n: 40 },
        ],
      },
    ]);
    expect(open.slice(1).map(({ word: _w, ...z }) => z)).toEqual([
      {
        type: 'zone',
        label: 'Internet',
        cols: [0, 0],
        rows: [0, 1],
        tone: 'attack',
      },
      {
        type: 'zone',
        label: 'Tu app',
        cols: [1, 2],
        rows: [1, 1],
        tone: undefined,
      },
    ]);
    const pick = (ms: unknown[], k: string) =>
      ms.map((m) => (m as Record<string, unknown>)[k]);
    expect(pick(boxes, 'icon')).toEqual(['attacker', undefined]);
    expect(pick(arrows, 'n')).toEqual([2, undefined]);
  });

  it('una zona sin pizarra no existe, y van máx 3 por pizarra', () => {
    const zone = (label: string) => ({ type: 'zone', label, cols: 0, rows: 0 });
    const [none, , more] = marks([
      { say: 'sin pizarra', marks: [zone('A')] },
      { say: 'abro', marks: [{ type: 'board', title: 't' }] },
      {
        say: 'zonas',
        marks: [zone('A'), zone('B'), zone('C'), zone('D')],
      },
    ]);
    expect(none).toEqual([]);
    expect(pick(more)).toEqual(['A', 'B', 'C']);
    function pick(ms: unknown[]) {
      return ms.map((m) => (m as { label: string }).label);
    }
  });

  it('mitre: solo IDs que existen en la copia local de ATT&CK, con su nombre oficial', () => {
    const [, boxes] = marks([
      { say: 'abro', marks: [{ type: 'board', title: 't', cols: 3, rows: 2 }] },
      {
        say: 'cajas',
        marks: [
          {
            type: 'node',
            id: 'a',
            text: 'Repo',
            col: 0,
            row: 0,
            mitre: 't1552.001',
          },
          {
            type: 'node',
            id: 'b',
            text: 'Vault',
            col: 1,
            row: 0,
            mitre: 'M1027',
          },
          {
            type: 'node',
            id: 'c',
            text: 'Nada',
            col: 2,
            row: 0,
            mitre: 'T9999',
          },
          {
            type: 'node',
            id: 'd',
            text: 'Raro',
            col: 0,
            row: 1,
            mitre: 'DROP TABLE',
          },
        ],
      },
    ]);
    expect(
      boxes.map((m) => [
        (m as { mitre?: string }).mitre,
        (m as { mitreName?: string }).mitreName,
      ]),
    ).toEqual([
      ['T1552.001', 'Credentials In Files'],
      ['M1027', 'Password Policies'],
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });
});

describe('anchorWord', () => {
  it('ignora tildes, mayúsculas y puntuación', () => {
    expect(anchorWord('Fíjate en la sesión, arriba.', 'sesion')).toBe(3);
    expect(anchorWord('Rota el JWT_SECRET ahora', 'jwt_secret')).toBe(2);
    expect(anchorWord('Hola', 'nada')).toBe(-1);
  });
});

describe('BeatScanner', () => {
  it('entrega cada beat apenas se cierra, aunque llegue en trozos', () => {
    const json =
      '{"beats":[{"say":"Mira {esto}, \\"ok\\"","marks":[{"type":"ring","target":"a"}]},{"say":"dos","marks":[]}]}';
    const scanner = new BeatScanner();
    const got: unknown[] = [];
    for (let i = 0; i < json.length; i += 7)
      got.push(...scanner.push(json.slice(i, i + 7)));
    expect(got).toEqual([
      { say: 'Mira {esto}, "ok"', marks: [{ type: 'ring', target: 'a' }] },
      { say: 'dos', marks: [] },
    ]);
  });

  it('no entrega nada hasta que el primer beat termina', () => {
    const scanner = new BeatScanner();
    expect(scanner.push('{"beats":[{"say":"hola","ma')).toEqual([]);
    expect(scanner.push('rks":[]}')).toEqual([{ say: 'hola', marks: [] }]);
  });
});

describe('toClaudeRequest', () => {
  it('saca el system, deja el historial y pone la captura antes del texto', () => {
    const out = toClaudeRequest([
      { role: 'system', content: 'eres Hinty' },
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'hola!' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'qué es esto?' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,QUJD', detail: 'high' },
          },
        ],
      },
    ]);
    expect(out.system).toBe('eres Hinty');
    expect(out.messages.slice(0, 2)).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'hola!' },
    ]);
    expect(out.messages[2].content).toEqual([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' },
      },
      { type: 'text', text: 'qué es esto?' },
    ]);
  });

  it('elige el proveedor por el nombre del modelo', () => {
    expect(isClaudeModel('claude-sonnet-5-5')).toBe(true);
    expect(isClaudeModel('gpt-6-luna')).toBe(false);
  });
});

describe('streamBeats con OpenAI', () => {
  const sse = (text: string) =>
    new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
    );
  const run = async () => {
    const out: unknown[] = [];
    for await (const b of streamBeats({
      key: 'k',
      model: 'gpt-6.1-sol',
      effort: 'medium',
      tier: 'fast',
      messages: [{ role: 'user', content: 'hola' }],
      signal: new AbortController().signal,
    }))
      out.push(b);
    return out;
  };

  it('pide Fast mode y el esfuerzo', async () => {
    const fetchMock = vi.fn(async () => sse('{"beats":[{"say":"hola"}]}'));
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await run()).toEqual([{ say: 'hola' }]);
      const body = JSON.parse(
        (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
          .body as string,
      );
      expect(body).toMatchObject({
        model: 'gpt-6.1-sol',
        reasoning_effort: 'medium',
        service_tier: 'fast',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('si el modelo no acepta Fast mode, reintenta sin él', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":{"param":"service_tier"}}', { status: 400 }),
      )
      .mockResolvedValueOnce(sse('{"beats":[{"say":"ok"}]}'));
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await run()).toEqual([{ say: 'ok' }]);
      const second = JSON.parse(
        (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string,
      );
      expect(second.service_tier).toBeUndefined();
      expect(second.reasoning_effort).toBe('medium');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('liveSttUrl', () => {
  it('arma la conexión en español, PCM 16 kHz, con keyterms repetidos y sin la key', () => {
    const url = new URL(liveSttUrl('scribe_v3_live', 'sutkn_x'));
    expect(url.origin + url.pathname).toBe(
      'wss://api.elevenlabs.io/v1/speech-to-text/realtime',
    );
    expect(url.searchParams.get('token')).toBe('sutkn_x');
    expect(url.searchParams.get('audio_format')).toBe('pcm_16000');
    expect(url.searchParams.get('language_code')).toBe('es');
    expect(url.searchParams.getAll('keyterms')).toContain('JWT');
  });
});

describe('voz con Eleven v4 Turbo', () => {
  const ok = () =>
    new Response(
      JSON.stringify({
        audio_base64: 'QUJD',
        alignment: {
          characters: ['h', 'o', 'l', 'a'],
          character_start_times_seconds: [0, 0.1, 0.2, 0.3],
          character_end_times_seconds: [0.1, 0.2, 0.3, 0.4],
        },
      }),
    );
  const call = (fetchMock: ReturnType<typeof vi.fn>, i: number) => {
    const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
    return { url, body: JSON.parse(init.body as string) };
  };

  it('v4 Turbo va por Text to Dialogue con una sola voz', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    try {
      const speech = await textToSpeech({
        key: 'k',
        voiceId: 'norah',
        model: 'eleven_v4_turbo',
        format: 'mp3_22050_32',
        text: 'hola',
        previousText: 'x'.repeat(150),
      });
      expect(speech).toMatchObject({
        audio: 'QUJD',
        words: [0],
        duration: 0.4,
      });
      const { url, body } = call(fetchMock, 0);
      expect(url).toBe(
        'https://api.elevenlabs.io/v1/text-to-dialogue/with-timestamps?output_format=mp3_22050_32',
      );
      expect(body).toMatchObject({
        inputs: [{ text: 'hola', voice_id: 'norah' }],
        model_id: 'eleven_v4_turbo',
        language_code: 'es',
      });
      expect(body.previous_text).toHaveLength(100);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('Flash sigue por Text to Speech', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    try {
      await textToSpeech({
        key: 'k',
        voiceId: 'norah',
        model: 'eleven_flash_v2_5',
        format: 'mp3_22050_32',
        text: 'hola',
      });
      const { url, body } = call(fetchMock, 0);
      expect(url).toContain('/text-to-speech/norah/with-timestamps');
      expect(body).toMatchObject({
        text: 'hola',
        apply_text_normalization: 'on',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('si v4 Turbo no está disponible, sigue con Flash y no lo reintenta', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"detail":"model"}', { status: 400 }),
      )
      .mockImplementation(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    try {
      const s = new ClickyService(
        {
          get: vi.fn(
            (k: string) =>
              ({
                ELEVENLABS_API_KEY: 'k',
                CLICKY_VOICE_ID: 'norah',
                CLICKY_TTS_MODEL: 'eleven_v4_turbo',
                CLICKY_TTS_FALLBACK_MODEL: 'eleven_flash_v2_5',
                CLICKY_TTS_FORMAT: 'mp3_22050_32',
                CLICKY_MAX_TTS_CHARS_PER_SIM: 10_000,
              })[k],
          ),
        } as never,
        { recordHinty: vi.fn() } as never,
      );
      const speak = (say: string) =>
        (
          s as unknown as {
            speak: (id: string, b: unknown) => Promise<{ audio?: unknown }>;
          }
        ).speak('sim-0a1b2c3d', { say });
      expect((await speak('hola')).audio).toBeTruthy();
      expect((await speak('chao')).audio).toBeTruthy();
      expect(
        fetchMock.mock.calls.map((_, i) => call(fetchMock, i).body.model_id),
      ).toEqual(['eleven_v4_turbo', 'eleven_flash_v2_5', 'eleven_flash_v2_5']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('ClickyService.lesson (ensayo)', () => {
  const service = (
    env: Record<string, unknown>,
    sims: unknown = { recordHinty: vi.fn() },
  ) =>
    new ClickyService(
      { get: vi.fn((k: string) => env[k]) } as never,
      sims as never,
    );

  it('manda los beats en orden, anclados, y termina con done', async () => {
    const s = service({ CLICKY_MOCK: true, CLICKY_MAX_QUESTIONS_PER_SIM: 5 });
    const events: LessonEvent[] = [];
    for await (const e of s.lesson(
      'sim-0a1b2c3d',
      lessonSchema.parse({
        question: 'hola',
        elements: [
          { id: 't', kind: 'título', text: 'Simulación' },
          { id: 'b', kind: 'botón', text: 'Pausa' },
        ],
        page: { title: 'Mayday', path: '/simulate' },
      }),
    ))
      events.push(e);
    expect(events.map((e) => e.type)).toEqual([
      ...Array(10).fill('beat'),
      'done',
    ]);
    const second = events[1] as Extract<LessonEvent, { type: 'beat' }>;
    expect(second.index).toBe(1);
    expect(second.marks[0]).toMatchObject({
      type: 'target',
      target: 'b',
      word: 1,
    });
  });

  it('deja la pregunta en el timeline para el reporte, sin la captura', async () => {
    const sims = { recordHinty: vi.fn() };
    const s = service(
      { CLICKY_MOCK: true, CLICKY_MAX_QUESTIONS_PER_SIM: 5 },
      sims,
    );
    for await (const _ of s.lesson(
      'sim-0a1b2c3d',
      lessonSchema.parse({
        question: '¿qué es este 401?',
        elements: [{ id: 'b', kind: 'botón', text: 'Pausa' }],
        voice: false,
      }),
    ));
    expect(sims.recordHinty).toHaveBeenCalledTimes(1);
    const [simId, rec] = sims.recordHinty.mock.calls[0];
    expect(simId).toBe('sim-0a1b2c3d');
    expect(rec).toMatchObject({
      question: '¿qué es este 401?',
      stepDone: false,
    });
    expect(rec.beats).toBeGreaterThan(0);
    expect(JSON.stringify(rec)).not.toContain('data:image');
  });

  it('un paso de guía completado se registra como paso, con la meta', async () => {
    const sims = { recordHinty: vi.fn() };
    const s = service(
      { CLICKY_MOCK: true, CLICKY_MAX_QUESTIONS_PER_SIM: 5 },
      sims,
    );
    for await (const _ of s.lesson(
      'sim-0a1b2c3d',
      lessonSchema.parse({
        question: 'listo',
        voice: false,
        walk: { goal: 'ver los logs', done: ['abrir Render'] },
      }),
    ));
    expect(sims.recordHinty.mock.calls[0][1]).toMatchObject({
      question: 'ver los logs',
      stepDone: true,
      walkGoal: 'ver los logs',
    });
  });

  it('si registrar falla, la respuesta sigue igual', async () => {
    const sims = {
      recordHinty: vi.fn(() => {
        throw new Error('caída');
      }),
    };
    const s = service(
      { CLICKY_MOCK: true, CLICKY_MAX_QUESTIONS_PER_SIM: 5 },
      sims,
    );
    const events: LessonEvent[] = [];
    for await (const e of s.lesson(
      'sim-0a1b2c3d',
      lessonSchema.parse({ question: 'x', voice: false }),
    ))
      events.push(e);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('respeta el tope de preguntas por simulación antes de llamar al modelo', async () => {
    const s = service({ CLICKY_MOCK: true, CLICKY_MAX_QUESTIONS_PER_SIM: 0 });
    const it = s.lesson(
      'sim-0a1b2c3d',
      lessonSchema.parse({ question: 'x', voice: false }),
    );
    await expect(it.next()).rejects.toThrow(/máximo de preguntas/);
  });
});

describe('marcas con color y formas variadas', () => {
  const ids = new Set(['err', 'ok', 'dato']);

  it('acepta garabato, tacha, tick y pregunta', () => {
    const [beat] = cleanLesson(
      {
        beats: [
          {
            say: 'El error preocupa, lo viejo sobra y el dato no calza',
            marks: [
              { type: 'scribble', target: 'err', at: 'preocupa' },
              { type: 'cross', target: 'ok', at: 'sobra' },
              { type: 'question', target: 'dato', at: 'no calza' },
              { type: 'check', target: 'nope', at: 'dato' },
            ],
          },
        ],
      },
      ids,
    );
    expect(beat.marks.map((m) => m.type)).toEqual([
      'scribble',
      'cross',
      'question',
    ]);
    expect(beat.marks.map((m) => m.word)).toEqual([2, 5, 9]);
  });

  it('el tono solo vale en las marcas que lo usan y con valores conocidos', () => {
    const [beat] = cleanLesson(
      {
        beats: [
          {
            say: 'Mira este error y este dato',
            marks: [
              {
                type: 'ring',
                target: 'err',
                tone: 'problem',
                at: 'este error',
              },
              {
                type: 'highlight',
                target: 'dato',
                tone: 'problem',
                at: 'este dato',
              },
              { type: 'underline', target: 'ok', tone: 'rojo', at: 'mira' },
              { type: 'arrow', from: 'err', to: 'dato', tone: 'help', at: 'y' },
            ],
          },
        ],
      },
      ids,
    );
    // en Hinty el único tono es el del atacante (ámbar punteado); "problem" se lee igual
    expect(beat.marks.find((m) => m.type === 'ring')?.tone).toBe('attack');
    expect(
      beat.marks.find((m) => m.type === 'highlight')?.tone,
    ).toBeUndefined();
    expect(
      beat.marks.find((m) => m.type === 'underline')?.tone,
    ).toBeUndefined();
    expect(beat.marks.find((m) => m.type === 'arrow')?.tone).toBeUndefined();
  });

  it('deja explicar completo: hasta MAX_BEATS frases', () => {
    const beats = Array.from({ length: 14 }, (_, i) => ({
      say: `Frase número ${i} de la explicación`,
      marks: [],
    }));
    expect(cleanLesson({ beats }, ids)).toHaveLength(MAX_BEATS);
  });
});

describe('lo que marca el usuario (modo marcar + shift)', () => {
  const body = (annotation: unknown) =>
    lessonSchema.safeParse({
      question: '¿qué es esto?',
      elements: [
        { id: 'e1', kind: 'texto', text: 'Token expirado' },
        { id: 'e2', kind: 'botón', text: 'Rotar' },
      ],
      annotation,
    });

  it('valida la forma del gesto', () => {
    expect(
      body({
        shape: 'circle',
        box: { x: 10, y: 20, w: 80, h: 40 },
        elements: ['e1'],
      }).success,
    ).toBe(true);
    expect(
      body({ shape: 'spiral', box: { x: 0, y: 0, w: 1, h: 1 } }).success,
    ).toBe(false);
    expect(body(undefined).data?.annotation).toBeNull();
  });

  it('le dice al modelo qué encerró y que parta por ahí', () => {
    const parsed = body({
      shape: 'circle',
      box: { x: 10, y: 20, w: 80, h: 40 },
      elements: ['e1', 'zz'],
    });
    const text = describeAnnotation(parsed.data!);
    expect(text).toMatch(/encerró/);
    expect(text).toMatch(/e1 \(texto\): Token expirado/);
    expect(text).not.toMatch(/zz/);
    expect(text).toMatch(/primer beat/);
  });

  it('el ensayo empieza por lo que marcó', async () => {
    const s = new ClickyService(
      {
        get: vi.fn(
          (k: string) =>
            ({ CLICKY_MOCK: true, CLICKY_MAX_QUESTIONS_PER_SIM: 5 })[k],
        ),
      } as never,
      { recordHinty: vi.fn() } as never,
    );
    const parsed = body({
      shape: 'underline',
      box: { x: 0, y: 0, w: 90, h: 6 },
      elements: ['e1'],
    });
    const first = await s
      .lesson('sim-0a1b2c3d', { ...parsed.data!, voice: false })
      .next();
    expect(first.value).toMatchObject({
      type: 'beat',
      marks: [{ type: 'ring', target: 'e1' }],
    });
  });
});

describe('fase de la simulación en el prompt de Clicky', () => {
  it('en curso guía sin dar la contención; terminada explica todo', async () => {
    const { phaseNote } = await import('./clicky.service.js');
    expect(phaseNote('running')).toContain('no le digas qué acción tomar');
    expect(phaseNote('paused')).toContain('no le digas qué acción tomar');
    expect(phaseNote('finished')).toMatch(/puedes explicar todo/i);
  });
});

describe('como HeyClicky: señalar, guiar y hacer', () => {
  const ids = new Set(['e1', 'e2', 'e3', 'e4']);

  it('point y las marcas de texto se anclan a palabras exactas del elemento', () => {
    const [beat] = cleanLesson(
      {
        beats: [
          {
            say: 'Mira este secreto de acá',
            marks: [
              {
                type: 'point',
                target: 'e1',
                text: 'JWT_SECRET',
                label: 'aquí',
                at: 'este secreto',
              },
              { type: 'frame', target: 'e2', text: 'no aplica', at: 'acá' },
            ],
          },
        ],
      },
      ids,
    );
    expect(beat.marks[0]).toMatchObject({
      type: 'point',
      target: 'e1',
      text: 'JWT_SECRET',
      word: 1,
    });
    // frame marca una zona entera: no usa text
    expect(beat.marks[1].text).toBeUndefined();
  });

  it('un step cierra la respuesta: nada se dibuja después de él', () => {
    const beats = cleanLesson(
      {
        beats: [
          {
            say: 'Primero abre esta pestaña de logs',
            marks: [
              { type: 'step', target: 'e1', label: 'Abre Logs', at: 'esta' },
              { type: 'ring', target: 'e2', at: 'logs' },
            ],
          },
          { say: 'Y después mira esto otro', marks: [] },
        ],
      },
      ids,
    );
    expect(beats).toHaveLength(1);
    expect(beats[0].marks.map((m) => m.type)).toEqual(['step']);
  });

  it('acciones: type necesita texto y hay un tope por respuesta', () => {
    const [beat] = cleanLesson(
      {
        beats: [
          {
            say: 'Lo hago yo ahora mismo por ti',
            marks: [
              { type: 'type', target: 'e1' },
              { type: 'type', target: 'e1', value: 'hola' },
              { type: 'click', target: 'e2' },
              { type: 'scroll', target: 'e3' },
              { type: 'click', target: 'e4' },
            ],
          },
        ],
      },
      ids,
    );
    expect(beat.marks.map((m) => m.type)).toEqual(['type', 'click', 'scroll']);
    expect(beat.marks[0]).toMatchObject({ value: 'hola' });
    expect(beat.marks).toHaveLength(MAX_ACTIONS);
  });

  it('el modelo recibe la caja de cada elemento y qué es del atacante', () => {
    const input = lessonSchema.parse({
      question: '¿qué pasa?',
      elements: [
        { id: 'e1', kind: 'botón', text: 'Rotar', box: [10, 20, 80, 32] },
        { id: 'e2', kind: 'fila', text: 'POST /login', attack: true },
      ],
      viewport: { w: 1440, h: 900 },
      interrupted: 'El token expiró porque',
    });
    const text = (buildMessages(input).at(-1) as { content: string }).content;
    expect(text).toContain('- e1 (botón) [10 20 80×32]: Rotar');
    expect(text).toContain('- e2 (fila) [atacante]: POST /login');
    expect(text).toContain('1440×900');
    expect(text).toMatch(/interrumpió mientras decías: "El token expiró/);
  });

  it('varios trazos, cada uno con lo que iba diciendo', () => {
    const input = lessonSchema.parse({
      question: '¿y esto con esto?',
      elements: [
        { id: 'e1', kind: 'texto', text: 'Token expirado' },
        { id: 'e2', kind: 'botón', text: 'Rotar' },
      ],
      annotation: {
        marks: [
          {
            shape: 'circle',
            box: { x: 0, y: 0, w: 50, h: 30 },
            elements: ['e1'],
            said: 'esto de acá',
          },
          {
            shape: 'point',
            box: { x: 90, y: 0, w: 4, h: 4 },
            elements: ['e2'],
            said: 'con esto',
          },
        ],
      },
    });
    const text = describeAnnotation(input);
    expect(text).toMatch(/1\. encerró .* mientras decía "esto de acá"/);
    expect(text).toMatch(/2\. señaló .* mientras decía "con esto"/);
    expect(text).toMatch(/orden de sus trazos/);
  });

  it('la guía en curso pide solo el siguiente paso y cierra a los 15', () => {
    const walk = (done: string[]) =>
      describeWalk(
        lessonSchema.parse({ question: 'x', walk: { goal: 'ver logs', done } }),
      );
    expect(walk(['Abre Logs'])).toMatch(/SOLO el siguiente paso/);
    expect(walk(['Abre Logs'])).toContain('1. Abre Logs');
    expect(walk(Array(15).fill('paso'))).toMatch(/cierra la guía/);
  });

  it('el ensayo guía con step y continúa paso a paso hasta terminar', () => {
    const elements = [
      { id: 'e1', kind: 'título', text: 'Simulación' },
      { id: 'e2', kind: 'botón', text: 'Logs' },
      { id: 'e3', kind: 'botón', text: 'Filtrar' },
      { id: 'e4', kind: 'botón', text: 'Terminar sesión' },
    ];
    const plan = (body: object) =>
      cleanLesson(
        { beats: mockPlan(lessonSchema.parse({ elements, ...body })) },
        ids,
      );
    const first = plan({ question: 'guíame a los logs' });
    expect(first.at(-1)?.marks.at(-1)).toMatchObject({
      type: 'step',
      target: 'e2',
    });
    const second = plan({
      question: 'x',
      walk: { goal: 'guíame a los logs', done: ['Logs'] },
    });
    // nunca guía hacia lo irreversible (Terminar sesión)
    expect(second[0].marks[0]).toMatchObject({ type: 'step', target: 'e3' });
    const last = plan({
      question: 'x',
      walk: { goal: 'guíame a los logs', done: ['Logs', 'Filtrar'] },
    });
    expect(last[0].marks[0]).toMatchObject({ type: 'check' });
  });

  it('en curso no entrega la contención ni con step, click o type', async () => {
    const { phaseNote } = await import('./clicky.service.js');
    expect(phaseNote('running')).toMatch(/nunca pongas un step, click ni type/);
  });
});
