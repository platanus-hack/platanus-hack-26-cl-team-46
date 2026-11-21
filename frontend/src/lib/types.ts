/**
 * Modelo de dominio compartido por la UI. Fuente: definición del producto
 * (5 vectores agrupados en 3 familias visuales, evaluación por dimensiones).
 * Cuando exista el backend, estos tipos deberían venir de un paquete compartido
 * (p. ej. packages/shared).
 */

/** Familias visuales: la superficie por donde entra/impacta el ataque. */
export type AttackFamily = "text-input" | "infra-secrets" | "volume";

export type AttackVector =
  | "prompt-injection"
  | "message" // por confirmar
  | "deploy" // por confirmar
  | "keychain-access"
  | "dos";

export const VECTOR_FAMILY: Record<AttackVector, AttackFamily> = {
  "prompt-injection": "text-input",
  message: "text-input",
  deploy: "infra-secrets",
  "keychain-access": "infra-secrets",
  dos: "volume",
};

export type Severity = "low" | "medium" | "high" | "critical";

/** Hallazgo real del análisis del repo, con el fragmento de código que lo ancla. */
export interface Finding {
  id: string;
  vector: AttackVector;
  severity: Severity;
  title: string;
  description: string;
  file: string;
  line: number;
  snippet: string;
}

export interface Project {
  id: string;
  repoFullName: string; // "owner/repo"
  stack: string;
  findings: Finding[];
}

/** Un paso del guión del simulacro: entrada → escalada → impacto. */
export interface ScenarioStep {
  id: string;
  vector: AttackVector;
  stage: "entry" | "escalation" | "impact";
  /** Momento (ms desde el inicio del simulacro) en que se dispara. */
  atMs: number;
  narration: string;
  findingId?: string;
}

export interface Scenario {
  projectId: string;
  steps: ScenarioStep[];
}

/** Dimensiones de la rúbrica: son también el benchmark. */
export type EvaluationDimension =
  | "containment"
  | "time"
  | "steps"
  | "escalation"
  | "collateral";

export const DIMENSION_LABEL: Record<EvaluationDimension, string> = {
  containment: "Contención del daño",
  time: "Tiempo de respuesta",
  steps: "Pasos vs. mínimo",
  escalation: "Escaló a quien debía",
  collateral: "No rompió nada más",
};

export interface DimensionScore {
  dimension: EvaluationDimension;
  /** 0–100 */
  score: number;
  comment: string;
}

export interface Report {
  projectId: string;
  overall: number;
  dimensions: DimensionScore[];
}
