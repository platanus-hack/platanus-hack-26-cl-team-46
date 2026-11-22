import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { configWarnings, envSchema, validateEnv } from './env.js';

const base = { RENDER_API_KEY: 'rnd_test' };

describe('validateEnv', () => {
  it('sin RENDER_API_KEY no arranca y dice qué falta', () => {
    expect(() => validateEnv({})).toThrow(/RENDER_API_KEY/);
  });

  it('GITHUB_HACK26_ORG_TOKEN vale como GITHUB_TOKEN', () => {
    expect(
      validateEnv({ ...base, GITHUB_HACK26_ORG_TOKEN: 'ghp_x' }).GITHUB_TOKEN,
    ).toBe('ghp_x');
  });

  it('los interruptores leen "false" como apagado (no como un string no vacío)', () => {
    const env = validateEnv({
      ...base,
      AUTH_DISABLED: 'false',
      SIM_DEBUG_VIEW: 'false',
      CLICKY_MOCK: 'false',
    });
    expect(env.AUTH_DISABLED).toBe(false);
    expect(env.SIM_DEBUG_VIEW).toBe(false);
    expect(env.CLICKY_MOCK).toBe(false);
    expect(
      validateEnv({ ...base, SIM_DEBUG_VIEW: 'true' }).SIM_DEBUG_VIEW,
    ).toBe(true);
  });

  it('AGENT_EFFORT solo acepta los esfuerzos conocidos', () => {
    expect(() => validateEnv({ ...base, AGENT_EFFORT: 'turbo' })).toThrow(
      /AGENT_EFFORT/,
    );
  });
});

describe('configWarnings', () => {
  const env = (extra: Record<string, unknown> = {}) =>
    envSchema.parse({ ...base, ...extra });

  it('avisa si en producción el estado no va a Postgres', () => {
    expect(configWarnings(env(), { RENDER: 'true' })).toEqual([
      expect.stringMatching(/DATABASE_URL/),
    ]);
    expect(
      configWarnings(env({ DATABASE_URL: 'postgres://x' }), { RENDER: 'true' }),
    ).toEqual([]);
    expect(configWarnings(env(), {})).toEqual([]);
  });

  it('avisa si el motor está a medio configurar', () => {
    const half = env({ ENGINE_URL: 'https://engine.example' });
    expect(configWarnings(half)).toEqual([
      expect.stringMatching(/ENGINE_MODAL_KEY, ENGINE_MODAL_SECRET/),
    ]);
    const full = env({
      ENGINE_URL: 'https://engine.example',
      ENGINE_MODAL_KEY: 'wk-x',
      ENGINE_MODAL_SECRET: 'ws-x',
    });
    expect(configWarnings(full)).toEqual([]);
  });
});

describe('.env.example', () => {
  // Las de Observe las lee @nestjs/observe al importar AppModule (no pasan por el schema);
  // NODE_ENV aparece en un comentario.
  const OUTSIDE_SCHEMA = new Set([
    'OBSERVE_APP_KEY',
    'OBSERVE_APP_SECRET',
    'NODE_ENV',
  ]);
  const example = readFileSync(
    new URL('../../.env.example', import.meta.url),
    'utf8',
  );
  const documented = new Set(
    [...example.matchAll(/\b([A-Z][A-Z0-9_]+)=/g)].map((m) => m[1]),
  );
  const schemaKeys = Object.keys(envSchema.shape);

  it('documenta todas las variables que valida el schema', () => {
    expect(schemaKeys.filter((k) => !documented.has(k))).toEqual([]);
  });

  it('no documenta variables que el backend no lee', () => {
    expect(
      [...documented].filter(
        (k) => !schemaKeys.includes(k) && !OUTSIDE_SCHEMA.has(k),
      ),
    ).toEqual([]);
  });
});
