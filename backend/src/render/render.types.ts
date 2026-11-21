/** Subconjunto tipado de la API v1 de Render que usamos. https://api-docs.render.com */

export type RenderRegion = 'oregon' | 'ohio' | 'virginia' | 'frankfurt' | 'singapore';

export interface RenderOwner {
  id: string;
  name: string;
  email: string;
  type: 'user' | 'team';
}

export type RenderEnvVarInput =
  | { key: string; value: string }
  | { key: string; generateValue: true };

export interface CreateWebServiceInput {
  name: string;
  ownerId: string;
  repo: string;
  branch?: string;
  rootDir?: string;
  envVars?: RenderEnvVarInput[];
  runtime: 'docker' | 'node' | 'python' | 'ruby' | 'go' | 'rust' | 'elixir';
  plan: string;
  region: RenderRegion;
  healthCheckPath?: string;
  /** Solo runtime nativo (node, python...). */
  buildCommand?: string;
  startCommand?: string;
  /** Solo runtime docker. */
  dockerfilePath?: string;
  dockerContext?: string;
}

export interface RenderService {
  id: string;
  name: string;
  type: string;
  repo?: string;
  branch?: string;
  suspended: 'suspended' | 'not_suspended';
  dashboardUrl: string;
  serviceDetails: {
    url?: string;
    plan?: string;
    region?: string;
    runtime?: string;
  };
}

export type RenderDeployStatus =
  | 'created'
  | 'queued'
  | 'build_in_progress'
  | 'update_in_progress'
  | 'live'
  | 'deactivated'
  | 'build_failed'
  | 'update_failed'
  | 'canceled'
  | 'pre_deploy_in_progress'
  | 'pre_deploy_failed';

export const DEPLOY_FAILED_STATUSES: ReadonlySet<string> = new Set([
  'build_failed',
  'update_failed',
  'canceled',
  'pre_deploy_failed',
  'deactivated',
]);

export interface RenderDeploy {
  id: string;
  status: RenderDeployStatus;
  trigger?: string;
  commit?: { id: string; message?: string; createdAt?: string };
  createdAt: string;
  updatedAt: string;
  finishedAt?: string | null;
}

/** creating | available | unavailable | suspended | restarting | ... */
export type RenderPostgresStatus = string;

export interface RenderPostgres {
  id: string;
  name: string;
  status: RenderPostgresStatus;
  plan: string;
  region: string;
  databaseName: string;
  databaseUser: string;
  dashboardUrl: string;
}

export interface RenderPostgresConnectionInfo {
  password: string;
  internalConnectionString: string;
  externalConnectionString: string;
  psqlCommand: string;
}

export interface RenderLogLine {
  id: string;
  message: string;
  timestamp: string;
  labels: { name: string; value: string }[];
}

export interface RenderLogsPage {
  hasMore: boolean;
  nextStartTime: string;
  nextEndTime: string;
  logs: RenderLogLine[];
}

export interface ListLogsQuery {
  resource: string[];
  startTime?: string;
  endTime?: string;
  direction?: 'forward' | 'backward';
  limit?: number;
  type?: string[];
  text?: string[];
  level?: string[];
}
