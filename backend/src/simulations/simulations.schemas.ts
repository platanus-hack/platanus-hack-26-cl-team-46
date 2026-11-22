import { z } from 'zod';

const envKey = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'nombre de variable inválido');
const csv = z
  .string()
  .optional()
  .transform((v) =>
    v
      ? v
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : undefined,
  );

export const createSimulationSchema = z
  .object({
    repo_url: z
      .url()
      .refine((u) => u.startsWith('https://'), 'repo_url debe ser https')
      .transform((u) => u.replace(/\/+$/, '').replace(/\.git$/, ''))
      .optional(),
    /** Reusar un sandbox ya desplegado (más rápido para pruebas y demo). */
    sandbox_id: z
      .string()
      .regex(/^sbx-[a-f0-9]+$/)
      .optional(),
    /** emulated: thread de Conductor que emula el hack. external: lo opera el motor real vía HTTP. */
    /** Sin valor: external si el motor real está configurado (ENGINE_URL), si no emulated. */
    hacker: z.enum(['emulated', 'external']).optional(),
  })
  .refine((v) => v.repo_url || v.sandbox_id, 'Indica repo_url o sandbox_id');

export const timelineQuerySchema = z.object({
  since: z.coerce.number().int().min(0).optional(),
  view: z.enum(['user', 'all']).default('user'),
  types: csv,
  limit: z.coerce.number().int().min(1).max(3000).optional(),
});

export const controlSchema = z.object({
  action: z.enum(['next', 'pause', 'resume', 'verify', 'finish']),
  /** hinty: pausa mientras el dock de Hinty está encendido. */
  reason: z.enum(['hinty']).optional(),
  vuln_id: z.string().min(1).max(80).optional(),
});

export const messageSchema = z.object({ text: z.string().min(1).max(8000) });

/** Contrato §6.2 "Acción del developer → Motor". */
export const actionSchema = z.object({
  action: z.enum([
    'rotate_secret',
    'set_env',
    'restart',
    'redeploy',
    'rotate_password',
    'revoke_sessions',
    'block_ip',
    'maintenance',
    'custom',
  ]),
  params: z.record(z.string(), z.unknown()).default({}),
  free_text: z.string().max(4000).optional(),
});

export const stopSchema = z
  .object({ delete_sandbox: z.boolean().default(false) })
  .default({ delete_sandbox: false });

// ---------------------------------------------------------------- agentes

export const agentEventSchema = z.object({
  type: z.string().min(1).max(60),
  title: z.string().min(1).max(200),
  body: z.string().max(20_000).default(''),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  vuln_id: z.string().max(80).optional(),
  raw: z.record(z.string(), z.unknown()).default({}),
});

export const agentTimelineQuerySchema = z.object({
  since: z.coerce.number().int().min(0).optional(),
  types: csv,
  limit: z.coerce.number().int().min(1).max(500).default(60),
});

export const agentLogsQuerySchema = z.object({
  type: z.enum(['build', 'app']).default('app'),
  limit: z.coerce.number().int().min(1).max(1000).default(150),
});

export const agentDeployQuerySchema = z.object({
  wait: z.coerce.number().int().min(0).max(55).default(0),
});

export const agentChangesSchema = z.object({
  patch: z.string().min(1),
  message: z.string().min(1).max(200),
});

export const agentEnvSchema = z
  .object({
    env: z.record(envKey, z.string()).optional(),
    generate: z.array(envKey).optional(),
    unset: z.array(envKey).optional(),
  })
  .refine(
    (v) => v.env || v.generate?.length || v.unset?.length,
    'Indica env, generate o unset',
  );

export const agentSqlSchema = z.object({ sql: z.string().min(1).max(20_000) });

export type CreateSimulationBody = z.infer<typeof createSimulationSchema>;
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
export type ControlBody = z.infer<typeof controlSchema>;
export type MessageBody = z.infer<typeof messageSchema>;
export type ActionBody = z.infer<typeof actionSchema>;
export type StopBody = z.infer<typeof stopSchema>;
export type AgentEventBody = z.infer<typeof agentEventSchema>;
export type AgentTimelineQuery = z.infer<typeof agentTimelineQuerySchema>;
export type AgentLogsQuery = z.infer<typeof agentLogsQuerySchema>;
export type AgentDeployQuery = z.infer<typeof agentDeployQuerySchema>;
export type AgentChangesBody = z.infer<typeof agentChangesSchema>;
export type AgentEnvBody = z.infer<typeof agentEnvSchema>;
export type AgentSqlBody = z.infer<typeof agentSqlSchema>;

/** Partir la simulación. Con el motor real, el developer puede elegir los incidentes (en orden). */
export const startSchema = z
  .object({
    vulns: z.array(z.string().min(1).max(80)).min(1).max(8).optional(),
  })
  .default({});
export type StartBody = z.infer<typeof startSchema>;

/** Avance de la primera pasada del motor (líneas del CLI), desde Modal. */
export const engineProgressSchema = z.object({
  lines: z.array(z.string().max(500)).max(500),
});
export type EngineProgressBody = z.infer<typeof engineProgressSchema>;
