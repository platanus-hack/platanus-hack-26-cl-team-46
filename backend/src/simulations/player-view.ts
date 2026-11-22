import type { IncidentState } from './simulation.types.js';

/**
 * Vista del jugador mientras el incidente sigue vivo: sin la hoja de respuestas interna.
 * Se quita el plan del atacante (archivo, línea y cómo se explota cada falla) y el estado
 * interno del incidente (vuln en curso, si el atacante sigue adentro, verificaciones), que
 * ninguna pantalla del jugador muestra.
 * Los hallazgos del motor se dejan completos, archivo y línea incluidos: el informe del motor
 * los muestra detrás del switch "Ver spoilers" (EngineFirstPass), que el jugador activa a
 * propósito; esconderlos aquí rompería ese switch sin proteger nada.
 */

interface PlanLike {
  findings?: unknown;
  [k: string]: unknown;
}

interface EngineLike<F extends { file?: string; line?: number }> {
  findings: F[];
  played: string[];
  current: string | null;
  verifies: unknown[];
}

export interface LiveSensitiveView<F extends { file?: string; line?: number }> {
  attack_plan: PlanLike | null;
  engine: EngineLike<F> | null;
  state: IncidentState | null;
}

export function playerSafeView<
  F extends { file?: string; line?: number },
  T extends LiveSensitiveView<F>,
>(view: T): Omit<T, 'state'> & { state: { phase: string } | null } {
  return {
    ...view,
    attack_plan: view.attack_plan ? safePlan(view.attack_plan) : null,
    engine: view.engine
      ? {
          ...view.engine,
          played: [],
          current: null,
          verifies: [],
        }
      : null,
    // La fase sirve para mostrar en qué va el incidente; el resto es interno.
    state: view.state ? { phase: view.state.phase } : null,
  };
}

/** Solo cuántos hallazgos hay y su severidad (la UI solo pregunta si el plan existe). */
function safePlan(plan: PlanLike): PlanLike {
  const findings = Array.isArray(plan.findings)
    ? (plan.findings as Array<Record<string, unknown>>).map((f) => ({
        vuln_id: f.vuln_id,
        severity: f.severity,
        ...(f.order !== undefined ? { order: f.order } : {}),
      }))
    : [];
  return { findings };
}
