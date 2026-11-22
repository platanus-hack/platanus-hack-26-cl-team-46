import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runVariants, type AttackVariant } from '../src/core/variants.ts';
import { buildDiagnoses } from '../src/core/diagnosis.ts';
import { buildGenericPlugin } from '../src/plugins/generic/index.ts';
import type { AttackResult } from '../src/core/types.ts';

const ctx = { log: () => {} } as any;

function variant(id: string, confirmed: boolean, confidence: number): AttackVariant {
  return {
    id,
    description: id,
    cost: 'low',
    risk: 'read-only',
    signalToNoise: 'low',
    confidence,
    run: async () => ({ confirmed, steps: [{ technique: id, request: 'GET /x', response_summary: 'ok' }], summary: `${id}: ${confirmed}` }),
  };
}

test('runVariants: cae a la 2ª variante cuando la 1ª no confirma', async () => {
  const res = await runVariants(ctx, [variant('union', false, 0.97), variant('error', true, 0.7)]);
  assert.equal(res.confirmed, true);
  assert.equal(res.variant_used, 'error');
  assert.equal(res.confidence, 0.7);
  assert.equal(res.variants_tried.length, 2);
  assert.equal(res.steps.length, 2); // acumula los pasos de ambas
});

test('runVariants: usa la 1ª si confirma (sin fallback)', async () => {
  const res = await runVariants(ctx, [variant('union', true, 0.97), variant('error', true, 0.7)]);
  assert.equal(res.variant_used, 'union');
  assert.equal(res.confidence, 0.97);
  assert.equal(res.variants_tried.length, 1);
});

test('buildDiagnoses: veredicto, confianza, causa raíz con ref y remediación', () => {
  const results: AttackResult[] = [
    { vuln_id: 'sql-injection', confirmed: true, blocked: false, steps: [{ technique: 't', request: 'r', response_summary: 's', exchange: {} as any }], gained: ['dump'], data_exfiltrated: { table: 'users', rows: 5 }, attacker_active: false, summary: 'ok', variant_used: 'union-based' },
    { vuln_id: 'weak-password-no-rate-limit', confirmed: false, blocked: true, steps: [], gained: [], attacker_active: false, summary: 'rate limited' },
  ];
  const diag = { results } as any;
  const refs = { 'sql-injection': { file: 'src/models/notes.ts', line: 15, commit: 'abc' } };
  const diags = buildDiagnoses(diag, buildGenericPlugin(), refs);

  const sql = diags.find((d) => d.vuln_id === 'sql-injection')!;
  assert.equal(sql.verdict, 'confirmed');
  assert.ok(sql.confidence >= 0.9);
  assert.deepEqual(sql.root_cause.ref, { file: 'src/models/notes.ts', line: 15, commit: 'abc' });
  assert.ok(sql.remediation.correct.length > 0);
  assert.ok(sql.remediation.wrong_fixes.length > 0);
  assert.equal(sql.variant_used, 'union-based');
  assert.match(sql.reverify.instructions, /--only sql-injection/);

  const wp = diags.find((d) => d.vuln_id === 'weak-password-no-rate-limit')!;
  assert.equal(wp.verdict, 'not-confirmed');
  assert.equal(wp.confidence, 0.8); // defensa observada
});
