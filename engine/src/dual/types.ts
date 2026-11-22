/**
 * Camino dual A+B: ataques genéricos (A, deterministas, derivados del RepoModel)
 * y ángulos del LLM (B), corriendo en PARALELO para compararse (acuerdo) y
 * completarse (unión de cobertura).
 */

/** Hallazgo de una sonda genérica (camino A), confirmado con tráfico real. */
export interface GenericFinding {
  vuln_class: string; // idor | sql-injection | weak-password-no-rate-limit | admin-endpoint-no-authz | open-redirect
  confirmed: boolean;
  /** archivo:línea (del RepoModel) o endpoint. */
  where?: string;
  evidence: string;
  source: 'generic';
}

/** Entrada de la matriz de cobertura: qué dijo cada camino sobre una clase. */
export interface CoverageEntry {
  vuln_class: string;
  /** A la confirmó con tráfico real. */
  generic_confirmed: boolean;
  /** B la propuso. */
  llm_proposed: boolean;
  status: 'both' | 'generic-only' | 'llm-only';
  where?: string;
  /** Nota de completitud/comparación. */
  note: string;
}

export interface CoverageReport {
  entries: CoverageEntry[];
  metrics: {
    total: number;
    agreement: number; // confirmada por A y propuesta por B
    generic_only: number; // A confirmó, B no propuso (B incompleto o A más preciso)
    llm_only: number; // B propuso, A no cubre (lead a investigar / clase no genérica)
  };
  /** Conjunto unificado de clases (unión A ∪ B). */
  unified: string[];
}

export interface DualResult {
  generic: GenericFinding[];
  llm: Array<{ vuln_id?: string; title: string; rationale: string; where?: string; confidence: number }>;
  coverage: CoverageReport;
}
