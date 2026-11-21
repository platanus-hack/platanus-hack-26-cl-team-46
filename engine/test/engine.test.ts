import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../src/core/diagnose.ts';
import { buildScenarioPack } from '../src/core/scenario.ts';
import { startFixture } from './fixture.ts';
import type { TargetConfig } from '../src/core/types.ts';
import { apuntesPlugin } from '../src/plugins/apuntes/index.ts';

function targetFor(url: string): TargetConfig {
  return {
    url,
    seed_users: [{ email: 'martin.soto@example.com', password: 'qwerty123', role: 'user' }],
    weak_login: { email: 'martin.soto@example.com', password: 'qwerty123' },
  };
}

test('diagnóstico completo contra el fixture confirma las 8 vulns', async () => {
  const fx = await startFixture();
  try {
    const diag = await diagnose(targetFor(fx.url), apuntesPlugin, { seed: 't1', profile: 'noisy' });
    assert.equal(diag.summary.total, 8);
    assert.equal(diag.summary.confirmed, 8, diag.results.filter((r) => !r.confirmed).map((r) => `${r.vuln_id}: ${r.summary}`).join(' | '));
    const pack = buildScenarioPack(diag, apuntesPlugin);
    assert.equal(pack.length, 8);
  } finally {
    await fx.close();
  }
});

test('teardown limpia la nota del XSS y revierte el rol escalado; residuo = cuentas', async () => {
  const fx = await startFixture();
  try {
    const before = fx.notes.length;
    const diag = await diagnose(targetFor(fx.url), apuntesPlugin, { seed: 't2', profile: 'noisy' });
    // La nota del XSS fue creada y luego borrada por el teardown.
    assert.equal(fx.notes.length, before, 'quedó una nota sin borrar');
    assert.ok(!fx.notes.some((n) => /onerror|xss-/.test(n.body)), 'quedó la nota XSS');
    // El rol escalado se revirtió a user.
    const escalated = fx.users.filter((u) => u.email.startsWith('rt-'));
    assert.ok(escalated.every((u) => u.role === 'user'), 'una cuenta quedó como admin');
    // Residuo: las cuentas desechables (la app no deja borrarlas).
    assert.ok(diag.residue.length >= 1);
    assert.ok(diag.residue.every((r) => /cuenta desechable/.test(r)));
  } finally {
    await fx.close();
  }
});

test('modo read-only no crea estado y corre solo módulos no mutantes', async () => {
  const fx = await startFixture();
  try {
    const usersBefore = fx.users.length;
    const notesBefore = fx.notes.length;
    const diag = await diagnose(targetFor(fx.url), apuntesPlugin, { seed: 't3', profile: 'noisy', readOnly: true });
    assert.equal(fx.users.length, usersBefore, 'read-only creó usuarios');
    assert.equal(fx.notes.length, notesBefore, 'read-only creó notas');
    assert.equal(diag.residue.length, 0);
    // Solo los no mutantes: weak-password, idor, admin-export, verbose-errors, sql-injection.
    assert.equal(diag.results.length, 5);
    assert.ok(diag.results.every((r) => r.confirmed));
  } finally {
    await fx.close();
  }
});

test('determinismo: misma seed → mismos vuln_id/confirmado y mismas versiones de escenario', async () => {
  const a = await startFixture();
  const b = await startFixture();
  try {
    const da = await diagnose(targetFor(a.url), apuntesPlugin, { seed: 'same', profile: 'noisy' });
    const db = await diagnose(targetFor(b.url), apuntesPlugin, { seed: 'same', profile: 'noisy' });
    const keyA = da.results.map((r) => `${r.vuln_id}:${r.confirmed}`).sort();
    const keyB = db.results.map((r) => `${r.vuln_id}:${r.confirmed}`).sort();
    assert.deepEqual(keyA, keyB);
    const vA = buildScenarioPack(da, apuntesPlugin).map((s) => s.version).sort();
    const vB = buildScenarioPack(db, apuntesPlugin).map((s) => s.version).sort();
    assert.deepEqual(vA, vB);
    // Las cuentas desechables generadas son idénticas (RNG seeded).
    assert.deepEqual(
      a.users.filter((u) => u.email.startsWith('rt-')).map((u) => u.email).sort(),
      b.users.filter((u) => u.email.startsWith('rt-')).map((u) => u.email).sort(),
    );
  } finally {
    await a.close();
    await b.close();
  }
});
