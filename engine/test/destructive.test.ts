import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose } from '../src/core/diagnose.ts';
import { destructivePlugin, analyzeCicd } from '../src/plugins/destructive/index.ts';
import { startDestructiveFixture } from './fixtures/destructive-fixture.ts';
import type { TargetConfig } from '../src/core/types.ts';

function targetFor(url: string): TargetConfig {
  return { url, seed_users: [], dos_path: '/slow', ssrf_path: '/fetch', chat_path: '/chat', redirect_path: '/go' };
}

test('modo destructivo: confirma DoS, SSRF→secrets, prompt-injection y phishing', async () => {
  const fx = await startDestructiveFixture();
  try {
    const diag = await diagnose(targetFor(fx.url), destructivePlugin, { seed: 'd', profile: 'noisy', destructive: true });
    const confirmed = diag.results.filter((r) => r.confirmed).map((r) => r.vuln_id).sort();
    assert.deepEqual(confirmed, ['dos', 'phishing', 'prompt-injection', 'ssrf-secrets'],
      diag.results.map((r) => `${r.vuln_id}:${r.confirmed}`).join(' | '));
  } finally {
    await fx.close();
  }
});

test('guardrail: sin --destructive, los módulos destructivos NO corren', async () => {
  const fx = await startDestructiveFixture();
  try {
    const diag = await diagnose(targetFor(fx.url), destructivePlugin, { seed: 'd', profile: 'noisy' /* destructive: false */ });
    assert.equal(diag.results.length, 0); // todos filtrados
  } finally {
    await fx.close();
  }
});

test('cicd: detecta pipeline envenenable (permisos, pr-target, inyección, secret)', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const findings = await analyzeCicd(path.join(here, 'fixtures/repo-cicd'), 'abc');
  const kinds = new Set(findings.map((f) => f.kind));
  assert.ok(kinds.has('excessive-permissions'));
  assert.ok(kinds.has('pr-target'));
  assert.ok(kinds.has('expression-injection'));
  assert.ok(kinds.has('secret-exposure'));
  assert.ok(findings.every((f) => /deploy\.yml$/.test(f.ref.file) && f.ref.line > 0));
});
