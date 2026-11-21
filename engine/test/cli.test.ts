import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/run.ts');

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
