/** Cliente de /simulations (orquestación multi-agente). Tipos alineados con backend/src/simulations. */
import type { Benchmark, ResultRank, ResultVerdict, SimulationResult } from "@/components/result/types";
import { API_URL, apiRequest, subscribeStream } from "./api";

export type SimStatus = "starting" | "ready" | "running" | "paused" | "finished" | "failed" | "stopped";
export type SimRole = "infra" | "hacker" | "observer" | "generator" | "coder";

export interface TimelineEvent {
  seq: number;
  t: string;
  sim_id: string;
  actor: SimRole | "user" | "system";
  type: string;
  visibility: "user" | "internal";
  vuln_id: string | null;
  source: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  raw: Record<string, unknown>;
}

export interface Simulation {
  sim_id: string;
  status: SimStatus;
  error: string | null;
  repo_url: string;
  sandbox: {
    sandbox_id: string;
    /** Nombre para mostrar del sandbox (custom o `owner/repo`). */
    name?: string;
    status: string;
    deployed_url: string | null;
    /** La app servida por el proxy de preview (mismo site que mayday.rip: las cookies funcionan en el iframe). */
    preview_url?: string | null;
    seed_users: unknown[];
    /** Si el deploy falló: por qué (unsupported = la app no se puede desplegar hoy). */
    failure_kind?: "unsupported" | "capacity" | "error" | null;
    failure_reason?: string | null;
  };
  threads: {
    role: SimRole;
    /** agent: agente con su propio entorno · api: corre en el backend con la API de Claude · external: motor externo */
    mode: "agent" | "api" | "external";
    wakes: number;
    model?: string | null;
    last_ms?: number | null;
    last_error?: string | null;
  }[];
  channels: string[];
  /** Herramientas de monitoreo detectadas en el código (null = aún no se revisa). */
  tools_detected: string[] | null;
  context: Record<string, unknown> | null;
  attack_plan: { findings?: { vuln_id: string; file: string; line?: number; severity: string }[] } | null;
  /** Motor de hacking real (solo hacker_mode external): primera pasada, informe y verificaciones. */
  engine: EngineView | null;
  hacker_mode?: "emulated" | "external";
  /** El rol hacker lo opera el motor real (primera pasada + simulacro). */
  engine_driven?: boolean;
  state: {
    phase?: string;
    attacker_active?: boolean;
    current_vuln?: string | null;
    summary?: string;
    compromised?: string[];
  } | null;
  debrief: Record<string, unknown> | null;
  /** Reporte final (lo arma el agente de reportes al cerrar). null = la simulación no tiene. */
  report: { status: ReportStatus; verdict: ResultVerdict | null; rank: ResultRank | null; degraded: boolean } | null;
  created_at: string;
}

export interface EngineFinding {
  vuln_id: string;
  title: string;
  severity: string;
  order: number;
  confirmed: boolean;
  file?: string;
  line?: number;
  real_case?: string;
}

export interface EngineView {
  status: "running" | "done" | "failed";
  error: string | null;
  started_at: string;
  finished_at: string | null;
  /** Salida del motor en vivo (últimas líneas). */
  log: string[];
  summary: { confirmed: number; total: number; requests: number; duration_ms: number; correlated: number } | null;
  findings: EngineFinding[];
  selected: string[] | null;
  played: string[];
  current: string | null;
  verifies: { vuln_id: string; status: "running" | "done" | "failed"; requested_at: string; error: string | null }[];
}

export type ReportStatus = "pending" | "generating" | "ready" | "failed";

/** Una fila del historial (GET /reports). */
export interface ReportSummary {
  sim_id: string;
  title: string;
  repo_url: string;
  status: ReportStatus;
  /** Cómo se cerró la simulación: finished, stopped o failed. */
  trigger: string;
  started_at: string;
  closed_at: string;
  generated_at: string | null;
  degraded: boolean;
  verdict: ResultVerdict | null;
  rank: ResultRank | null;
  score: number | null;
  diagnosis: string | null;
  time: number | null;
  /** "contenidos/jugados". */
  vectors: string | null;
}

/** GET /simulations/:id/report. */
export interface ReportView {
  sim_id: string;
  title: string;
  status: ReportStatus;
  trigger: string;
  requested_at: string;
  generated_at: string | null;
  model: string | null;
  degraded: boolean;
  error: string | null;
  result: SimulationResult | null;
}

const request = apiRequest;
const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const simApi = {
  list: () => request<Simulation[]>("/simulations"),
  get: (id: string) => request<Simulation>(`/simulations/${id}`),
  create: (body: { repo_url?: string; sandbox_id?: string }) => post<Simulation>("/simulations", body),
  /** Con el motor real se pueden elegir los incidentes (en orden). */
  start: (id: string, vulns?: string[]) => post<Simulation>(`/simulations/${id}/start`, vulns?.length ? { vulns } : {}),
  control: (id: string, action: "next" | "pause" | "resume" | "finish", vuln_id?: string, reason?: "hinty") =>
    post<Simulation>(`/simulations/${id}/control`, { action, vuln_id, ...(reason ? { reason } : {}) }),
  message: (id: string, text: string) => post<TimelineEvent>(`/simulations/${id}/messages`, { text }),
  action: (id: string, action: string, params: Record<string, unknown> = {}, free_text?: string) =>
    post<TimelineEvent>(`/simulations/${id}/actions`, { action, params, free_text }),
  stop: (id: string) => post<Simulation>(`/simulations/${id}/stop`, {}),
  /** Historial de reportes del usuario (los suyos; con el login apagado, todos). */
  reports: () => request<ReportSummary[]>("/reports"),
  report: (id: string) => request<ReportView>(`/simulations/${id}/report`),
  regenerateReport: (id: string) => post<{ sim_id: string; status: ReportStatus }>(`/simulations/${id}/report`),
  /** Tu reporte contra las demás corridas (solo agregados anónimos). */
  benchmark: (id: string) => request<Benchmark>(`/simulations/${id}/benchmark`),
  /** Timeline guardado. Con la simulación cerrada, view=all ya no regala nada. */
  timeline: (id: string, view: "user" | "all" = "all", types?: string[]) =>
    request<TimelineEvent[]>(
      `/simulations/${id}/timeline?view=${view}${types?.length ? `&types=${encodeURIComponent(types.join(","))}` : ""}`,
    ),
  /** SSE del timeline. view=user: lo que ve el developer. view=all: también lo interno. */
  subscribe(id: string, view: "user" | "all", onEvent: (e: TimelineEvent) => void): () => void {
    // Al reconectar solo, EventSource manda Last-Event-ID y el backend sigue desde ahí. Si hay que
    // reabrirlo (se cerró por un no-200), se pide desde el último seq recibido con `since`.
    let last = 0;
    const url = () => `${API_URL}/simulations/${id}/stream?view=${view}${last > 0 ? `&since=${last}` : ""}`;
    // Cada evento llega con `event: <tipo>`, así que hay que escuchar tipo por tipo.
    return subscribeStream(url, STREAM_EVENT_TYPES, (m) => {
      const e = JSON.parse(m.data) as TimelineEvent;
      if (e.seq > last) last = e.seq;
      onEvent(e);
    });
  },
};

/**
 * Todos los tipos de evento del timeline. Fuente de verdad: EVENT_TYPES en
 * backend/src/simulations/simulation.types.ts. Un tipo que falte acá no llega nunca (el SSE manda `event: <tipo>`).
 */
const STREAM_EVENT_TYPES = [
  // sistema
  "sim.status", "deploy.progress", "deploy.ready", "deploy.failed",
  // control
  "control.start", "control.next", "control.pause", "control.resume", "control.finish", "control.verify",
  // atacante y observador
  "attack.plan", "attack.step", "attack.success", "attack.blocked", "attack.verify", "attack.done",
  "state.update", "incident.pulse", "sim.finished",
  // generador, usuario y coder
  "notify", "user.message", "user.action", "coder.reply",
  "change.commit", "change.env", "change.restart", "change.db", "change.deployed", "change.deploy_failed",
  // Hinty
  "hinty.question",
  // infra
  "context.ready", "infra.request", "infra.reply", "agent.note",
];
