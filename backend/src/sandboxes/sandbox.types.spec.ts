import { describe, expect, it } from 'vitest';
import { repoShortName, sandboxDisplayName } from './sandbox.types.js';

describe('nombre del sandbox', () => {
  it('por defecto es owner/repo', () => {
    expect(repoShortName('https://github.com/hack26-sandboxes/apuntes')).toBe(
      'hack26-sandboxes/apuntes',
    );
    expect(repoShortName('https://github.com/rmena1/hund.git')).toBe(
      'rmena1/hund',
    );
    expect(
      sandboxDisplayName({ repo_url: 'https://github.com/rmena1/hund/' }),
    ).toBe('rmena1/hund');
  });

  it('usa el nombre custom si existe', () => {
    expect(
      sandboxDisplayName({
        name: '  Demo jueces ',
        repo_url: 'https://github.com/a/b',
      }),
    ).toBe('Demo jueces');
    expect(
      sandboxDisplayName({ name: '   ', repo_url: 'https://github.com/a/b' }),
    ).toBe('a/b');
  });
});
