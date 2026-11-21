/**
 * Diagnóstico estructurado (requisito I): el diagnóstico es capacidad principal.
 * Combina el resultado dinámico, el catálogo y la correlación con el repo para
 * emitir, por vulnerabilidad: veredicto (confirmada/no/inconcluso) con confianza,
 * chequeos de falso positivo, causa raíz (con archivo/línea), cadena, impacto,
 * remediación y re-verificación tras parche.
 */
import type { DiagnosisResult } from './diagnose.ts';
import type { AttackResult, EnginePlugin } from './types.ts';

export interface CodeRef {
  file: string;
  line?: number;
  commit: string;
}

export type Verdict = 'confirmed' | 'not-confirmed' | 'inconclusive';

export interface Diagnosis {
  vuln_id: string;
  title: string;
  verdict: Verdict;
  confidence: number; // 0..1
  false_positive_checks: string[];
  root_cause: { summary: string; ref?: CodeRef };
  attack_chain: string[];
  impact: string;
  evidence_count: number;
  remediation: { correct: string; wrong_fixes: string[] };
  reverify: { instructions: string; after_patch: boolean; still_exploitable?: boolean };
  variant_used?: string;
}

function verdictOf(r: AttackResult): Verdict {
  if (r.confirmed) return 'confirmed';
  if (r.error) return 'inconclusive';
  return 'not-confirmed';
}

function confidenceOf(r: AttackResult): number {
  if (typeof r.confidence === 'number' && r.confidence > 0) return r.confidence;
  if (r.confirmed) return r.data_exfiltrated ? 0.95 : 0.9;
  if (r.blocked) return 0.8; // defensa observada
  if (r.error) return 0.3;
  return 0.6;
}

function fpChecks(r: AttackResult): string[] {
  const n = r.steps.filter((s) => s.exchange).length;
  if (r.confirmed) {
    const out = [`Verificado con tráfico real: ${n} intercambio(s) HTTP capturado(s).`];
    if (r.data_exfiltrated) out.push(`Datos reales exfiltrados (${r.data_exfiltrated.table}, ${r.data_exfiltrated.rows} filas): no es un falso positivo por patrón.`);
    if (r.foothold) out.push(`Foothold efectivo obtenido (${r.foothold.type}).`);
    return out;
  }
  if (r.blocked) return ['Una defensa respondió (p. ej. rate limit / authz): no explotable en esta corrida.'];
  if (r.error) return ['Error de ejecución del módulo, no de la app: inconcluso, re-correr.'];
  return ['No se reprodujo con el payload probado: podría necesitar otra variante.'];
}

function impactOf(r: AttackResult): string {
  const parts: string[] = [];
  if (r.gained.length) parts.push(r.gained.join('; '));
  if (r.data_exfiltrated) parts.push(`exfiltración de ${r.data_exfiltrated.rows} filas de ${r.data_exfiltrated.table}`);
  if (r.attacker_active) parts.push('acceso del atacante persiste al cierre');
  return parts.join(' · ') || 'sin impacto demostrado en esta corrida';
}

export function buildDiagnoses(
  diag: DiagnosisResult,
  plugin: EnginePlugin,
  refs?: Record<string, CodeRef | undefined>,
): Diagnosis[] {
  return diag.results
    .map((r) => {
      const m = plugin.catalog[r.vuln_id];
      const chain = (plugin.storylines[r.vuln_id] ?? []).map((b) => b.fact);
      return {
        vuln_id: r.vuln_id,
        title: m.title,
        verdict: verdictOf(r),
        confidence: confidenceOf(r),
        false_positive_checks: fpChecks(r),
        root_cause: { summary: m.code_location, ref: refs?.[r.vuln_id] },
        attack_chain: chain.length ? chain : r.steps.map((s) => s.technique),
        impact: impactOf(r),
        evidence_count: r.steps.filter((s) => s.exchange).length,
        remediation: { correct: m.fix_correct, wrong_fixes: m.fix_wrong },
        reverify: {
          instructions: `Tras parchar, re-correr: node src/cli/run.ts --url <target> --only ${r.vuln_id}`,
          after_patch: false,
        },
        variant_used: r.variant_used,
      } satisfies Diagnosis;
    })
    .sort((a, b) => plugin.catalog[a.vuln_id].order - plugin.catalog[b.vuln_id].order);
}
