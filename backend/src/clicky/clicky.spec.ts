import { ConflictException, HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ClickyAccessGuard } from './clicky-access.guard.js';
import { lessonSchema } from './clicky.schemas.js';
import { BeatScanner } from './brain.js';
import { ClickyService, type LessonEvent } from './clicky.service.js';
import { liveSttUrl, wordStarts } from './elevenlabs.js';
import { anchorWord, cleanLesson } from './protocol.js';

const ctx = (headers: Record<string, string>, ip = '1.2.3.4') => {
  const req = { headers, ip } as never;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
};

const guard = (status: string, limit = 20) =>
  new ClickyAccessGuard(
    { get: vi.fn(() => ({ status })) } as never,
    { get: vi.fn(() => limit) } as never,
  );

describe('ClickyAccessGuard', () => {
  it('deja pasar con una simulación en curso', () => {
    expect(guard('running').canActivate(ctx({ 'x-sim-id': 'sim-0a1b2c3d' }))).toBe(true);
  });

  it('rechaza sin x-sim-id o con un id mal formado', () => {
    expect(() => guard('running').canActivate(ctx({}))).toThrow(HttpException);
    expect(() => guard('running').canActivate(ctx({ 'x-sim-id': '../etc' }))).toThrow(HttpException);
  });

  it('deja pasar una simulación terminada, para repasarla', () => {
    expect(guard('finished').canActivate(ctx({ 'x-sim-id': 'sim-0a1b2c3d' }))).toBe(true);
  });

  it('rechaza una simulación fallida o detenida', () => {
    expect(() => guard('failed').canActivate(ctx({ 'x-sim-id': 'sim-0a1b2c3d' }))).toThrow(ConflictException);
    expect(() => guard('stopped').canActivate(ctx({ 'x-sim-id': 'sim-0a1b2c3d' }))).toThrow(ConflictException);
  });

  it('limita las preguntas por minuto por IP', () => {
    const g = guard('running', 2);
    const c = ctx({ 'x-sim-id': 'sim-0a1b2c3d' });
    g.canActivate(c);
    g.canActivate(c);
    expect(() => g.canActivate(c)).toThrow(/Demasiadas/);
    expect(g.canActivate(ctx({ 'x-sim-id': 'sim-0a1b2c3d' }, '5.6.7.8'))).toBe(true);
  });
});

describe('lessonSchema', () => {
  it('acepta una pregunta con captura JPEG', () => {
    const r = lessonSchema.safeParse({ question: 'hola', screenshot: 'data:image/jpeg;base64,AAAA' });
    expect(r.success).toBe(true);
  });

  it('rechaza capturas que no son imágenes en data URL', () => {
    expect(lessonSchema.safeParse({ question: 'hola', screenshot: 'https://evil.example/x.png' }).success).toBe(false);
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
      { beats: [{ say: 'Mira aquí', marks: [{ type: 'ring', target: 'a' }, { type: 'ring', target: 'x' }, { type: 'eval', code: 'alert(1)' }] }] },
      new Set(['a']),
    );
    expect(beats[0].marks).toEqual([{ type: 'ring', target: 'a', label: undefined, n: undefined, word: 1 }]);
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
      { beats: [{ say: 'uno dos tres cuatro cinco seis', marks: [{ type: 'ring', target: 'a' }, { type: 'underline', target: 'a', at: 'no está' }] }] },
      new Set(['a']),
    );
    expect(beat.marks.map((m) => m.word)).toEqual([1, 4]);
  });
});

describe('pizarra por piezas', () => {
  const ids = new Set<string>();
  const marks = (beats: unknown[]) => cleanLesson({ beats }, ids).map((b) => b.marks);

  it('arma la pizarra beat a beat: abrir, cajas y flechas entre cajas ya dibujadas', () => {
    const [open, first, second] = marks([
      { say: 'Te dibujo cómo funciona', marks: [{ type: 'board', title: 'Token', cols: 9, rows: 2 }] },
      { say: 'Primero inicias sesión', marks: [{ type: 'node', id: 'a', text: 'Inicias sesión', col: 0, row: 0, at: 'inicias' }] },
      {
        say: 'y recibes un token',
        marks: [
          { type: 'edge', from: 'a', to: 'b', label: 'entrega' },
          { type: 'node', id: 'b', text: 'Token', col: 1, row: 0, at: 'un token' },
          { type: 'edge', from: 'a', to: 'b', label: 'entrega', at: 'recibes' },
        ],
      },
    ]);
    expect(open[0]).toMatchObject({ type: 'board', cols: 4, rows: 2 });
    expect(first[0]).toMatchObject({ type: 'node', id: 'a', col: 0, row: 0, word: 1 });
    // la flecha antes de su caja se descarta; la que va después queda
    expect(second.map((m) => m.type)).toEqual(['node', 'edge']);
    // anclada a "recibes" (1), pero su caja "un token" va en la 2: la flecha espera a la caja
    expect(second[1]).toMatchObject({ from: 'a', to: 'b', word: 2 });
  });

  it('sin pizarra abierta no hay cajas, y una celda ocupada pasa a la siguiente libre', () => {
    expect(marks([{ say: 'hola', marks: [{ type: 'node', id: 'a', text: 'x' }] }])[0]).toEqual([]);
    const [, , dup] = marks([
      { say: 'abro', marks: [{ type: 'board', title: 't', cols: 2, rows: 1 }] },
      { say: 'uno', marks: [{ type: 'node', id: 'a', text: 'A', col: 0, row: 0 }] },
      { say: 'dos', marks: [{ type: 'node', id: 'b', text: 'B', col: 0, row: 0 }] },
    ]);
    expect(dup[0]).toMatchObject({ id: 'b', col: 1, row: 0 });
  });

  it('una sola pizarra o chart por respuesta', () => {
    const [, second] = marks([
      { say: 'abro', marks: [{ type: 'board', title: 't' }] },
      { say: 'otra', marks: [{ type: 'board', title: 'u' }, { type: 'chart', title: 'c', bars: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] }] },
    ]);
    expect(second).toEqual([]);
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
    const json = '{"beats":[{"say":"Mira {esto}, \\"ok\\"","marks":[{"type":"ring","target":"a"}]},{"say":"dos","marks":[]}]}';
    const scanner = new BeatScanner();
    const got: unknown[] = [];
    for (let i = 0; i < json.length; i += 7) got.push(...scanner.push(json.slice(i, i + 7)));
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

describe('liveSttUrl', () => {
  it('arma la conexión en español, PCM 16 kHz, con keyterms repetidos y sin la key', () => {
    const url = new URL(liveSttUrl('scribe_v3_live', 'sutkn_x'));
    expect(url.origin + url.pathname).toBe('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
    expect(url.searchParams.get('token')).toBe('sutkn_x');
    expect(url.searchParams.get('audio_format')).toBe('pcm_16000');
    expect(url.searchParams.get('language_code')).toBe('es');
    expect(url.searchParams.getAll('keyterms')).toContain('JWT');
  });
});

describe('ClickyService.lesson (ensayo)', () => {
  const service = (env: Record<string, unknown>) =>
    new ClickyService({ get: vi.fn((k: string) => env[k]) } as never);

  it('manda los beats en orden, anclados, y termina con done', async () => {
    const s = service({ CLICKY_MOCK: true, CLICKY_MAX_QUESTIONS_PER_SIM: 5 });
    const events: LessonEvent[] = [];
    for await (const e of s.lesson('sim-0a1b2c3d', {
      question: 'hola',
      elements: [
        { id: 't', kind: 'título', text: 'Simulación' },
        { id: 'b', kind: 'botón', text: 'Pausa' },
      ],
      history: [],
      screenshot: null,
      page: { title: 'Mayday', path: '/simulate' },
      context: '',
      voice: true,
    }))
      events.push(e);
    expect(events.map((e) => e.type)).toEqual([...Array(7).fill('beat'), 'done']);
    const second = events[1] as Extract<LessonEvent, { type: 'beat' }>;
    expect(second.index).toBe(1);
    expect(second.marks[0]).toMatchObject({ type: 'target', target: 'b', word: 1 });
  });

  it('respeta el tope de preguntas por simulación antes de llamar al modelo', async () => {
    const s = service({ CLICKY_MOCK: true, CLICKY_MAX_QUESTIONS_PER_SIM: 0 });
    const it = s.lesson('sim-0a1b2c3d', { question: 'x', elements: [], history: [], screenshot: null, page: { title: '', path: '' }, context: '', voice: false });
    await expect(it.next()).rejects.toThrow(/máximo de preguntas/);
  });
});
