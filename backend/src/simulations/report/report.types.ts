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
  /** Segundos de incidente desde que partió el ataque (sin las pausas por Hinty). */
  t: number;
  attack: string;
  userAction: string;
  result: 'ok' | 'tarde' | 'empeora';
  /** Vuln del momento, si aplica. */
  vulnId?: string;
  /** seq del evento del timeline que ancla el momento: el replay en detalle parte de ahí. */
  seq?: number;
}

/** Un pedido al agente de código y qué pasó con lo que propuso. */
export interface ResultAiMoment {
  t: number;
  /** seq del user.message. */
  seq: number;
  /** Lo que pidió, resumido. */
  prompt: string;
  outcome: 'seguida' | 'parcial' | 'ignorada' | 'sin_respuesta';
  note: string;
}

/** Cambios reales que hizo el agente de código en la app (medidos en el timeline). */
export interface ResultAiChanges {
  commits: number;
  env: number;
  db: number;
  restarts: number;
  deploys: number;
  failed: number;
}

export interface ResultAiUsage {
  /** Mensajes al agente de código. */
  prompts: number;
  /** Sugerencias del agente que siguió. */
  followed: number;
  /** Acciones rápidas (botones). */
  manual: number;
  changes?: ResultAiChanges;
  /** Segundos de incidente hasta el primer mensaje al agente (null: nunca le escribió). */
  firstPrompt?: number | null;
  /** Segundos promedio que tardó el agente en responder. */
  avgReply?: number | null;
  moments?: ResultAiMoment[];
}

/** Una pregunta a Hinty durante el incidente. */
export interface ResultHintyMoment {
  t: number;
  question: string;
  /** Hinty respondió con una guía paso a paso. */
  guided: boolean;
}

export interface ResultClickyUsage {
  /** Preguntas que hizo (sin contar los pasos de una guía). */
  questions: number;
  /** Marcas que Hinty dibujó en la pantalla. */
  highlights: number;
  /** Pasos de una guía que el developer completó. */
  hintsFollowed: number;
  /** Veces que abrió Hinty (cada una pausa el incidente). */
  sessions?: number;
  /** Segundos con el incidente en pausa por Hinty. */
  pausedSeconds?: number;
  moments?: ResultHintyMoment[];
  /** Lectura del agente de reportes sobre cómo usó a Hinty. */
  note?: string;
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
  aiUsage: ResultAiUsage;
  /** Solo si mode === 'instructor'. */
  clickyUsage?: ResultClickyUsage;
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

/** Una lectura comparada: tú contra las demás corridas. */
export interface BenchmarkMetric {
  you: number;
  median: number | null;
  /** 0-100: a cuántas corridas les ganaste (null si hay pocos datos). */
  percentile: number | null;
  /** Corridas con las que se compara. */
  runs: number;
  better: 'higher' | 'lower';
}

export interface BenchmarkVector {
  id: string;
  name: string;
  family: VectorFamily;
  score: BenchmarkMetric;
}

/** GET /simulations/:id/benchmark. Solo agregados anónimos: nunca repos ni usuarios de otros. */
export interface BenchmarkView {
  /** Corridas comparables (reportes listos con análisis, sin contar esta). */
  runs: number;
  /** Developers distintos detrás de esas corridas. */
  devs: number;
  /** Mínimo de corridas para mostrar una comparación. */
  min_sample: number;
  overall: {
    score: BenchmarkMetric;
    time: BenchmarkMetric;
    steps: BenchmarkMetric;
    /** % de corridas que terminaron con el atacante afuera (null si hay pocos datos). */
    contained_rate: number | null;
  };
  /** Mediana de cada skill en las demás corridas (null si hay pocos datos). */
  skills: ResultSkills | null;
  vectors: BenchmarkVector[];
}
