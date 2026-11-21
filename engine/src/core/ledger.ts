/**
 * Cost ledger por corrida (requisito D).
 *
 * Registra lo que consume cada fase. Lo único que cuesta dinero son las llamadas
 * LLM de los providers (y, más adelante, el hosting en Render); los ataques
 * propios y los scanners locales son $0 pero se registran con su consumo
 * (requests/compute/tiempo). Emite estimado-antes y real-después, total por fase
 * y total general. Precios versionados.
 */

export type Phase = 'discovery' | 'recon' | 'planning' | 'exploit' | 'analysis' | 'report';

export interface Usage {
  tokensIn?: number;
  tokensOut?: number;
  cacheReadTokens?: number;
  requests?: number;
  computeMs?: number;
  wallMs?: number;
}

export interface CostEntry {
  phase: Phase;
  provider: string; // 'anthropic' | 'local' | 'render' | ...
  resource: string; // modelo o herramienta
  usage: Usage;
  currency: 'USD';
  priceVersion: string;
  estimatedUsdBefore: number;
  actualUsdAfter?: number;
}

/** Precios por 1M tokens (first-party, cache del skill claude-api 2026-11-03). */
export const PRICING: Record<string, { in: number; out: number; cacheRead: number }> = {
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01 }, // cacheRead estimado (~10% in)
};
export const PRICE_VERSION = '2026-11-03';

/** Costo USD de un uso LLM según el modelo. Tokens de cache se cobran aparte. */
export function llmCost(model: string, u: Usage): number {
  const p = PRICING[model];
  if (!p) return 0;
  const inTok = u.tokensIn ?? 0;
  const cacheTok = u.cacheReadTokens ?? 0;
  const outTok = u.tokensOut ?? 0;
  return (inTok * p.in + cacheTok * p.cacheRead + outTok * p.out) / 1_000_000;
}

export class CostLedger {
  readonly entries: CostEntry[] = [];

  /** Registra un uso LLM (cuesta dinero). `estimate` = antes; actual = después. */
  recordLlm(phase: Phase, model: string, usage: Usage, estimatedUsdBefore?: number): CostEntry {
    const actual = llmCost(model, usage);
    const entry: CostEntry = {
      phase,
      provider: 'anthropic',
      resource: model,
      usage,
      currency: 'USD',
      priceVersion: PRICE_VERSION,
      estimatedUsdBefore: estimatedUsdBefore ?? actual,
      actualUsdAfter: actual,
    };
    this.entries.push(entry);
    return entry;
  }

  /** Registra una herramienta/compute local o propia: $0, pero con su consumo. */
  recordLocal(phase: Phase, resource: string, usage: Usage): CostEntry {
    const entry: CostEntry = {
      phase,
      provider: 'local',
      resource,
      usage,
      currency: 'USD',
      priceVersion: PRICE_VERSION,
      estimatedUsdBefore: 0,
      actualUsdAfter: 0,
    };
    this.entries.push(entry);
    return entry;
  }

  byPhase(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.entries) out[e.phase] = (out[e.phase] ?? 0) + (e.actualUsdAfter ?? e.estimatedUsdBefore);
    return out;
  }

  get estimatedTotalUsd(): number {
    return round(this.entries.reduce((s, e) => s + e.estimatedUsdBefore, 0));
  }
  get grandTotalUsd(): number {
    return round(this.entries.reduce((s, e) => s + (e.actualUsdAfter ?? e.estimatedUsdBefore), 0));
  }

  /** ¿Se excedió el presupuesto? */
  overBudget(maxUsd?: number): boolean {
    return maxUsd !== undefined && this.grandTotalUsd > maxUsd;
  }

  snapshot() {
    return {
      currency: 'USD' as const,
      priceVersion: PRICE_VERSION,
      byPhase: this.byPhase(),
      estimatedTotalUsd: this.estimatedTotalUsd,
      grandTotalUsd: this.grandTotalUsd,
      entries: this.entries,
    };
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
