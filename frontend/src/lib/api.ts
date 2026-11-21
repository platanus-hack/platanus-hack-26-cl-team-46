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
  workspace_id: string;
  session_id: string;
  deep_link: string;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
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
  createSandbox: (repo_url: string, opts: { env?: Record<string, string>; mode?: SandboxMode } = {}) =>
    request<Sandbox>("/sandboxes", { method: "POST", body: JSON.stringify({ repo_url, ...opts }) }),
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
    const es = new EventSource(`${API_URL}/sandboxes/${id}/events`);
    const handler = (msg: Event) => onEvent(JSON.parse((msg as MessageEvent).data));
    es.addEventListener("deploy", handler);
    es.addEventListener("agent", handler);
    return () => es.close();
  },
};
