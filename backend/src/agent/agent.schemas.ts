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

export const agentNoteSchema = z.object({
  title: z.string().min(1).max(120),
  body: z.string().max(4000).default(''),
});

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

export const agentReportSchema = z.object({
  outcome: z.enum(['deployed', 'gave_up']),
  summary: z.string().min(1).max(8000),
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
