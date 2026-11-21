import { ConflictException, HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ClickyAccessGuard } from './clicky-access.guard.js';
import { lessonSchema } from './clicky.schemas.js';
import { wordStarts } from './elevenlabs.js';
import { cleanLesson } from './protocol.js';

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

  it('rechaza una simulación terminada', () => {
    expect(() => guard('finished').canActivate(ctx({ 'x-sim-id': 'sim-0a1b2c3d' }))).toThrow(ConflictException);
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
    expect(beats[0].marks).toEqual([{ type: 'ring', target: 'a', label: undefined, n: undefined }]);
  });
});
