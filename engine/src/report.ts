/**
 * Genera la "Guía del hackeo": el paso a paso enseñable de cada ataque real que
 * se confirmó, con evidencia, mapeo ATT&CK/D3FEND, caso real, fix correcto y
 * fixes equivocados. Es el material con el que el simulador enseña al developer.
 */
import { CATALOG } from './catalog.ts';
import type { DiagnosisResult } from './diagnose.ts';
import type { ReconReport } from './recon.ts';
import type { AttackResult, Scenario } from './types.ts';

function statusTag(r: AttackResult): string {
  if (r.confirmed) return '🔴 CONFIRMADA';
  if (r.error) return '⚠️ error de ejecución';
  if (r.blocked) return '🟢 bloqueada (defensa activa)';
  return '⚪ no confirmada';
}

function fmtExchange(request: string, status?: number): string {
  return status !== undefined ? `${request} → HTTP ${status}` : request;
}

export function renderGuide(diag: DiagnosisResult, scenarios: Scenario[], recon?: ReconReport): string {
  const L: string[] = [];
  const confirmed = diag.results.filter((r) => r.confirmed);

  L.push('# Guía del hackeo — diagnóstico real de "Apuntes"');
  L.push('');
  L.push('> Generada por el motor de hacking a partir de una pasada de ataques **reales** contra el sandbox autorizado.');
  L.push('> Cada paso es tráfico HTTP efectivamente ejecutado y capturado. Material de enseñanza para el simulador.');
  L.push('');
  L.push(`- **Target:** ${diag.target.url}`);
  if (diag.target.commit) L.push(`- **Commit:** ${diag.target.commit}`);
  L.push(`- **Corrida:** ${diag.started_at} → ${diag.finished_at} (${(diag.duration_ms / 1000).toFixed(1)}s)`);
  L.push(`- **Perfil de emulación:** ${diag.profile}`);
  L.push(`- **Resultado:** ${diag.summary.confirmed}/${diag.summary.total} vulnerabilidades confirmadas · atacante activo al cierre: ${diag.summary.attacker_active ? 'sí' : 'no'}`);
  L.push(`- **Requests capturados:** ${diag.summary.requests}`);
  L.push('');

  // Tabla resumen
  L.push('## Resumen');
  L.push('');
  L.push('| # | Vulnerabilidad | Severidad | Estado | Qué ganó el atacante |');
  L.push('|---|---|---|---|---|');
  for (const r of diag.results.sort((a, b) => order(a) - order(b))) {
    const m = metaOf(scenarios, r.vuln_id);
    L.push(`| ${m.order} | ${m.title} | ${m.severity} | ${statusTag(r)} | ${r.gained[0] ?? '—'} |`);
  }
  L.push('');

  // Recon: superficie de ataque
  if (recon) {
    L.push('## Reconocimiento (superficie de ataque)');
    L.push('');
    L.push(`Barrido de ${recon.surface_summary.probed} rutas: ${recon.surface_summary.present} presentes, ${recon.surface_summary.auth_gaps} brechas de autorización, ${recon.surface_summary.injectable} puntos inyectables.`);
    if (recon.jwt) L.push(`JWT: alg ${recon.jwt['alg']}, vida ${recon.jwt['lifetime_days']} días, claims [${(recon.jwt['claims'] as string[])?.join(', ')}].`);
    L.push('');
    L.push('| Severidad | Categoría | Hallazgo | Ángulo |');
    L.push('|---|---|---|---|');
    for (const f of [...recon.findings].sort((a, b) => sevRank(b.severity) - sevRank(a.severity))) {
      L.push(`| ${f.severity} | ${f.category} | ${f.title} | ${f.angle ? `\`${f.angle}\`` : '—'} |`);
    }
    L.push('');
  }

  // Cadena de ataque confirmada
  if (confirmed.length > 0) {
    L.push('## Cadena de ataque (lo que confirmamos de punta a punta)');
    L.push('');
    confirmed
      .sort((a, b) => order(a) - order(b))
      .forEach((r, i) => L.push(`${i + 1}. **${metaOf(scenarios, r.vuln_id).title}** — ${r.summary}`));
    L.push('');
  }

  // Detalle por vuln confirmada
  L.push('## Paso a paso por vulnerabilidad');
  L.push('');
  for (const sc of scenarios) {
    const r = sc.attack;
    const m = sc.meta;
    L.push(`### ${m.order}. ${m.title}  ${statusTag(r)}`);
    L.push('');
    L.push(`- **vuln_id:** \`${m.id}\` · **severidad:** ${m.severity} · **dificultad:** ${m.difficulty}/5`);
    L.push(`- **Dónde (código):** ${m.code_location}`);
    L.push(`- **OWASP:** ${m.owasp.join('; ')}`);
    L.push(`- **MITRE ATT&CK:** ${m.mitre_attack.join('; ')}`);
    if (m.mitre_atlas) L.push(`- **MITRE ATLAS:** ${m.mitre_atlas.join('; ')}`);
    L.push(`- **CWE:** ${m.cwe.join('; ')}`);
    L.push('');
    L.push('**Paso a paso del ataque (tráfico real):**');
    L.push('');
    r.steps.forEach((s, i) => {
      L.push(`${i + 1}. _${s.technique}_${s.mitre ? ` (${s.mitre.join(', ')})` : ''}`);
      L.push(`   - \`${fmtExchange(s.request, s.exchange?.status)}\``);
      L.push(`   - ${s.response_summary}`);
      if (s.note) L.push(`   - 💡 ${s.note}`);
    });
    L.push('');
    if (r.data_exfiltrated) {
      L.push(`**Datos exfiltrados:** tabla \`${r.data_exfiltrated.table}\`, ${r.data_exfiltrated.rows} filas.`);
      L.push('');
      L.push('```json');
      L.push(JSON.stringify(r.data_exfiltrated.sample, null, 2));
      L.push('```');
      L.push('');
    }
    L.push(`**Diagnóstico:** ${r.summary}`);
    L.push('');
    L.push(`**Contramedida (D3FEND):** ${m.d3fend.join(' · ')}`);
    L.push('');
    L.push(`**Arreglo correcto:** ${m.fix_correct}`);
    L.push('');
    L.push('**Arreglos equivocados comunes (trampas del simulador):**');
    m.fix_wrong.forEach((w) => L.push(`- ${w}`));
    L.push('');
    L.push(`**Caso real:** ${m.real_case}`);
    L.push('');
    L.push(`**Lección:** ${m.teaching}`);
    L.push('');
    L.push('---');
    L.push('');
  }

  // No confirmadas / bloqueadas / errores
  const rest = diag.results.filter((r) => !r.confirmed);
  if (rest.length > 0) {
    L.push('## No confirmadas en esta corrida');
    L.push('');
    for (const r of rest) {
      L.push(`- **${r.vuln_id}** — ${statusTag(r)}: ${r.summary}`);
    }
    L.push('');
  }

  return L.join('\n');

  function order(r: AttackResult): number {
    return metaOf(scenarios, r.vuln_id).order;
  }
}

function sevRank(s: string): number {
  return { info: 0, low: 1, medium: 2, high: 3, critical: 4 }[s] ?? 0;
}

function metaOf(scenarios: Scenario[], vulnId: string) {
  const sc = scenarios.find((s) => s.vuln_id === vulnId);
  if (sc) return sc.meta;
  return CATALOG[vulnId];
}
