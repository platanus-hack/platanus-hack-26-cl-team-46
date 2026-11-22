import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CostLedger, llmCost } from '../src/core/ledger.ts';

test('llmCost calcula según el modelo y tokens', () => {
  // Opus 5.5: $4 in / $20 out por 1M.
  assert.equal(llmCost('claude-opus-5-5', { tokensIn: 1_000_000, tokensOut: 1_000_000 }), 24);
  // Sonnet 5.5: $2 in por 1M → 100k = $0.2.
  assert.equal(llmCost('claude-sonnet-5-5', { tokensIn: 100_000 }), 0.2);
  // Cache reads se cobran aparte (Opus $0.20/1M).
  assert.equal(llmCost('claude-opus-5-5', { cacheReadTokens: 1_000_000 }), 0.2);
  // Modelo desconocido → 0 (no inventa precio).
  assert.equal(llmCost('modelo-x', { tokensIn: 1_000_000 }), 0);
});

test('CostLedger agrega por fase, total, estimado y herramientas locales a $0', () => {
  const l = new CostLedger();
  l.recordLocal('recon', 'http+recon', { requests: 30, wallMs: 1200 });
  l.recordLocal('exploit', 'http-attacks', { requests: 46, wallMs: 11000 });
  const llm = l.recordLlm('analysis', 'claude-sonnet-5-5', { tokensIn: 100_000, tokensOut: 20_000 }, 0.5);

  // Local = $0 pero con su consumo registrado.
  const local = l.entries.filter((e) => e.provider === 'local');
  assert.equal(local.length, 2);
  assert.ok(local.every((e) => e.actualUsdAfter === 0));
  assert.equal(local[0].usage.requests, 30);

  // LLM: 100k×$2/M + 20k×$10/M = $0.2 + $0.2 = $0.4.
  assert.equal(llm.actualUsdAfter, 0.4);
  assert.equal(llm.estimatedUsdBefore, 0.5);

  assert.equal(l.grandTotalUsd, 0.4);
  assert.equal(l.estimatedTotalUsd, 0.5);
  assert.deepEqual(l.byPhase(), { recon: 0, exploit: 0, analysis: 0.4 });

  assert.equal(l.overBudget(5), false);
  assert.equal(l.overBudget(0.3), true);

  const snap = l.snapshot();
  assert.equal(snap.grandTotalUsd, 0.4);
  assert.equal(snap.entries.length, 3);
});
