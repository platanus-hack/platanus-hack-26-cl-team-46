/**
 * Reporte final de una simulación. Es el mismo formato que dibuja la página de
 * resultado del frontend (frontend/src/components/result/types.ts): si cambia uno,
 * hay que cambiar el otro.
 */

export type ResultMode = 'instructor' | 'examen';
export type ResultVerdict = 'contenido' | 'hackeado';

/** Metáfora de aviación, de menor a mayor. */
export const RANKS = ['Pasajero', 'Copiloto', 'Piloto', 'Instructor'] as const;
export type ResultRank = (typeof RANKS)[number];

export interface ResultSkills {
  contencion: number;
  reaccion: number;
  precision: number;
  protocolo: number;
  integridad: number;
}

/** A: entrada de datos · B: infra, auth y secretos · C: volumen y caída. */
export type VectorFamily = 'A' | 'B' | 'C';

export interface ResultVector {
  id: string;
  name: string;
  family: VectorFamily;
  score: number;
}

export interface ResultTimelineEntry {
  /** Segundos desde que partió el ataque. */
  t: number;
  attack: string;
  userAction: string;
  result: 'ok' | 'tarde' | 'empeora';
}

export interface SimulationResult {
  mode: ResultMode;
  verdict: ResultVerdict;
  diagnosis: string;
  rank: ResultRank;
  repo: string;
  hud: { time: number; steps: number; minSteps: number; contained: number };
  skills: ResultSkills;
  vectors: ResultVector[];
  timeline: ResultTimelineEntry[];
  recommendations: {
    summary: string;
    didWell: string[];
    improve: { point: string; why: string }[];
  };
  aiUsage: { prompts: number; followed: number; manual: number };
  clickyUsage?: {
    questions: number;
    highlights: number;
    hintsFollowed: number;
  };
  fixes: { title: string; done: boolean; file?: string; steps: string[] }[];
}

/**
 * pending:    terminó la simulación y el reporte está en cola.
 * generating: el agente de reportes está trabajando.
 * ready:      listo (result).
 * failed:     el agente y el respaldo fallaron (error).
 */
export type ReportStatus = 'pending' | 'generating' | 'ready' | 'failed';

/** Lo que se guarda en la simulación (SimulationRecord.report). */
export interface ReportRecord {
  status: ReportStatus;
  /** Qué cerró la simulación: finished, stopped o failed. */
  trigger: string;
  /** Dueño congelado al cerrar: el reporte sigue siendo suyo aunque borre el sandbox. */
  owner?: { github_id: number; login: string };
  /** Nombre para mostrar del sandbox al cerrar. */
  title?: string;
  requested_at: string;
  /** Cuándo se cerró la simulación (según el timeline). */
  closed_at?: string;
  started_at?: string;
  generated_at?: string;
  attempts: number;
  model?: string;
  ms?: number;
  /** true: lo armó el respaldo sin LLM (solo con los hechos del timeline). */
  degraded?: boolean;
  error?: string;
  result?: SimulationResult;
}
