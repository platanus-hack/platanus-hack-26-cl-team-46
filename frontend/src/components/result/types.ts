/**
 * Resultado del simulacro (lo que ve el usuario al terminar el Desktop).
 * Hoy se construye contra `mockResult`; después lo arma el backend a partir del debrief
 * del observer (`sim.finished`) y del timeline.
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
  /** Segundos desde T+00:00. */
  t: number;
  attack: string;
  userAction: string;
  result: "ok" | "tarde" | "empeora";
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
  aiUsage: { prompts: number; followed: number; manual: number };
  /** Solo si mode === "instructor". */
  clickyUsage?: { questions: number; highlights: number; hintsFollowed: number };
  fixes: ResultFix[];
}
