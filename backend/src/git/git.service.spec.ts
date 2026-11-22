import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  classifySourceRepo,
  isRepoAlreadyExists,
  stripWorkflows,
} from './git.service.js';

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

describe('classifySourceRepo', () => {
  const org = 'hack26-sandboxes';

  it('reconoce los mirrors de sandboxes (sin importar mayúsculas)', () => {
    expect(
      classifySourceRepo(`https://github.com/${org}/sbx-1a2b3c4d`, org),
    ).toBe('mirror');
    expect(
      classifySourceRepo(
        'https://github.com/Hack26-Sandboxes/SBX-1A2B3C4D.git',
        org,
      ),
    ).toBe('mirror');
  });

  it('trata los demás repos de la org como propios', () => {
    expect(classifySourceRepo(`https://github.com/${org}/apuntes`, org)).toBe(
      'org',
    );
    expect(classifySourceRepo(`https://github.com/${org}/sbx-demo`, org)).toBe(
      'org',
    );
  });

  it('trata repos de otros dueños o de otros hosts como externos', () => {
    expect(classifySourceRepo('https://github.com/rmena1/wallit', org)).toBe(
      'external',
    );
    expect(
      classifySourceRepo(`https://gitlab.com/${org}/sbx-1a2b3c4d`, org),
    ).toBe('external');
    expect(classifySourceRepo('no es una url', org)).toBe('external');
  });
});

describe('isRepoAlreadyExists', () => {
  it('reconoce el 422 de repo repetido', () => {
    const err = new Error(
      'GitHub POST /orgs/x/repos → 422: {"message":"Repository creation failed.","errors":[{"message":"name already exists on this account"}]}',
    );
    expect(isRepoAlreadyExists(err)).toBe(true);
  });

  it('no confunde otros errores', () => {
    expect(
      isRepoAlreadyExists(
        new Error('GitHub POST /orgs/x/repos → 403: forbidden'),
      ),
    ).toBe(false);
    expect(
      isRepoAlreadyExists(
        new Error('GitHub POST /orgs/x/repos → 422: invalid name'),
      ),
    ).toBe(false);
  });
});
