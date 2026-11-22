/**
 * Resultado del simulacro (lo que ve el usuario al terminar el Desktop). Lo arma el agente
 * de reportes del backend (backend/src/simulations/report/report.types.ts): si cambia uno,
 * hay que cambiar el otro. Los campos opcionales no existen en reportes viejos.
 */

/** instructor = con Clicky guiando y resaltando la pantalla; examen = solo, sin ayuda. */
export type ResultMode = "instructor" | "examen";

export type ResultVerdict = "contenido" | "hackeado";

/** Metáfora de aviación, de menor a mayor. */
export const RANKS = ["Pasajero", "Copiloto", "Piloto", "Instructor"] as const;
export type ResultRank = (typeof RANKS)[number];

/** Las 5 dimensiones de la rúbrica. Siempre las 5, de 0 a 100. */
export interface ResultSkills {
  contencion: number;
  reaccion: number;
  precision: number;
  protocolo: number;
  integridad: number;
}

/** Familias de vector (DESIGN.md › VectorFamilies). */
export type VectorFamily = "A" | "B" | "C";

export interface ResultVector {
  /** vuln_id del catálogo (ej. "idor"). */
  id: string;
  name: string;
  family: VectorFamily;
  /** Qué tan bien respondió el usuario a este vector, 0-100. */
  score: number;
}

export interface ResultTimelineEntry {
  /** Segundos de incidente desde T+00:00 (sin las pausas por Hinty). */
  t: number;
  attack: string;
  userAction: string;
  result: "ok" | "tarde" | "empeora";
  /** Vuln del momento, si aplica. */
  vulnId?: string;
  /** seq del evento del timeline que ancla el momento (el replay en detalle parte de ahí). */
  seq?: number;
}

/** Un pedido al agente de código y qué pasó con lo que propuso. */
export interface ResultAiMoment {
  t: number;
  seq: number;
  prompt: string;
  outcome: "seguida" | "parcial" | "ignorada" | "sin_respuesta";
  note: string;
}

export interface ResultAiUsage {
  /** Mensajes al agente de código. */
  prompts: number;
  /** Sugerencias del agente que siguió. */
  followed: number;
  /** Acciones rápidas (botones). */
  manual: number;
  /** Cambios reales que hizo el agente en la app. */
  changes?: { commits: number; env: number; db: number; restarts: number; deploys: number; failed: number };
  /** Segundos hasta el primer mensaje al agente (null: nunca le escribió). */
  firstPrompt?: number | null;
  /** Segundos promedio que tardó el agente en responder. */
  avgReply?: number | null;
  moments?: ResultAiMoment[];
}

export interface ResultClickyUsage {
  /** Preguntas (sin contar los pasos de una guía). */
  questions: number;
  /** Marcas que Hinty dibujó en la pantalla. */
  highlights: number;
  /** Pasos de una guía que completó. */
  hintsFollowed: number;
  /** Veces que abrió Hinty (cada una pausa el incidente). */
  sessions?: number;
  pausedSeconds?: number;
  moments?: { t: number; question: string; guided: boolean }[];
  /** Lectura del agente de reportes. */
  note?: string;
}

export interface ResultRecommendations {
  /** 1-2 frases de cierre del coach. */
  summary: string;
  didWell: string[];
  improve: { point: string; why: string }[];
}

export interface ResultFix {
  title: string;
  done: boolean;
  /** Archivo donde vive el problema, si aplica. */
  file?: string;
  steps: string[];
}

export interface SimulationResult {
  mode: ResultMode;
  verdict: ResultVerdict;
  /** 2 frases: por qué ese veredicto. */
  diagnosis: string;
  rank: ResultRank;
  /** Repo y escenario, para el header. */
  repo: string;
  hud: {
    /** Segundos hasta el cierre del simulacro. */
    time: number;
    steps: number;
    minSteps: number;
    /** Vectores contenidos (de vectors.length). */
    contained: number;
  };
  skills: ResultSkills;
  /** SOLO los vectores que el usuario enfrentó. */
  vectors: ResultVector[];
  timeline: ResultTimelineEntry[];
  recommendations: ResultRecommendations;
  aiUsage: ResultAiUsage;
  /** Solo si mode === "instructor". */
  clickyUsage?: ResultClickyUsage;
  fixes: ResultFix[];
}

/** Una lectura comparada: tú contra las demás corridas (GET /simulations/:id/benchmark). */
export interface BenchmarkMetric {
  you: number;
  median: number | null;
  /** 0-100: a cuántas corridas les ganaste (null si hay pocos datos). */
  percentile: number | null;
  runs: number;
  better: "higher" | "lower";
}

export interface Benchmark {
  runs: number;
  devs: number;
  min_sample: number;
  overall: {
    score: BenchmarkMetric;
    time: BenchmarkMetric;
    steps: BenchmarkMetric;
    contained_rate: number | null;
  };
  skills: ResultSkills | null;
  vectors: { id: string; name: string; family: VectorFamily; score: BenchmarkMetric }[];
}
