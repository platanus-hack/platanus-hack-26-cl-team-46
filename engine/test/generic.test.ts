import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose } from '../src/core/diagnose.ts';
import { buildAttackPlan, toTimelineEvents } from '../src/core/events.ts';
import { discoverRepo } from '../src/discovery/index.ts';
import { buildGenericPlugin, readRepoSecrets } from '../src/plugins/generic/index.ts';
import type { TargetConfig } from '../src/core/types.ts';
import { startGenericFixture } from './fixtures/generic-fixture.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const nestRepo = path.join(here, 'fixtures/repo-nest');
const ALL = [
  'admin-endpoint-no-authz', 'cors-misconfiguration', 'dos', 'exposed-sensitive-files', 'idor', 'jwt-forgery', 'mass-assignment',
  'sql-injection', 'unauthenticated-data-access', 'user-enumeration', 'verbose-errors', 'weak-password-no-rate-limit',
];

function target(url: string): TargetConfig {
  return { url, seed_users: [{ email: 'ana', password: 'qwerty123', role: 'user' }], weak_login: { email: 'ana', password: 'qwerty123' } };
}

async function plugin() {
  const repo = await discoverRepo(nestRepo, { commit: 'c0ffee' });
  return { repo, plugin: buildGenericPlugin({ repo, repoSecrets: await readRepoSecrets(nestRepo) }) };
}

test('discovery NestJS: rutas con @Controller/@Get, guards y prefijo global', async () => {
  const repo = await discoverRepo(nestRepo, { commit: 'c0ffee' });
  const order = repo.routes.find((r) => r.source === 'nest' && r.path === '/orders/:id');
  assert.ok(order, 'falta GET /orders/:id');
  assert.equal(order!.auth, 'user'); // @UseGuards de la clase
  assert.match(order!.ref.file, /orders\.controller\.ts$/);
  assert.equal(repo.routes.find((r) => r.path === '/customers')?.auth, undefined);
  assert.ok(repo.routes.some((r) => r.method === 'POST' && r.path === '/auth/signin'));
  assert.ok(repo.prefixes?.includes('/api/v1'));
  assert.ok((await readRepoSecrets(nestRepo)).includes('changeme'));
});

test('genérico: confirma las 12 vulnerabilidades en una app desconocida, con archivo y línea', async () => {
  const fx = await startGenericFixture();
  try {
    const { plugin: p } = await plugin();
    const diag = await diagnose(target(fx.url), p, { seed: 'g', profile: 'noisy' });
    const confirmed = diag.results.filter((r) => r.confirmed).map((r) => r.vuln_id).sort();
    assert.deepEqual(confirmed, ALL, diag.results.filter((r) => !r.confirmed).map((r) => `${r.vuln_id}: ${r.summary}`).join(' | '));

    // Evidencia concreta, no solo un status.
    const by = (id: string) => diag.results.find((r) => r.vuln_id === id)!;
    assert.equal(by('idor').foothold?.type, 'data');
    assert.equal(by('mass-assignment').foothold?.type, 'admin');
    assert.match(by('jwt-forgery').summary, /filtrado/); // el secreto salió del /.env expuesto
    assert.equal(by('weak-password-no-rate-limit').foothold?.type, 'account');
    // El .env se reporta sin valores.
    assert.doesNotMatch(JSON.stringify(by('exposed-sensitive-files').steps), /changeme/);

    // Archivo/línea del código donde vive cada una.
    assert.match(p.refFor!('idor')!.file, /orders\.controller\.ts$/);
    assert.match(p.refFor!('sql-injection')!.file, /products\.controller\.ts$/);
    assert.match(p.refFor!('admin-endpoint-no-authz')!.file, /admin\.controller\.ts$/);

    // Contrato del backend: plan y replay.
    const plan = buildAttackPlan(diag, p);
    assert.equal((plan.raw.findings as unknown[]).filter((f: any) => f.confirmed).length, ALL.length);
    const replay = toTimelineEvents(by('idor'), p);
    assert.deepEqual(replay.map((e) => e.type).slice(-2), ['attack.success', 'attack.done']);
  } finally {
    await fx.close();
  }
});

test('genérico: la misma app bien hecha no da falsos positivos', async () => {
  const fx = await startGenericFixture({ hardened: true });
  try {
    const { plugin: p } = await plugin();
    const diag = await diagnose(target(fx.url), p, { seed: 'h', profile: 'noisy' });
    const confirmed = diag.results.filter((r) => r.confirmed);
    assert.deepEqual(confirmed.map((r) => `${r.vuln_id}: ${r.summary}`), []);
    assert.ok(diag.results.find((r) => r.vuln_id === 'weak-password-no-rate-limit')!.blocked);
  } finally {
    await fx.close();
  }
});

test('genérico sin repo: usa el OpenAPI publicado por la app y lo que se ve desde afuera', async () => {
  const fx = await startGenericFixture();
  try {
    const p = buildGenericPlugin();
    const diag = await diagnose(target(fx.url), p, { seed: 's', profile: 'noisy' });
    const ok = new Set(diag.results.filter((r) => r.confirmed).map((r) => r.vuln_id));
    for (const id of ['exposed-sensitive-files', 'unauthenticated-data-access', 'idor', 'sql-injection', 'jwt-forgery', 'cors-misconfiguration']) {
      assert.ok(ok.has(id), `${id} no confirmada sin repo: ${diag.results.find((r) => r.vuln_id === id)?.summary}`);
    }
  } finally {
    await fx.close();
  }
});
