import type { SandboxManifest } from './manifest.js';

/**
 * provisioning: clonando, creando mirror, base de datos y servicio.
 * analyzing:    el agente de IA está analizando o corrigiendo el deploy.
 * needs_input:  el agente necesita secretos que solo el usuario tiene.
 * deploying:    deploy en curso (si ya había una versión arriba, sigue sirviendo).
 * ready:        la app responde en deployed_url.
 * failed:       no se pudo desplegar; ver `error`.
 * deleted:      recursos borrados.
 */
export type SandboxStatus =
  | 'provisioning'
  | 'analyzing'
  | 'needs_input'
  | 'deploying'
  | 'ready'
  | 'failed'
  | 'deleted';

/** auto: determinista si se puede y, si falla, la IA. manifest: solo determinista. agent: directo a la IA. */
export type SandboxMode = 'auto' | 'manifest' | 'agent';

export interface SandboxDeployInfo {
  id: string;
  status: string;
  commit_sha?: string;
  reason: string;
  started_at: string;
  finished_at?: string;
}

export interface SandboxAgentInfo {
  workspace_id: string;
  session_id: string;
  deep_link: string;
  reason: string;
  started_at: string;
  plans_submitted: number;
  finished_at?: string;
  outcome?: 'deployed' | 'gave_up';
  summary?: string;
  /** Monitoreo de la sesión de Conductor. */
  idle_since?: string;
  nudged?: boolean;
}

export interface InputRequest {
  key: string;
  description: string;
}

/** Lo que guardamos internamente de cada sandbox. */
export interface SandboxRecord {
  sandbox_id: string;
  /** Nombre que le puso el usuario. Si no hay, se muestra `owner/repo` (sandboxDisplayName). */
  name?: string;
  repo_url: string;
  /** Usuario de GitHub que lo creó. Sin dueño (creado antes del login) solo lo ven los admins. */
  owner?: { github_id: number; login: string };
  /** Repo privado del dueño: se clona con su token de la GitHub App. */
  private_repo?: boolean;
  ref?: string;
  mode: SandboxMode;
  status: SandboxStatus;
  error?: string;
  created_at: string;
  updated_at: string;

  /** sha del repo original al momento del snapshot. */
  source_sha?: string;
  /** sha del mirror que está desplegado (o desplegándose). */
  commit_sha?: string;
  deploy_repo_url?: string;
  mirror_repo?: string;

  manifest?: SandboxManifest;
  manifest_source?: 'file' | 'inferred' | 'agent';
  /** Env que nosotros controlamos (input del usuario + secretos entregados al agente). */
  env: Record<string, string>;
  pending_inputs: InputRequest[];

  database?: { postgres_id: string; database_name?: string };
  render?: {
    service_id: string;
    service_name: string;
    dashboard_url: string;
    url?: string;
    /** Cuántas veces se recreó el servicio (cambio de runtime). */
    generation: number;
  };
  agent?: SandboxAgentInfo;
  current_deploy?: SandboxDeployInfo;
  deploys: SandboxDeployInfo[];
}

/** Evento con el formato del contrato (sección 6.2). */
export interface SandboxEvent {
  t: string;
  sandbox_id: string;
  vuln_id: null;
  source: 'deploy' | 'agent';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  raw: Record<string, unknown>;
}

/** Contrato Deploy → Motor (sección 6.2 del resumen). */
export interface SandboxContract {
  sandbox_id: string;
  /** Nombre para mostrar: el que eligió el usuario o `owner/repo`. */
  name: string;
  repo_url: string;
  commit_sha: string | null;
  deployed_url: string | null;
  credentials: {
    seed_users: SandboxManifest['seed_users'];
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
  manifest_source: SandboxRecord['manifest_source'] | null;
  current_deploy: SandboxDeployInfo | null;
  agent:
    | (Omit<SandboxAgentInfo, 'idle_since' | 'nudged'> & { active: boolean })
    | null;
  pending_inputs: InputRequest[];
  created_at: string;
  updated_at: string;
}

/** `https://github.com/owner/repo` → `owner/repo` (o el último par de segmentos si no es GitHub). */
export function repoShortName(repoUrl: string): string {
  try {
    const parts = new URL(repoUrl).pathname
      .replace(/\.git$/, '')
      .split('/')
      .filter(Boolean);
    return parts.slice(-2).join('/') || repoUrl;
  } catch {
    return repoUrl;
  }
}

export function sandboxDisplayName(
  s: Pick<SandboxRecord, 'name' | 'repo_url'>,
): string {
  return s.name?.trim() || repoShortName(s.repo_url);
}
