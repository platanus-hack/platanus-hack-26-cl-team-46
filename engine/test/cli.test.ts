import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from './fixture.ts';
import type { RepoModel } from '../src/discovery/types.ts';

const RUN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cli/run.ts');

function cli(args: string[], timeout = 10000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('node', [RUN, ...args], { timeout }, (err, stdout, stderr) => {
      resolve({ code: err && typeof (err as any).code === 'number' ? (err as any).code : 0, stdout, stderr });
    });
  });
}

/** RepoModel de "Apuntes" (igual al de dual.test.ts) para probar --repo-model. */
function apuntesRepoModel(): RepoModel {
  const c = 't';
  return {
    schemaVersion: '1', root: '.', commit: c,
    stack: [{ language: 'TypeScript', framework: 'express', db: 'postgres' }],
    routes: [
      { method: 'POST', path: '/api/auth/login', ref: { file: 'src/routes/auth.ts', line: 41, commit: c }, source: 'express' },
      { method: 'GET', path: '/api/notes/:id', params: ['id'], auth: 'user', ref: { file: 'src/routes/notes.ts', line: 23, commit: c }, source: 'express' },
    ],
    signals: [
      { kind: 'raw-sql', detail: 'concat', ref: { file: 'src/models/notes.ts', line: 15, commit: c } },
    ],
    manifests: { dockerfiles: [], ci: [], env: [] },
    notes: [],
  };
}

test('--help sale 0 e imprime uso, sin disparar ataques', async () => {
  const r = await cli(['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Uso:/);
  assert.doesNotMatch(r.stdout + r.stderr, /Motor de hacking →/); // no inició una corrida
});

test('sin --url sale con código de error', async () => {
  const r = await cli([]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /Falta --url/);
});

test('--url inválida sale con código de error', async () => {
  const r = await cli(['--url', 'no-es-una-url']);
  assert.equal(r.code, 2);
});

test('--repo-model inexistente falla con un error claro (sin atacar)', async () => {
  const r = await cli(['--url', 'http://127.0.0.1:1/', '--repo-model', '/no/existe/model.json']);
  assert.notEqual(r.code, 0);
  assert.match(r.stdout + r.stderr, /--repo-model/);
});

test('--repo-model reusa el discovery (sin re-escanear) y ataca solo --only', async () => {
  const fx = await startFixture();
  const dir = await mkdtemp(path.join(tmpdir(), 'engine-cli-'));
  const modelPath = path.join(dir, 'repo-model.json');
  await writeFile(modelPath, JSON.stringify(apuntesRepoModel()));
  try {
    const r = await cli(
      [
        '--url', fx.url,
        '--repo-model', modelPath,
        '--only', 'idor',
        '--no-recon',
        '--weak-email', 'martin.soto@example.com',
        '--weak-pass', 'qwerty123',
        '--seed', 't',
        '--out', path.join(dir, 'out'),
      ],
      30000,
    );
    // Reusó el modelo en vez de correr el discovery estático.
    assert.match(r.stdout, /RepoModel reusado/);
    assert.match(r.stdout, /sin re-escanear/);
    // Igual atacó de verdad y cerró la corrida.
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /vulnerabilidades confirmadas/);
  } finally {
    await fx.close();
  }
});
