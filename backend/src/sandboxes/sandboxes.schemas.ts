import { z } from 'zod';

const envKey = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'nombre de variable inválido');

export const createSandboxSchema = z.object({
  repo_url: z
    .url()
    .refine((u) => u.startsWith('https://'), 'repo_url debe ser https')
    .transform((u) => u.replace(/\/+$/, '').replace(/\.git$/, '')),
  ref: z.string().min(1).optional(),
  env: z.record(envKey, z.string()).optional(),
  /**
   * agent (default): la IA analiza el repo y lo despliega, siempre.
   * manifest: solo determinista con .sandbox/manifest.json (sin IA).
   * auto: determinista y, si falla, IA (legado).
   */
  mode: z.enum(['agent', 'manifest', 'auto']).default('agent'),
  /** Nombre para mostrar. Si no viene, se usa `owner/repo`. */
  name: z.string().trim().max(80).optional(),
});

/** Renombrar un sandbox. Vacío = volver al nombre por defecto (`owner/repo`). */
export const updateSandboxSchema = z.object({
  name: z.string().trim().max(80),
});
export type UpdateSandboxBody = z.infer<typeof updateSandboxSchema>;

/** Valores que el agente le pidió al usuario (API keys, etc.). */
export const provideInputsSchema = z.object({
  env: z
    .record(envKey, z.string().min(1))
    .refine((v) => Object.keys(v).length > 0, 'Indica al menos una variable'),
});
export type ProvideInputsBody = z.infer<typeof provideInputsSchema>;

export const redeploySchema = z
  .object({
    /** Diff unificado (formato `git diff`), relativo a la raíz del repo. */
    patch: z.string().min(1).optional(),
    /** Alternativa al diff: contenido completo de archivos. content null = borrar. */
    files: z
      .array(
        z.object({ path: z.string().min(1), content: z.string().nullable() }),
      )
      .optional(),
    message: z.string().min(1).max(200).optional(),
    clear_cache: z.boolean().optional(),
  })
  .default({});

export const setEnvSchema = z
  .object({
    env: z.record(envKey, z.string()).optional(),
    /** Variables a las que Render les genera un valor aleatorio nuevo (ej. rotar JWT_SECRET). */
    generate: z.array(envKey).optional(),
    unset: z.array(envKey).optional(),
    /** Gatillar un deploy para que los cambios tomen efecto (default true). */
    deploy: z.boolean().optional(),
  })
  .refine(
    (v) => v.env || v.generate?.length || v.unset?.length,
    'Indica env, generate o unset',
  );

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

export const logsQuerySchema = z.object({
  startTime: z.iso.datetime().optional(),
  endTime: z.iso.datetime().optional(),
  direction: z.enum(['forward', 'backward']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  /** Separados por coma: app,request,build */
  type: csv,
  text: csv,
  level: csv,
});

export const logsStreamQuerySchema = z.object({
  since: z.iso.datetime().optional(),
  type: csv,
});

export type CreateSandboxBody = z.infer<typeof createSandboxSchema>;
export type RedeployBody = z.infer<typeof redeploySchema>;
export type SetEnvBody = z.infer<typeof setEnvSchema>;
export type LogsQuery = z.infer<typeof logsQuerySchema>;
export type LogsStreamQuery = z.infer<typeof logsStreamQuerySchema>;
