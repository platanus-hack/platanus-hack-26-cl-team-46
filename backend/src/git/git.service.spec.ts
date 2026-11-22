import { BadRequestException } from '@nestjs/common';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  classifySourceRepo,
  isRepoAlreadyExists,
  stripWorkflows,
  writeRepoFiles,
} from './git.service.js';
import { canonicalGitHubUrl, parseGitHubRepoUrl } from './github-url.js';

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

  it('no sigue un .github que es symlink hacia afuera del repo', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'wf-out-'));
    try {
      await mkdir(path.join(outside, 'workflows'));
      await writeFile(path.join(outside, 'workflows', 'keep.yml'), 'x');
      await symlink(outside, path.join(dir, '.github'));
      expect(await stripWorkflows(dir)).toBe(false);
      expect(existsSync(path.join(outside, 'workflows', 'keep.yml'))).toBe(
        true,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('writeRepoFiles (rutas dentro del repo)', () => {
  let repo: string;
  let outside: string;
  beforeEach(async () => {
    repo = await mkdtemp(path.join(tmpdir(), 'repo-'));
    outside = await mkdtemp(path.join(tmpdir(), 'outside-'));
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('escribe y borra archivos normales, creando carpetas', async () => {
    await writeRepoFiles(repo, [{ path: 'a/b/c.txt', content: 'hola' }]);
    expect(await readFile(path.join(repo, 'a/b/c.txt'), 'utf8')).toBe('hola');
    await writeRepoFiles(repo, [{ path: 'a/b/c.txt', content: null }]);
    expect(existsSync(path.join(repo, 'a/b/c.txt'))).toBe(false);
  });

  it('rechaza rutas que salen del repo', async () => {
    await expect(
      writeRepoFiles(repo, [{ path: '../fuera.txt', content: 'x' }]),
    ).rejects.toThrow(/fuera del repo/);
  });

  it('no escribe a través de un symlink que apunta fuera del repo', async () => {
    // Lo que dejaría un parche con `link -> /otra/carpeta`.
    await symlink(outside, path.join(repo, 'link'));
    await expect(
      writeRepoFiles(repo, [{ path: 'link/pwned.txt', content: 'x' }]),
    ).rejects.toThrow(/enlace simbólico/);
    expect(existsSync(path.join(outside, 'pwned.txt'))).toBe(false);
    // Tampoco carpetas nuevas bajo el symlink.
    await expect(
      writeRepoFiles(repo, [{ path: 'link/sub/x.txt', content: 'x' }]),
    ).rejects.toThrow(/enlace simbólico/);
    expect(existsSync(path.join(outside, 'sub'))).toBe(false);
  });

  it('no borra a través de un symlink, pero sí puede borrar el symlink mismo', async () => {
    await writeFile(path.join(outside, 'importante.txt'), 'no tocar');
    await symlink(outside, path.join(repo, 'link'));
    await expect(
      writeRepoFiles(repo, [{ path: 'link/importante.txt', content: null }]),
    ).rejects.toThrow(/enlace simbólico/);
    expect(existsSync(path.join(outside, 'importante.txt'))).toBe(true);

    await writeRepoFiles(repo, [{ path: 'link', content: null }]);
    expect(existsSync(path.join(repo, 'link'))).toBe(false);
    expect(existsSync(path.join(outside, 'importante.txt'))).toBe(true);
  });

  it('no escribe sobre un archivo que es symlink', async () => {
    const target = path.join(outside, 'target.txt');
    await writeFile(target, 'original');
    await symlink(target, path.join(repo, 'file.txt'));
    await expect(
      writeRepoFiles(repo, [{ path: 'file.txt', content: 'pisado' }]),
    ).rejects.toThrow(/enlace simbólico/);
    expect(await readFile(target, 'utf8')).toBe('original');
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

  it('trata repos de otros dueños como externos', () => {
    expect(classifySourceRepo('https://github.com/rmena1/wallit', org)).toBe(
      'external',
    );
  });

  it('rechaza (400) lo que no es https://github.com/dueño/repo exacto', () => {
    for (const bad of [
      // %73 = "s": git lo decodifica y clonaría el mirror con el token de la org.
      `https://github.com/${org}/%73bx-1a2b3c4d`,
      `https://github.com/%68ack26-sandboxes/sbx-1a2b3c4d`,
      `https://github.com/${org}/x/../sbx-1a2b3c4d`,
      `https://github.com/${org}/sbx-1a2b3c4d/tree/main`,
      `https://github.com/${org}/apuntes?x=1`,
      `https://github.com/${org}/apuntes#frag`,
      `https://user@github.com/${org}/apuntes`,
      `https://github.com:443/${org}/apuntes`,
      `http://github.com/${org}/apuntes`,
      `https://gitlab.com/${org}/sbx-1a2b3c4d`,
      `https://github.com.evil.com/${org}/apuntes`,
      'https://github.com/a/..',
      'no es una url',
    ]) {
      expect(() => classifySourceRepo(bad, org), bad).toThrow(
        BadRequestException,
      );
    }
  });
});

describe('parseGitHubRepoUrl', () => {
  it('acepta .git y / final y devuelve dueño y repo', () => {
    expect(parseGitHubRepoUrl('https://github.com/a-b/c.d_e.git/')).toEqual({
      owner: 'a-b',
      repo: 'c.d_e',
    });
    expect(parseGitHubRepoUrl('HTTPS://GitHub.com/a/b')).toEqual({
      owner: 'a',
      repo: 'b',
    });
  });

  it('canonicalGitHubUrl normaliza o responde 400', () => {
    expect(canonicalGitHubUrl('https://GITHUB.com/a/b.git')).toBe(
      'https://github.com/a/b',
    );
    expect(() => canonicalGitHubUrl('https://github.com/a/%62')).toThrow(
      BadRequestException,
    );
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
