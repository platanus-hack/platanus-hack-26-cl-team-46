/**
 * Planner del scheduler (requisito B). Toma los ataques con su SchedulingMeta y
 * construye lanes de ejecución: **paralelo por defecto**, y **secuencia** cuando
 * un ataque depende de otro, necesita baseline limpio, o entra en mutex con otro
 * (contaminación de señales / alarma). El reporte explica por táctica por qué
 * quedó paralela o secuencial.
 */
import type { Attack } from './types.ts';

export interface Lane {
  index: number;
  attackIds: string[];
  solo: boolean;
}

export interface LaneExplanation {
  vuln_id: string;
  lane: number;
  parallelWith: string[];
  reason: string;
}

export interface SchedulePlan {
  lanes: Lane[];
  explanation: LaneExplanation[];
}

export function planSchedule(attacks: Attack[]): SchedulePlan {
  const byId = new Map(attacks.map((a) => [a.meta.id, a]));
  const inSet = (id: string) => byId.has(id);

  // Nivel por dependencia (ignora deps fuera del conjunto; corta ciclos).
  const levelMemo = new Map<string, number>();
  function level(id: string, stack: Set<string> = new Set()): number {
    if (levelMemo.has(id)) return levelMemo.get(id)!;
    if (stack.has(id)) return 0; // ciclo: cortar
    stack.add(id);
    const deps = (byId.get(id)?.scheduling?.dependsOn ?? []).filter(inSet);
    const lvl = deps.length ? 1 + Math.max(...deps.map((d) => level(d, stack))) : 0;
    stack.delete(id);
    levelMemo.set(id, lvl);
    return lvl;
  }

  // Orden: por nivel, baseline primero, luego orden del catálogo.
  const sorted = [...attacks].sort((a, b) => {
    const dl = level(a.meta.id) - level(b.meta.id);
    if (dl !== 0) return dl;
    const ba = a.scheduling?.needsCleanBaseline ? 0 : 1;
    const bb = b.scheduling?.needsCleanBaseline ? 0 : 1;
    if (ba !== bb) return ba - bb;
    return a.meta.order - b.meta.order;
  });

  const lanes: Lane[] = [];
  const laneOf = new Map<string, number>();
  const explanation: LaneExplanation[] = [];

  for (const a of sorted) {
    const id = a.meta.id;
    const deps = (a.scheduling?.dependsOn ?? []).filter(inSet);
    const baseline = !!a.scheduling?.needsCleanBaseline;
    const mutex = new Set(a.scheduling?.mutex ?? []);

    let minLane = 0;
    for (const d of deps) if (laneOf.has(d)) minLane = Math.max(minLane, laneOf.get(d)! + 1);

    let placed = -1;
    let mutexBlocked = false;
    for (let L = minLane; L < lanes.length; L++) {
      const lane = lanes[L];
      if (lane.solo) continue;
      if (baseline && lane.attackIds.length > 0) continue;
      const conflict = lane.attackIds.some(
        (other) => mutex.has(other) || (byId.get(other)?.scheduling?.mutex ?? []).includes(id),
      );
      if (conflict) {
        mutexBlocked = true;
        continue;
      }
      placed = L;
      break;
    }
    if (placed < 0) {
      lanes.push({ index: lanes.length, attackIds: [], solo: baseline });
      placed = lanes.length - 1;
    }
    if (baseline) lanes[placed].solo = true;
    lanes[placed].attackIds.push(id);
    laneOf.set(id, placed);

    let reason: string;
    if (deps.length) reason = `secuenciado: depende de ${deps.join(', ')}`;
    else if (baseline) reason = 'secuenciado: requiere baseline limpio (corre solo, antes de ensuciar señales)';
    else if (mutexBlocked && placed > minLane) reason = `secuenciado: mutex con ${[...mutex].join(', ')} (evita contaminar señales/alarma)`;
    else reason = 'paralelo: independiente';
    explanation.push({ vuln_id: id, lane: placed, parallelWith: [], reason });
  }

  // Completa parallelWith con los otros ataques de la misma lane.
  for (const e of explanation) {
    const lane = lanes[e.lane];
    e.parallelWith = lane.attackIds.filter((x) => x !== e.vuln_id);
  }

  return { lanes, explanation };
}
