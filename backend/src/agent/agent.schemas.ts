import { z } from 'zod';
import { manifestSchema } from '../sandboxes/manifest.js';

export const agentChangesSchema = z
  .object({
    patch: z.string().min(1).optional(),
    files: z
      .array(
        z.object({ path: z.string().min(1), content: z.string().nullable() }),
      )
      .optional(),
    message: z.string().min(1).max(200),
  })
  .refine((v) => v.patch || v.files?.length, 'Indica patch o files');

export const agentPlanSchema = z.object({
  manifest: manifestSchema,
  note: z.string().max(500).optional(),
});

export const NOTE_TITLE_MAX = 120;

/**
 * Nota del agente para el timeline. Un título largo no se rechaza (los
 * agentes tienden a escribir párrafos): se acorta y el texto completo pasa
 * al detalle.
 */
export const agentNoteSchema = z
  .object({
    title: z.string().trim().min(1).max(2000),
    body: z.string().max(4000).default(''),
  })
  .transform(({ title, body }) =>
    title.length <= NOTE_TITLE_MAX
      ? { title, body }
      : {
          title: `${title.slice(0, NOTE_TITLE_MAX - 1).trimEnd()}…`,
          body: body ? `${title}\n\n${body}` : title,
        },
  );

export const agentInputRequestSchema = z.object({
  variables: z
    .array(
      z.object({
        key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
        description: z.string().min(1).max(500),
      }),
    )
    .min(1)
    .max(20),
});

export const agentReportSchema = z
  .object({
    /** unsupported: la app no se puede desplegar hoy (dependencias que no podemos levantar). */
    outcome: z.enum(['deployed', 'gave_up', 'unsupported']),
    summary: z.string().min(1).max(8000),
    /** unsupported: motivo en una frase, para el usuario (sin jerga de infraestructura). */
    reason: z.string().min(1).max(300).optional(),
  })
  .refine((v) => v.outcome !== 'unsupported' || v.reason, {
    message:
      'unsupported requiere reason (el motivo en una frase, para el usuario)',
    path: ['reason'],
  });

export const agentUsersSchema = z
  .array(
    z
      .object({
        email: z.string().min(1),
        password: z.string().min(1),
        role: z.string().optional(),
      })
      .loose(),
  )
  .max(20);

export const agentLogsQuerySchema = z.object({
  type: z.enum(['build', 'app']).default('build'),
  limit: z.coerce.number().int().min(1).max(1000).default(150),
});

export const agentContextQuerySchema = z.object({
  /** Segundos máximos a esperar a que termine el deploy en curso (long-poll). */
  wait: z.coerce.number().int().min(0).max(55).default(0),
});

export type AgentChangesBody = z.infer<typeof agentChangesSchema>;
export type AgentPlanBody = z.infer<typeof agentPlanSchema>;
export type AgentNoteBody = z.infer<typeof agentNoteSchema>;
export type AgentInputRequestBody = z.infer<typeof agentInputRequestSchema>;
export type AgentReportBody = z.infer<typeof agentReportSchema>;
export type AgentUsersBody = z.infer<typeof agentUsersSchema>;
export type AgentLogsQuery = z.infer<typeof agentLogsQuerySchema>;
export type AgentContextQuery = z.infer<typeof agentContextQuerySchema>;
