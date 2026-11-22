import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDualPath } from '../src/dual/index.ts';
import { MockProvider } from '../src/providers/mock.ts';
import { startFixture } from './fixture.ts';
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
    for (const cls of ['admin-endpoint-no-authz', 'idor', 'sql-injection', 'weak-password-no-rate-limit']) {
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
  } finally {
    await fx.close();
  }
});
