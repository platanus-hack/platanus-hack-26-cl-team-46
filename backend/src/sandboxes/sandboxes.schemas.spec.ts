import { createSandboxSchema, setEnvSchema } from './sandboxes.schemas.js';

describe('schemas', () => {
  it('normaliza repo_url (sin .git ni slash final)', () => {
    const r = createSandboxSchema.parse({
      repo_url: 'https://github.com/a/b.git/',
    });
    expect(r.repo_url).toBe('https://github.com/a/b');
  });

  it('por defecto despliega con el agente', () => {
    const r = createSandboxSchema.parse({ repo_url: 'https://github.com/a/b' });
    expect(r.mode).toBe('agent');
  });

  it('rechaza repo_url que no es https', () => {
    expect(
      createSandboxSchema.safeParse({ repo_url: 'git@github.com:a/b.git' })
        .success,
    ).toBe(false);
  });

  it('solo acepta repos de GitHub con la forma exacta', () => {
    for (const bad of [
      'https://gitlab.com/a/b',
      'https://github.com/hack26-sandboxes/%73bx-1a2b3c4d',
      'https://github.com/a/b/tree/main',
      'https://github.com/a/b?x=1',
      'https://github.com/a',
    ])
      expect(
        createSandboxSchema.safeParse({ repo_url: bad }).success,
        bad,
      ).toBe(false);
  });

  it('guarda la URL en forma canónica', () => {
    expect(
      createSandboxSchema.parse({ repo_url: 'HTTPS://GitHub.com/A/b.git' })
        .repo_url,
    ).toBe('https://github.com/A/b');
  });

  it('setEnv exige al menos un cambio', () => {
    expect(setEnvSchema.safeParse({}).success).toBe(false);
    expect(setEnvSchema.safeParse({ generate: ['JWT_SECRET'] }).success).toBe(
      true,
    );
    expect(setEnvSchema.safeParse({ env: { 'BAD-KEY': 'x' } }).success).toBe(
      false,
    );
  });
});
