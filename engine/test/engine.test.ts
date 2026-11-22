/**
 * Un solo motor (genérico) contra una app de notas con 8 debilidades plantadas.
 * No hay manual por app: la superficie sale de las rutas del repo y de la app en vivo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../src/core/diagnose.ts';
import { buildScenarioPack } from '../src/core/scenario.ts';
import { buildGenericPlugin } from '../src/plugins/generic/index.ts';
import type { TargetConfig } from '../src/core/types.ts';
import { startFixture } from './fixture.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverRepo } from '../src/discovery/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
// Las rutas salen del discovery del repo, igual que en producción.
const NOTES_APP = await discoverRepo(path.join(here, 'fixtures/repo-notes'), { commit: 't' });
const PLANTED = [
  'admin-endpoint-no-authz', 'idor', 'jwt-not-invalidated-on-password-change', 'mass-assignment',
  'sql-injection', 'stored-xss', 'verbose-errors', 'weak-password-no-rate-limit',
];

function targetFor(url: string): TargetConfig {
  return {
    url,
    seed_users: [{ email: 'martin.soto@example.com', password: 'qwerty123', role: 'user' }],
    weak_login: { email: 'martin.soto@example.com', password: 'qwerty123' },
  };
}

test('motor único: confirma las 8 debilidades plantadas (y el DoS, siempre agresivo)', async () => {
  const fx = await startFixture();
  try {
    const plugin = buildGenericPlugin({ repo: NOTES_APP });
    const diag = await diagnose(targetFor(fx.url), plugin, { seed: 't1', profile: 'noisy' });
    const confirmed = diag.results.filter((r) => r.confirmed).map((r) => r.vuln_id);
    const missing = PLANTED.filter((id) => !confirmed.includes(id));
    assert.deepEqual(missing, [], diag.results.filter((r) => !r.confirmed).map((r) => `${r.vuln_id}: ${r.summary}`).join(' | '));
    assert.ok(confirmed.includes('dos'), 'el modo agresivo no corrió el DoS');
    // Corren TODOS los módulos del catálogo: no hay filtro por app ni por modo.
    assert.equal(diag.results.length, plugin.attacks.length);
    assert.equal(buildScenarioPack(diag, plugin).length, diag.summary.confirmed);
  } finally {
    await fx.close();
  }
});

test('teardown: borra el contenido con el payload XSS; el residuo son cuentas desechables', async () => {
  const fx = await startFixture();
  try {
    const before = fx.notes.length;
    const diag = await diagnose(targetFor(fx.url), buildGenericPlugin({ repo: NOTES_APP }), { seed: 't2', profile: 'noisy' });
    assert.equal(fx.notes.length, before, 'quedó una nota sin borrar');
    assert.ok(!fx.notes.some((n) => /onerror/.test(n.body)), 'quedó la nota XSS');
    assert.ok(diag.residue.length >= 1);
    assert.ok(diag.residue.every((r) => /cuenta desechable/.test(r)), diag.residue.join(' | '));
  } finally {
    await fx.close();
  }
});

test('determinismo: misma seed → mismos vuln_id/confirmado y mismas versiones de escenario', async () => {
  const a = await startFixture();
  const b = await startFixture();
  try {
    const pa = buildGenericPlugin({ repo: NOTES_APP });
    const pb = buildGenericPlugin({ repo: NOTES_APP });
    const da = await diagnose(targetFor(a.url), pa, { seed: 'same', profile: 'noisy' });
    const db = await diagnose(targetFor(b.url), pb, { seed: 'same', profile: 'noisy' });
    const key = (d: typeof da) => d.results.map((r) => `${r.vuln_id}:${r.confirmed}`).sort();
    assert.deepEqual(key(da), key(db));
    assert.deepEqual(buildScenarioPack(da, pa).map((s) => s.version).sort(), buildScenarioPack(db, pb).map((s) => s.version).sort());
    assert.deepEqual(
      a.users.filter((u) => u.email.startsWith('rt-')).map((u) => u.email).sort(),
      b.users.filter((u) => u.email.startsWith('rt-')).map((u) => u.email).sort(),
    );
  } finally {
    await a.close();
    await b.close();
  }
});
