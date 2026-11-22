/**
 * Providers / agentes de análisis (requisito C). Un provider lee el RepoModel +
 * recon + telemetría y propone ángulos nuevos o adapta/genera módulos. TODO
 * artefacto generado pasa por el gate (schema + scope + sandbox) antes de
 * ejecutarse; nada se ejecuta libremente.
 */

export interface ProviderInput {
  /** Resumen del repo (RepoModel) y señales. */
  repo?: unknown;
  recon?: unknown;
  telemetry?: unknown;
  /** Hosts autorizados (para el scope guard del gate). */
  scopeOrigins: string[];
}

export interface ProposedAngle {
  vuln_id?: string;
  title: string;
  rationale: string;
  /** Pista de dónde (archivo/endpoint). */
  where?: string;
  confidence: number; // 0..1
}

export interface GeneratedArtifact {
  kind: 'attack-module' | 'plan';
  id: string;
  /** Código generado (si kind=attack-module). Debe pasar el gate. */
  code?: string;
  spec: Record<string, unknown>;
  provenance: { provider: string; model?: string; createdAt: string };
}

/** Modelos por rol (decisión de Sebastián). */
export interface TierConfig {
  triage: string; // claude-haiku-5-5
  analysis: string; // claude-sonnet-5-5
  generation: string; // claude-opus-5-5
}

export const DEFAULT_TIERS: TierConfig = {
  triage: 'claude-haiku-5-5',
  analysis: 'claude-sonnet-5-5',
  generation: 'claude-opus-5-5',
};

export interface AnalysisProvider {
  id: string;
  /** ¿Puede ejecutarse sin costo/externo? (mock=true, anthropic=false). */
  readonly free: boolean;
  analyze(input: ProviderInput): Promise<ProposedAngle[]>;
  adapt?(input: ProviderInput, baseModuleId: string): Promise<GeneratedArtifact>;
}
