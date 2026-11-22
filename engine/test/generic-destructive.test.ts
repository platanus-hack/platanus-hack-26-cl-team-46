import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../src/core/diagnose.ts';
import { buildGenericPlugin } from '../src/plugins/generic/index.ts';
import { startDestructiveFixture } from './fixtures/destructive-fixture.ts';
import type { RepoModel } from '../src/discovery/types.ts';
import type { TargetConfig } from '../src/core/types.ts';

function repo(): RepoModel {
  const c = 't';
  return {
    schemaVersion: '1', root: '.', commit: c, stack: [],
    routes: [
      { method: 'GET', path: '/slow', ref: { file: 'app.js', line: 1, commit: c }, source: 'express' },
      { method: 'GET', path: '/fetch', ref: { file: 'app.js', line: 2, commit: c }, source: 'express' },
    ],
    signals: [], manifests: { dockerfiles: [], ci: [], env: [] }, notes: [],
  };
}

test('modo agresivo GENÉRICO: confirma DoS y SSRF derivados del RepoModel', async () => {
  const fx = await startDestructiveFixture();
  try {
    const target: TargetConfig = { url: fx.url, seed_users: [] };
    const plugin = buildGenericPlugin({ repo: repo() });
    const diag = await diagnose(target, plugin, { profile: 'noisy', seed: 'd', destructive: true });
    const confirmed = diag.results.filter((r) => r.confirmed).map((r) => r.vuln_id);
    assert.ok(confirmed.includes('dos'), `no DoS (${confirmed.join(',')})`);
    assert.ok(confirmed.includes('ssrf-secrets'), `no SSRF (${confirmed.join(',')})`);
  } finally {
    await fx.close();
  }
});

test('guardrail: sin --destructive, el genérico NO corre DoS/SSRF', async () => {
  const fx = await startDestructiveFixture();
  try {
    const target: TargetConfig = { url: fx.url, seed_users: [] };
    const plugin = buildGenericPlugin({ repo: repo() });
    const diag = await diagnose(target, plugin, { profile: 'noisy', seed: 'd' /* destructive: false */ });
    const classes = diag.results.map((r) => r.vuln_id);
    assert.ok(!classes.includes('dos'), 'DoS corrió sin --destructive');
    assert.ok(!classes.includes('ssrf-secrets'), 'SSRF corrió sin --destructive');
  } finally {
    await fx.close();
  }
});
