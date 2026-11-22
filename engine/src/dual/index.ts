/**
 * Orquestador del camino dual A+B. Corre ambos EN PARALELO (Promise.all):
 *  - A (genérico): sondas deterministas derivadas del RepoModel, confirmadas con
 *    tráfico real → generalizan a cualquier app.
 *  - B (LLM): ángulos propuestos por el provider desde el RepoModel + recon.
 * Devuelve ambos y la matriz de cobertura (comparación + completitud).
 */
import type { AnalysisProvider } from '../providers/types.ts';
import type { RepoModel } from '../discovery/types.ts';
import type { TargetConfig } from '../core/types.ts';
import { compare } from './compare.ts';
import { generateProbes } from './generate.ts';
import { runGenericSuite } from './generic.ts';
import { runLlmAngles } from './llm.ts';
import { runGeneratedProbes } from './probe-spec.ts';
import type { DualResult } from './types.ts';

export { runGenericSuite } from './generic.ts';
export { runLlmAngles } from './llm.ts';
export { generateProbes } from './generate.ts';
export { runGeneratedProbes, gateProbe, runProbeSpec, type ProbeSpec, type GeneratedProbeResult } from './probe-spec.ts';
export { compare } from './compare.ts';
export type { DualResult, GenericFinding, CoverageReport, CoverageEntry } from './types.ts';

export async function runDualPath(
  target: TargetConfig,
  repo: RepoModel,
  opts: { provider?: AnalysisProvider; recon?: unknown; seed?: string; log?: (m: string) => void } = {},
): Promise<DualResult> {
  const log = opts.log ?? (() => {});
  const scopeOrigins = [new URL(target.url).origin];
  log('▶ dual: A (genérico) ∥ B (LLM: proponer → generar → gatear → ejecutar)');

  const [generic, bSide] = await Promise.all([
    runGenericSuite(target, repo, { seed: opts.seed, log }),
    (async () => {
      if (!opts.provider) return { llm: [], generated: [] };
      const llm = await runLlmAngles(opts.provider, { repo, recon: opts.recon, scopeOrigins });
      const specs = generateProbes(llm, repo);
      const generated = await runGeneratedProbes(target, specs, { seed: opts.seed, log });
      return { llm, generated };
    })(),
  ]);

  const coverage = compare(generic, bSide.llm, bSide.generated);
  const bConfirmed = bSide.generated.filter((g) => g.confirmed).length;
  const bRejected = bSide.generated.filter((g) => !g.gated).length;
  log(`  dual: A confirmó ${generic.filter((g) => g.confirmed).length} · B propuso ${bSide.llm.length}, generó ${bSide.generated.length} (confirmados ${bConfirmed}, rechazados por gate ${bRejected}) · acuerdo ${coverage.metrics.agreement}, solo-A ${coverage.metrics.generic_only}, solo-B ${coverage.metrics.llm_only}`);
  return { generic, llm: bSide.llm, generated: bSide.generated, coverage };
}
