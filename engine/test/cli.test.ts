import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from './fixture.ts';

const RUN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cli/run.ts');

function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('node', [RUN, ...args], { timeout: 10000 }, (err, stdout, stderr) => {
      resolve({ code: err && typeof (err as any).code === 'number' ? (err as any).code : 0, stdout, stderr });
    });
  });
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

// RepoModel de prueba con conteos distintivos para verificar que se usa el
// modelo precomputado y NO se re-descubre.
const CACHED_MODEL = {
  schemaVersion: '1',
  root: '/fake/repo',
  commit: 'deadbeef',
  stack: [{ language: 'TypeScript', framework: 'cachedstack', db: 'postgres' }],
  routes: [
    { method: 'GET', path: '/api/cached', ref: { file: 'a.ts', line: 1, commit: 'deadbeef' }, source: 'express' },
    { method: 'POST', path: '/api/cached/:id', ref: { file: 'a.ts', line: 2, commit: 'deadbeef' }, source: 'express' },
  ],
  signals: [{ kind: 'raw-sql', detail: 'test', ref: { file: 'a.ts', line: 1, commit: 'deadbeef' } }],
  prefixes: [],
  manifests: { dockerfiles: [], ci: [], env: [] },
  notes: [],
};

test('--repo-model con archivo inexistente falla sin re-descubrir', async () => {
  const r = await cli(['--url', 'https://127.0.0.1:1', '--repo-model', '/no/existe/model.json', '--no-recon']);
  assert.notEqual(r.code, 0);
});

test('--repo-model reutiliza el RepoModel precomputado y salta discoverRepo', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'repo-model-'));
  const modelFile = path.join(dir, 'repo-model.json');
  await writeFile(modelFile, JSON.stringify(CACHED_MODEL));
  const fx = await startFixture();
  try {
    const r = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(
        'node',
        [RUN, '--url', fx.url, '--repo-model', modelFile, '--no-recon', '--only', 'idor', '--out', path.join(dir, 'out'),
          '--weak-email', 'martin.soto@example.com', '--weak-pass', 'qwerty123'],
        { timeout: 60000 },
        (err, stdout, stderr) => resolve({ code: err && typeof (err as any).code === 'number' ? (err as any).code : 0, stdout, stderr }),
      );
    });
    assert.equal(r.code, 0, r.stderr);
    // Usó el modelo cacheado (línea y conteos distintivos), no el discovery real.
    assert.match(r.stdout, /discovery \(caché\): 2 rutas, 1 señales, stack cachedstack/);
  } finally {
    await fx.close();
    await rm(dir, { recursive: true, force: true });
  }
});
