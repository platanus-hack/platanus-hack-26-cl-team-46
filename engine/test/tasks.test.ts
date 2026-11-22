import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../src/core/diagnose.ts';
import { buildScenarioPack } from '../src/core/scenario.ts';
import { buildDiagnoses } from '../src/core/diagnosis.ts';
import { tasksPlugin } from '../src/plugins/tasks/index.ts';
import { startTasksFixture } from './fixtures/tasks-fixture.ts';
import type { TargetConfig } from '../src/core/types.ts';

test('generalización: el MISMO core confirma vulns en el target Tasks (sin cambios de core)', async () => {
  const fx = await startTasksFixture();
  try {
    const target: TargetConfig = {
      url: fx.url,
      seed_users: [{ email: 'alice@x.com', password: 'alicepw', role: 'user' }],
      weak_login: { email: 'alice@x.com', password: 'alicepw' },
    };
    const diag = await diagnose(target, tasksPlugin, { seed: 'g', profile: 'noisy' });
    assert.equal(
      diag.summary.confirmed,
      3,
      diag.results.filter((r) => !r.confirmed).map((r) => `${r.vuln_id}: ${r.summary}`).join(' | '),
    );

    // Vulns solapadas con Apuntes (idor, sql-injection) + una nueva (open-redirect).
    const ids = diag.results.filter((r) => r.confirmed).map((r) => r.vuln_id).sort();
    assert.deepEqual(ids, ['idor', 'open-redirect', 'sql-injection']);

    // Escenarios con el namespace del plugin Tasks.
    const pack = buildScenarioPack(diag, tasksPlugin);
    assert.equal(pack.length, 3);
    assert.ok(pack.some((s) => s.scenario_id === 'tasks.open-redirect'));

    // Diagnóstico estructurado también generaliza.
    const diags = buildDiagnoses(diag, tasksPlugin);
    assert.ok(diags.every((d) => d.remediation.correct.length > 0));
    assert.equal(diags.filter((d) => d.verdict === 'confirmed').length, 3);
  } finally {
    await fx.close();
  }
});
