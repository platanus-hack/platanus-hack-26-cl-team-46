/**
 * Comparación/completitud de los dos caminos. A (genérico) confirma con tráfico
 * real; B (LLM) propone. Cruzarlos da: acuerdo (ambos → alta confianza), solo-A
 * (A más preciso / B incompleto) y solo-B (lead a investigar / clase no genérica).
 */
import type { ProposedAngle } from '../providers/types.ts';
import type { CoverageEntry, CoverageReport, GenericFinding } from './types.ts';

export function compare(generic: GenericFinding[], llm: ProposedAngle[]): CoverageReport {
  const classes = new Set<string>();
  for (const g of generic) classes.add(g.vuln_class);
  for (const a of llm) if (a.vuln_id) classes.add(a.vuln_id);

  const entries: CoverageEntry[] = [...classes].map((cls) => {
    const g = generic.find((x) => x.vuln_class === cls && x.confirmed);
    const generic_confirmed = !!g;
    const llm_proposed = llm.some((a) => a.vuln_id === cls);
    const status: CoverageEntry['status'] = generic_confirmed && llm_proposed ? 'both' : generic_confirmed ? 'generic-only' : 'llm-only';
    const note =
      status === 'both'
        ? 'A lo confirmó con tráfico real y B lo propuso → alta confianza.'
        : status === 'generic-only'
          ? 'A lo confirmó; B no lo propuso → A más preciso / B incompleto.'
          : 'B lo propuso; A no lo cubre → lead a investigar (clase no genérica o fuera de la superficie probada).';
    return { vuln_class: cls, generic_confirmed, llm_proposed, status, where: g?.where, note };
  }).sort((a, b) => a.vuln_class.localeCompare(b.vuln_class));

  const metrics = {
    total: entries.length,
    agreement: entries.filter((e) => e.status === 'both').length,
    generic_only: entries.filter((e) => e.status === 'generic-only').length,
    llm_only: entries.filter((e) => e.status === 'llm-only').length,
  };
  return { entries, metrics, unified: [...classes].sort() };
}
