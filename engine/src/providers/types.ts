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

/**
 * ProbeSpec: módulo de ataque EJECUTABLE pero DECLARATIVO (datos, no código).
 * Es lo que un provider genera (structured output) y lo que el ejecutor confiable
 * corre tras pasar el gate (scope). Contrato compartido providers ↔ dual.
 */
export interface ProbeSpec {
  id: string;
  vuln_class: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string; // relativo (debe empezar con '/')
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  needs_auth?: boolean;
  success: {
    status_eq?: number;
    status_gte?: number;
    body_matches?: string; // regex (i)
    reflects_query?: string; // clave de query cuyo valor debe aparecer sin escapar en HTML
  };
  note?: string;
}

export interface ProbeGenInput {
  repo?: unknown;
  angles: ProposedAngle[];
  scopeOrigins: string[];
}

export interface AnalysisProvider {
  id: string;
  /** ¿Puede ejecutarse sin costo/externo? (mock=true, anthropic=false). */
  readonly free: boolean;
  analyze(input: ProviderInput): Promise<ProposedAngle[]>;
  adapt?(input: ProviderInput, baseModuleId: string): Promise<GeneratedArtifact>;
  /** Genera ProbeSpecs ejecutables (structured output). El gate los valida después. */
  generateProbes?(input: ProbeGenInput): Promise<ProbeSpec[]>;
}
