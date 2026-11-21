/** Cliente de /simulations (orquestación multi-agente). Tipos alineados con backend/src/simulations. */
import { API_URL } from "./api";

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
  sandbox: { sandbox_id: string; status: string; deployed_url: string | null; seed_users: unknown[] };
  workspace_link: string | null;
  threads: { role: SimRole; session_id: string | null; deep_link: string | null; wakes: number }[];
  channels: string[];
  context: Record<string, unknown> | null;
  attack_plan: { findings?: { vuln_id: string; file: string; line?: number; severity: string }[] } | null;
  state: {
    phase?: string;
    attacker_active?: boolean;
    current_vuln?: string | null;
    summary?: string;
    compromised?: string[];
  } | null;
  debrief: Record<string, unknown> | null;
  created_at: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(body?.message ?? `${res.status}`);
  return body as T;
}

const post = <T>(path: string, body: unknown = {}) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const simApi = {
  list: () => request<Simulation[]>("/simulations"),
  get: (id: string) => request<Simulation>(`/simulations/${id}`),
  create: (body: { repo_url?: string; sandbox_id?: string }) => post<Simulation>("/simulations", body),
  start: (id: string) => post<Simulation>(`/simulations/${id}/start`),
  control: (id: string, action: "next" | "pause" | "resume" | "finish", vuln_id?: string) =>
    post<Simulation>(`/simulations/${id}/control`, { action, vuln_id }),
  message: (id: string, text: string) => post<TimelineEvent>(`/simulations/${id}/messages`, { text }),
  action: (id: string, action: string, params: Record<string, unknown> = {}, free_text?: string) =>
    post<TimelineEvent>(`/simulations/${id}/actions`, { action, params, free_text }),
  stop: (id: string) => post<Simulation>(`/simulations/${id}/stop`, {}),
  /** SSE del timeline. view=user: lo que ve el developer. view=all: también lo interno. */
  subscribe(id: string, view: "user" | "all", onEvent: (e: TimelineEvent) => void): () => void {
    const es = new EventSource(`${API_URL}/simulations/${id}/stream?view=${view}`);
    // Cada evento llega con `event: <tipo>`, así que hay que escuchar tipo por tipo.
    const types = [
      "sim.status", "deploy.progress", "deploy.ready", "deploy.failed", "control.start", "control.next", "control.pause",
      "control.resume", "control.verify", "control.finish", "attack.plan", "attack.step", "attack.success",
      "attack.blocked", "attack.verify", "attack.done", "state.update", "sim.finished", "notify", "user.message",
      "user.action", "coder.reply", "change.commit", "change.env", "change.restart", "change.db", "change.deployed",
      "change.deploy_failed", "context.ready", "infra.request", "infra.reply", "agent.note",
    ];
    const handler = (m: MessageEvent) => onEvent(JSON.parse(m.data));
    for (const t of types) es.addEventListener(t, handler);
    return () => es.close();
  },
};
