import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDualPath, runGenericSuite } from '../src/dual/index.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { startFixture } from './fixture.ts';
import { startDestructiveFixture } from './fixtures/destructive-fixture.ts';
import type { RepoModel } from '../src/discovery/types.ts';
import type { TargetConfig } from '../src/core/types.ts';

function apuntesRepoModel(): RepoModel {
  const c = 't';
  return {
    schemaVersion: '1', root: '.', commit: c,
    stack: [{ language: 'TypeScript', framework: 'express', db: 'postgres' }],
    routes: [
      { method: 'POST', path: '/api/auth/login', ref: { file: 'src/routes/auth.ts', line: 41, commit: c }, source: 'express' },
      { method: 'GET', path: '/api/notes/:id', params: ['id'], auth: 'user', ref: { file: 'src/routes/notes.ts', line: 23, commit: c }, source: 'express' },
      { method: 'GET', path: '/api/notes', params: [], auth: 'user', ref: { file: 'src/routes/notes.ts', line: 9, commit: c }, source: 'express' },
      { method: 'GET', path: '/api/admin/users/export', params: [], auth: 'user', ref: { file: 'src/routes/admin.ts', line: 33, commit: c }, source: 'express' },
      { method: 'PATCH', path: '/api/users/me', auth: 'user', ref: { file: 'src/routes/users.ts', line: 20, commit: c }, source: 'express' },
    ],
    signals: [
      { kind: 'raw-sql', detail: 'concat', ref: { file: 'src/models/notes.ts', line: 15, commit: c } },
      { kind: 'unescaped-render', detail: 'ejs', ref: { file: 'views/note.ejs', line: 6, commit: c } },
      { kind: 'missing-authz', detail: 'export', ref: { file: 'src/routes/admin.ts', line: 33, commit: c } },
    ],
    manifests: { dockerfiles: [], ci: [], env: [] },
    notes: [],
  };
}

test('dual A+B: A confirma genéricamente, B propone, y la cobertura compara y completa', async () => {
  const fx = await startFixture();
  try {
    const target: TargetConfig = {
      url: fx.url,
      seed_users: [{ email: 'martin.soto@example.com', password: 'qwerty123', role: 'user' }],
      weak_login: { email: 'martin.soto@example.com', password: 'qwerty123' },
    };
    const dual = await runDualPath(target, apuntesRepoModel(), { provider: new MockProvider(), seed: 'd' });

    // A (genérico) confirmó con tráfico real, derivado SOLO del RepoModel.
    const confirmed = dual.generic.filter((g) => g.confirmed).map((g) => g.vuln_class).sort();
    for (const cls of ['admin-endpoint-no-authz', 'idor', 'mass-assignment', 'sql-injection', 'weak-password-no-rate-limit']) {
      assert.ok(confirmed.includes(cls), `A no confirmó ${cls} (confirmó: ${confirmed.join(',')})`);
    }
    // A trae archivo:línea (de la correlación con el RepoModel).
    const idor = dual.generic.find((g) => g.vuln_class === 'idor' && g.confirmed)!;
    assert.match(idor.where ?? '', /notes\.ts:23/);

    // B (mock) propuso desde las señales.
    assert.ok(dual.llm.some((a) => a.vuln_id === 'sql-injection'));

    // Cobertura: comparación (acuerdo) + completitud (solo-A / solo-B).
    const entry = (cls: string) => dual.coverage.entries.find((e) => e.vuln_class === cls)!;
    assert.equal(entry('sql-injection').status, 'both'); // A confirmó + B propuso
    assert.equal(entry('admin-endpoint-no-authz').status, 'both');
    assert.equal(entry('idor').status, 'generic-only'); // A lo pescó, B(mock) no
    assert.equal(entry('weak-password-no-rate-limit').status, 'generic-only');
    assert.equal(entry('stored-xss').status, 'llm-only'); // B lo propuso, A no lo cubre

    assert.ok(dual.coverage.metrics.agreement >= 2);
    assert.ok(dual.coverage.metrics.generic_only >= 1);
    assert.ok(dual.coverage.metrics.llm_only >= 1);

    // B generó un probe EJECUTABLE gateado que confirmó SQLi → máxima confianza.
    assert.ok(dual.generated.some((g) => g.gated && g.confirmed && g.spec.vuln_class === 'sql-injection'), 'B no confirmó SQLi con un probe generado');
    assert.equal(entry('sql-injection').llm_confirmed, true);
  } finally {
    await fx.close();
  }
});

function repoModel(routes: RepoModel['routes']): RepoModel {
  return { schemaVersion: '1', root: '.', commit: 't', stack: [], routes, signals: [], manifests: { dockerfiles: [], ci: [], env: [] }, notes: [] };
}

test('A genérico: SSRF y reflected-XSS derivados del RepoModel (otra app)', async () => {
  const fx = await startDestructiveFixture();
  try {
    const target: TargetConfig = { url: fx.url, seed_users: [] };
    const repo = repoModel([
      { method: 'GET', path: '/fetch', ref: { file: 'app.js', line: 10, commit: 't' }, source: 'express' },
      { method: 'GET', path: '/echo', ref: { file: 'app.js', line: 20, commit: 't' }, source: 'express' },
    ]);
    const found = await runGenericSuite(target, repo, { seed: 's' });
    const confirmed = found.filter((g) => g.confirmed).map((g) => g.vuln_class);
    assert.ok(confirmed.includes('ssrf-secrets'), `no SSRF (${confirmed.join(',')})`);
    assert.ok(confirmed.includes('reflected-xss'), `no reflected-xss (${confirmed.join(',')})`);
  } finally {
    await fx.close();
  }
});

test('B: probes generados — el gate rechaza fuera de scope y ejecuta los válidos', async () => {
  const fx = await startDestructiveFixture();
  try {
    const target: TargetConfig = { url: fx.url, seed_users: [] };
    const scope = [new URL(fx.url).origin];
    const { gateProbe, runGeneratedProbes } = await import('../src/dual/probe-spec.ts');

    // Gate: un probe con URL fuera de scope se rechaza (no se ejecuta).
    const offscope = { id: 'x', vuln_class: 'ssrf', method: 'GET' as const, path: '/fetch', query: { url: 'http://evil.example/' }, success: { body_matches: 'secret' } };
    assert.equal(gateProbe(offscope, scope).ok, false);
    assert.equal(gateProbe(offscope, scope).checks.find((c) => c.name === 'scope')!.pass, false);

    // Ejecuta: un probe reflected-xss válido contra /echo → confirmado; el off-scope no se ejecuta.
    const results = await runGeneratedProbes(target, [
      { id: 'gen-xss', vuln_class: 'reflected-xss', method: 'GET', path: '/echo', query: { q: '<svg/onload=1>zz' }, success: { reflects_query: 'q' } },
      offscope,
    ], { seed: 'g' });

    const xss = results.find((r) => r.spec.id === 'gen-xss')!;
    assert.ok(xss.gated && xss.executed && xss.confirmed, 'el probe XSS válido debería confirmarse');
    const rej = results.find((r) => r.spec.id === 'x')!;
    assert.ok(!rej.gated && !rej.executed, 'el probe fuera de scope NO debe ejecutarse');
  } finally {
    await fx.close();
  }
});
