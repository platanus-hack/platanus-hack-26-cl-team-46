/**
 * Comparación/completitud de los dos caminos. A (genérico) confirma con tráfico
 * real; B (LLM) propone ángulos y, con los probes generados+gateados, también
 * confirma. Cruzarlos da: acuerdo (ambos confirman → máxima confianza), solo-A
 * (A más preciso / B incompleto) y solo-B (B aporta algo que A no cubre).
 */
import type { ProposedAngle } from '../providers/types.ts';
import type { GeneratedProbeResult } from './probe-spec.ts';
import type { CoverageEntry, CoverageReport, GenericFinding } from './types.ts';

export function compare(generic: GenericFinding[], llm: ProposedAngle[], generated: GeneratedProbeResult[] = []): CoverageReport {
  const classes = new Set<string>();
  for (const g of generic) classes.add(g.vuln_class);
  for (const a of llm) if (a.vuln_id) classes.add(a.vuln_id);
  for (const g of generated) if (g.confirmed) classes.add(g.spec.vuln_class); // solo los confirmados entran a la matriz

  const entries: CoverageEntry[] = [...classes].map((cls) => {
    const g = generic.find((x) => x.vuln_class === cls && x.confirmed);
    const generic_confirmed = !!g;
    const llm_proposed = llm.some((a) => a.vuln_id === cls);
    const llm_confirmed = generated.some((x) => x.spec.vuln_class === cls && x.confirmed);
    const llmSide = llm_proposed || llm_confirmed;
    const status: CoverageEntry['status'] = generic_confirmed && llmSide ? 'both' : generic_confirmed ? 'generic-only' : 'llm-only';
    const note =
      status === 'both'
        ? llm_confirmed
          ? 'A y B lo confirmaron con tráfico real → máxima confianza.'
          : 'A lo confirmó y B lo propuso → alta confianza.'
        : status === 'generic-only'
          ? 'A lo confirmó; B no lo cubrió → A más preciso / B incompleto.'
          : llm_confirmed
            ? 'B lo confirmó con un probe generado; A no lo cubre → B aporta completitud.'
            : 'B lo propuso; A no lo cubre → lead a investigar (clase no genérica).';
    return { vuln_class: cls, generic_confirmed, llm_proposed, llm_confirmed, status, where: g?.where, note };
  }).sort((a, b) => a.vuln_class.localeCompare(b.vuln_class));

  const metrics = {
    total: entries.length,
    agreement: entries.filter((e) => e.status === 'both').length,
    generic_only: entries.filter((e) => e.status === 'generic-only').length,
    llm_only: entries.filter((e) => e.status === 'llm-only').length,
  };
  return { entries, metrics, unified: [...classes].sort() };
}
