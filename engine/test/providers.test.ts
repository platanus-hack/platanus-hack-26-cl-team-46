import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockProvider } from '../src/providers/mock.ts';
import { gateArtifact } from '../src/providers/gate.ts';
import { isApproved, requireApproved } from '../src/providers/provenance.ts';
import { runExternalTool } from '../src/providers/external.ts';
import type { GeneratedArtifact } from '../src/providers/types.ts';

test('MockProvider deriva ángulos de las señales del repo', async () => {
  const p = new MockProvider();
  const angles = await p.analyze({
    scopeOrigins: ['http://x'],
    repo: { signals: [{ kind: 'raw-sql', detail: 'concat', ref: { file: 'a.ts', line: 5 } }, { kind: 'unescaped-render', detail: 'ejs' }] },
  });
  assert.equal(angles.length, 2);
  assert.ok(angles.some((a) => a.vuln_id === 'sql-injection' && a.where === 'a.ts:5'));
  assert.ok(angles.some((a) => a.vuln_id === 'stored-xss'));
});

const scope = ['https://sbx.onrender.com'];
function artifact(code: string): GeneratedArtifact {
  return { kind: 'attack-module', id: 'gen-1', code, spec: {}, provenance: { provider: 'mock', createdAt: new Date().toISOString() } };
}

test('gate: aprueba artefacto limpio con sandbox ok', async () => {
  const a = artifact(`await fetch('https://sbx.onrender.com/api/x');`);
  const r = await gateArtifact(a, scope, async () => true);
  assert.equal(r.ok, true, JSON.stringify(r.checks));
});

test('gate: rechaza URL fuera de scope', async () => {
  const r = await gateArtifact(artifact(`fetch('https://evil.example/x')`), scope, async () => true);
  assert.equal(r.ok, false);
  assert.ok(r.checks.find((c) => c.name === 'scope')!.pass === false);
});

test('gate: rechaza I/O peligroso', async () => {
  const r = await gateArtifact(artifact(`const cp = require('child_process');`), scope, async () => true);
  assert.equal(r.ok, false);
  assert.ok(r.checks.find((c) => c.name === 'no-dangerous-io')!.pass === false);
});

test('gate: sin sandbox, NO aprueba ejecución', async () => {
  const r = await gateArtifact(artifact(`fetch('https://sbx.onrender.com/x')`), scope);
  assert.equal(r.ok, false);
  assert.ok(r.checks.find((c) => c.name === 'sandbox-tests')!.pass === false);
});

test('provenance: semgrep aprobado tras review; nuclei/artex NO (gated)', async () => {
  assert.equal(isApproved('semgrep'), true);
  assert.equal(isApproved('nuclei'), false);
  assert.equal(isApproved('artex'), false);
  assert.doesNotThrow(() => requireApproved('semgrep'));
  assert.throws(() => requireApproved('artex'), /sin review/);
  await assert.rejects(() => runExternalTool('nuclei'), /sin review/);
  // semgrep aprobado, pero el runner genérico sigue sin conectar (el real es runSemgrep):
  await assert.rejects(() => runExternalTool('semgrep'), /runner/);
});
