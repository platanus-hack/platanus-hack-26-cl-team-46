/** Cliente del backend (NestJS). Tipos alineados con el contrato Deploy → Motor. */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (res.status === 401) goToLogin();
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const msg = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
    throw new Error(msg ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export const api = {
  listSandboxes: () => request<Sandbox[]>("/sandboxes"),
  getSandbox: (id: string) => request<Sandbox>(`/sandboxes/${id}`),
  createSandbox: (repo_url: string, opts: { env?: Record<string, string>; mode?: SandboxMode; name?: string } = {}) =>
    request<Sandbox>("/sandboxes", { method: "POST", body: JSON.stringify({ repo_url, ...opts }) }),
  /** Cambia el nombre para mostrar. Vacío = vuelve a `owner/repo`. */
  renameSandbox: (id: string, name: string) =>
    request<Sandbox>(`/sandboxes/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  /** Entrega los secretos que pidió el agente. */
  provideInputs: (id: string, env: Record<string, string>) =>
    request<Sandbox>(`/sandboxes/${id}/inputs`, { method: "POST", body: JSON.stringify({ env }) }),
  redeploy: (id: string, body: { patch?: string; message?: string } = {}) =>
    request<Sandbox>(`/sandboxes/${id}/redeploy`, { method: "POST", body: JSON.stringify(body) }),
  setEnv: (id: string, body: { env?: Record<string, string>; generate?: string[] }) =>
    request<Sandbox>(`/sandboxes/${id}/env`, { method: "PUT", body: JSON.stringify(body) }),
  restart: (id: string) => request<Sandbox>(`/sandboxes/${id}/restart`, { method: "POST" }),
  deleteSandbox: (id: string) => request<Sandbox>(`/sandboxes/${id}`, { method: "DELETE" }),
  /** SSE de progreso (eventos `deploy` del backend y `agent` del agente de IA). Devuelve la función para cerrar. */
  subscribeEvents: (id: string, onEvent: (e: SimEvent) => void) => {
    const es = authedEventSource(`${API_URL}/sandboxes/${id}/events`);
    const handler = (msg: Event) => onEvent(JSON.parse((msg as MessageEvent).data));
    es.addEventListener("deploy", handler);
    es.addEventListener("agent", handler);
    return () => es.close();
  },
};
