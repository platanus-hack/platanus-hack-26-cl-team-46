/** Cliente del backend (NestJS). Tipos alineados con el contrato Deploy → Motor. */
import { API_URL, HttpError, request } from "./http";

export { API_URL };

export type SandboxStatus =
  | "provisioning"
  | "analyzing"
  | "needs_input"
  | "deploying"
  | "ready"
  | "failed"
  | "deleted";

export type SandboxMode = "auto" | "manifest" | "agent";

export interface SandboxAgent {
  reason: string;
  started_at: string;
  plans_submitted: number;
  finished_at?: string;
  outcome?: "deployed" | "gave_up";
  summary?: string;
  active: boolean;
}

export interface Sandbox {
  sandbox_id: string;
  /** Nombre para mostrar: el que eligió el usuario o `owner/repo`. */
  name: string;
  repo_url: string;
  commit_sha: string | null;
  deployed_url: string | null;
  credentials: {
    seed_users: { email: string; password: string; role?: string }[];
    db_url: string | null;
    env: Record<string, string>;
  };
  status: SandboxStatus;
  mode: SandboxMode;
  error: string | null;
  logs_url: string;
  events_url: string;
  render_service_id: string | null;
  render_dashboard_url: string | null;
  mirror_repo_url: string | null;
  manifest_source: "file" | "inferred" | "agent" | null;
  current_deploy: { id: string; status: string; reason: string; commit_sha?: string } | null;
  agent: SandboxAgent | null;
  pending_inputs: { key: string; description: string }[];
  /** Si falló: por qué. `unsupported` = la app no se puede desplegar hoy (ver failure_reason). */
  failure_kind?: "unsupported" | "capacity" | "error" | null;
  /** Motivo corto para el usuario (en `unsupported`). */
  failure_reason?: string | null;
  created_at: string;
  updated_at: string;
}

/** Formato de evento del contrato (sección 6.2). */
export interface SimEvent {
  t: string;
  vuln_id: string | null;
  source: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  raw: Record<string, unknown>;
}

/**
 * Sin sesión (401) → al login, volviendo después a esta misma página.
 * La sesión es una cookie httpOnly del backend: por eso todas las llamadas van con credentials.
 */
export function goToLogin() {
  if (typeof window === "undefined") return;
  const next = window.location.pathname + window.location.search;
  // Recarga completa a propósito: la sesión se vuelve a leer desde cero al volver.
  const url = new URL("/start/github", window.location.origin);
  url.searchParams.set("next", next);
  window.location.assign(url.href);
}

/** EventSource que manda la cookie de sesión (el backend está en otro subdominio). */
export function authedEventSource(url: string) {
  return new EventSource(url, { withCredentials: true });
}

/** Llamada a la API con sesión (ver http.ts). Un 401 manda al login, volviendo a esta página. */
export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) goToLogin();
    throw e;
  }
}

export interface StreamOptions {
  /** Se conectó (o reconectó): el backend puede volver a mandar el historial desde el inicio. */
  onOpen?: () => void;
}

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * SSE con sesión que no se muere en silencio. EventSource reintenta solo los cortes de red, pero si
 * al reconectar recibe un no-200 (un 502 durante un deploy, p. ej.) queda CLOSED para siempre y la
 * pantalla deja de actualizarse sin avisar. En ese caso lo reabrimos con espera creciente
 * (1 s → 30 s; vuelve a 1 s al conectar). `url` puede ser función para reabrir desde otro punto.
 * Devuelve la función para cerrar (también cancela un reintento pendiente).
 */
export function subscribeStream(
  url: string | (() => string),
  types: string[],
  onMessage: (msg: MessageEvent) => void,
  opts: StreamOptions = {},
): () => void {
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = RETRY_MIN_MS;
  let closed = false;
  const handler = (msg: Event) => onMessage(msg as MessageEvent);

  const connect = () => {
    timer = null;
    if (closed) return;
    const source = authedEventSource(typeof url === "function" ? url() : url);
    es = source;
    for (const t of types) source.addEventListener(t, handler);
    source.onopen = () => {
      delay = RETRY_MIN_MS;
      opts.onOpen?.();
    };
    source.onerror = () => {
      // CONNECTING = el navegador ya está reintentando solo; CLOSED = se rindió, nos toca a nosotros.
      if (closed || source.readyState !== EventSource.CLOSED) return;
      source.close();
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, RETRY_MAX_MS);
    };
  };
  connect();

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    es?.close();
  };
}

export const api = {
  listSandboxes: () => apiRequest<Sandbox[]>("/sandboxes"),
  getSandbox: (id: string) => apiRequest<Sandbox>(`/sandboxes/${id}`),
  createSandbox: (repo_url: string, opts: { env?: Record<string, string>; mode?: SandboxMode; name?: string } = {}) =>
    apiRequest<Sandbox>("/sandboxes", { method: "POST", body: JSON.stringify({ repo_url, ...opts }) }),
  /** Cambia el nombre para mostrar. Vacío = vuelve a `owner/repo`. */
  renameSandbox: (id: string, name: string) =>
    apiRequest<Sandbox>(`/sandboxes/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  /** Entrega los secretos que pidió el agente. */
  provideInputs: (id: string, env: Record<string, string>) =>
    apiRequest<Sandbox>(`/sandboxes/${id}/inputs`, { method: "POST", body: JSON.stringify({ env }) }),
  redeploy: (id: string, body: { patch?: string; message?: string } = {}) =>
    apiRequest<Sandbox>(`/sandboxes/${id}/redeploy`, { method: "POST", body: JSON.stringify(body) }),
  setEnv: (id: string, body: { env?: Record<string, string>; generate?: string[] }) =>
    apiRequest<Sandbox>(`/sandboxes/${id}/env`, { method: "PUT", body: JSON.stringify(body) }),
  restart: (id: string) => apiRequest<Sandbox>(`/sandboxes/${id}/restart`, { method: "POST" }),
  deleteSandbox: (id: string) => apiRequest<Sandbox>(`/sandboxes/${id}`, { method: "DELETE" }),
  /**
   * SSE de progreso (eventos `deploy` del backend y `agent` del agente de IA). Devuelve la función para cerrar.
   * Ojo: cada conexión (y reconexión) repite el historial completo; `onOpen` avisa para partir de cero.
   */
  subscribeEvents: (id: string, onEvent: (e: SimEvent) => void, opts?: StreamOptions) =>
    subscribeStream(`${API_URL}/sandboxes/${id}/events`, ["deploy", "agent"], (msg) => onEvent(JSON.parse(msg.data)), opts),
};
