/**
 * Modo agresivo, siempre: el motor corre los módulos que generan daño (DoS,
 * SSRF→secrets, prompt injection, phishing) sin ningún flag. Las rutas salen del
 * repo, no de un manual por app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose } from '../src/core/diagnose.ts';
import { analyzeCicd } from '../src/plugins/generic/cicd.ts';
import { buildGenericPlugin } from '../src/plugins/generic/index.ts';
import { startDestructiveFixture } from './fixtures/destructive-fixture.ts';
import { startTasksFixture } from './fixtures/tasks-fixture.ts';
import { repoModel } from './repo-model.ts';

test('siempre agresivo: confirma DoS, SSRF→secrets, prompt-injection y phishing sin ningún flag', async () => {
  const fx = await startDestructiveFixture();
  try {
    const repo = repoModel([['GET', '/slow'], ['GET', '/fetch'], ['POST', '/chat'], ['GET', '/go'], ['GET', '/health']]);
    const diag = await diagnose({ url: fx.url, seed_users: [] }, buildGenericPlugin({ repo }), { seed: 'd', profile: 'noisy' });
    const confirmed = diag.results.filter((r) => r.confirmed).map((r) => r.vuln_id);
    for (const id of ['dos', 'ssrf-secrets', 'prompt-injection', 'phishing']) {
      assert.ok(confirmed.includes(id), `${id} no se confirmó (${confirmed.join(',')})`);
    }
  } finally {
    await fx.close();
  }
});

test('otra app (tareas): el mismo motor confirma SQLi, IDOR y el open-redirect', async () => {
  const fx = await startTasksFixture();
  try {
    const repo = repoModel([['POST', '/register'], ['POST', '/login'], ['GET', '/me'], ['GET', '/tasks'], ['GET', '/tasks/:id'], ['GET', '/go']]);
    const login = { email: 'alice@x.com', password: 'alicepw' };
    const diag = await diagnose({ url: fx.url, seed_users: [{ ...login, role: 'user' }], weak_login: login }, buildGenericPlugin({ repo }), { seed: 'g', profile: 'noisy' });
    const confirmed = diag.results.filter((r) => r.confirmed).map((r) => r.vuln_id);
    for (const id of ['sql-injection', 'idor', 'phishing']) {
      assert.ok(confirmed.includes(id), `${id} no se confirmó: ${diag.results.find((r) => r.vuln_id === id)?.summary}`);
    }
  } finally {
    await fx.close();
  }
});

test('cicd: detecta pipeline envenenable (permisos, pr-target, inyección, secret)', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const findings = await analyzeCicd(path.join(here, 'fixtures/repo-cicd'), 'abc');
  const kinds = new Set(findings.map((f) => f.kind));
  for (const k of ['excessive-permissions', 'pr-target', 'expression-injection', 'secret-exposure'] as const) assert.ok(kinds.has(k), k);
  assert.ok(findings.every((f) => /deploy\.yml$/.test(f.ref.file) && f.ref.line > 0));
});
