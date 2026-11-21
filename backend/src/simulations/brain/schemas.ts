import { z } from 'zod';
import type { NotifyChannel } from '../simulation.types.js';

/**
 * Esquemas de salida de cada tarea del cerebro. Todos los campos son
 * obligatorios (con `null` cuando no aplica) para que la salida estructurada
 * sea estricta y no haya formatos inventados (p. ej. severity "medium").
 */

export const severitySchema = z.enum(['info', 'warning', 'critical']);

export const contextSchema = z.object({
  summary: z
    .string()
    .describe('Qué es la app, para quién y qué datos maneja (2-4 frases)'),
  stack: z.string(),
  architecture: z
    .string()
    .describe(
      'Servicios, base de datos, cómo autentica y dónde están las rutas',
    ),
  endpoints: z.array(z.string()),
  personas: z.array(
    z.object({
      name: z.string(),
      email: z.string().nullable(),
      role: z.string().nullable(),
      notes: z.string().nullable(),
    }),
  ),
  notes: z.string().describe('Lo que otro agente debería saber de la app'),
});
export type ContextOutput = z.infer<typeof contextSchema>;

export function generatorSchema(channels: NotifyChannel[]) {
  return z.object({
    notifications: z
      .array(
        z.object({
          channel: z.enum(channels as [NotifyChannel, ...NotifyChannel[]]),
          title: z.string(),
          body: z.string(),
          from: z
            .string()
            .nullable()
            .describe(
              '"Nombre <email>" en email/support/phone; null en el resto',
            ),
          severity: severitySchema,
          vuln_id: z.string().nullable(),
        }),
      )
      .describe('Entre 0 y 3 notificaciones'),
  });
}
export type GeneratorOutput = z.infer<ReturnType<typeof generatorSchema>>;

export const vulnStatusSchema = z.enum([
  'pending',
  'exploiting',
  'exploited',
  'contained',
  'fixed',
]);

export const observerSchema = z.object({
  phase: z.enum([
    'preparing',
    'under_attack',
    'containment',
    'recovered',
    'finished',
  ]),
  current_vuln: z.string().nullable(),
  vulns: z.array(
    z.object({
      vuln_id: z.string(),
      status: vulnStatusSchema,
      note: z.string(),
    }),
  ),
  compromised: z.array(z.string()),
  assessments: z.array(
    z.object({
      action: z.string(),
      verdict: z.enum(['correct', 'partial', 'wrong', 'neutral']),
      why: z.string(),
    }),
  ),
  summary: z.string(),
});
export type ObserverOutput = z.infer<typeof observerSchema>;

export const debriefSchema = z.object({
  summary: z.string().describe('Qué pasó, en 3 a 5 frases'),
  outcome: z.enum(['contained', 'partially_contained', 'breached']),
  per_vuln: z.array(
    z.object({
      vuln_id: z.string(),
      what_happened: z.string(),
      where: z.string().describe('archivo:línea'),
      what_you_did: z.string(),
      verdict: z.enum(['correct', 'partial', 'wrong']),
      correct_fix: z.string(),
      real_case: z.string(),
    }),
  ),
  highlights: z.array(z.string()),
  score: z.number().int().describe('De 0 a 100'),
});
export type DebriefOutput = z.infer<typeof debriefSchema>;
