/**
 * Convierte el diagnóstico en escenarios preconfigurados, versionados y
 * reproducibles. Genérico: el conocimiento (catálogo, storylines, namespace)
 * viene del plugin, no del core.
 */
import type { DiagnosisResult } from './diagnose.ts';
import type { AttackResult, EnginePlugin, Scenario } from './types.ts';

const SCHEMA_VERSION = '1';

function successCriteria(vulnId: string, plugin: EnginePlugin) {
  const meta = plugin.catalog[vulnId];
  return {
    detected: `El developer identifica el síntoma y lo atribuye a ${meta.title.toLowerCase()}.`,
    contained: meta.fix_correct,
    traps: meta.fix_wrong,
  };
}

export function buildScenario(attack: AttackResult, diag: DiagnosisResult, plugin: EnginePlugin): Scenario {
  const meta = plugin.catalog[attack.vuln_id];
  // El seed de la corrida (--seed) gobierna la reproducibilidad del escenario.
  const seed = diag.seed;

  return {
    scenario_id: `${plugin.scenarioNamespace}.${attack.vuln_id}`,
    version: `${SCHEMA_VERSION}.${meta.order}+${seed}`,
    seed,
    vuln_id: attack.vuln_id,
    title: meta.title,
    meta,
    entry_point: attack.steps[0]?.request ?? meta.code_location,
    attack,
    storyline: plugin.storylines[attack.vuln_id] ?? [],
    success_criteria: successCriteria(attack.vuln_id, plugin),
    created_at: new Date().toISOString(),
    target: { url: diag.target.url, commit: diag.target.commit },
  };
}

/** Un escenario por vulnerabilidad CONFIRMADA. */
export function buildScenarioPack(diag: DiagnosisResult, plugin: EnginePlugin): Scenario[] {
  return diag.results
    .filter((r) => r.confirmed)
    .map((r) => buildScenario(r, diag, plugin))
    .sort((a, b) => a.meta.order - b.meta.order);
}
