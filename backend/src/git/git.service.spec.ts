import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stripWorkflows } from './git.service.js';

describe('stripWorkflows', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'wf-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('borra .github/workflows y deja el resto de .github', async () => {
    await mkdir(path.join(dir, '.github', 'workflows'), { recursive: true });
    await writeFile(
      path.join(dir, '.github', 'workflows', 'ci.yml'),
      'on: push',
    );
    await writeFile(path.join(dir, '.github', 'CODEOWNERS'), '* @x');
    expect(await stripWorkflows(dir)).toBe(true);
    expect(existsSync(path.join(dir, '.github', 'workflows'))).toBe(false);
    expect(existsSync(path.join(dir, '.github', 'CODEOWNERS'))).toBe(true);
  });

  it('no hace nada si no hay workflows', async () => {
    expect(await stripWorkflows(dir)).toBe(false);
  });
});
