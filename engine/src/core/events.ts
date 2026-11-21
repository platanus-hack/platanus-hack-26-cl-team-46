/**
 * Traduce los resultados del motor al contrato de eventos del backend
 * (backend/src/simulations/simulation.types.ts). Así el mismo diagnóstico sirve
 * para producir el `attack.plan` y el replay de `attack.*` que consume el
 * simulador por el contrato `hacker: "external"`.
 */
import type { DiagnosisResult } from './diagnose.ts';
import type { ReconReport } from './recon.ts';
import type { AttackResult, EnginePlugin, EventSeverity } from './types.ts';

function toEventSeverity(sev: string): EventSeverity {
  if (sev === 'critical') return 'critical';
  if (sev === 'high' || sev === 'medium') return 'warning';
  return 'info';
}

/** raw del evento `attack.plan`: hallazgos ordenados (formato del analizador). */
export function buildAttackPlan(diag: DiagnosisResult, plugin: EnginePlugin, recon?: ReconReport) {
  const findings = diag.results
    .map((r) => {
      const m = plugin.catalog[r.vuln_id];
      return {
        vuln_id: r.vuln_id,
        title: m.title,
        severity: m.severity,
        difficulty: m.difficulty,
        order: m.order,
        location: m.code_location,
        confirmed: r.confirmed,
        owasp: m.owasp,
        mitre_attack: m.mitre_attack,
        entry_point: r.steps[0]?.request ?? null,
        summary: r.summary,
      };
    })
    .sort((a, b) => a.order - b.order);

  return {
    t: new Date().toISOString(),
    vuln_id: null,
    source: 'agent',
    severity: 'info' as EventSeverity,
    title: `Plan de ataque: ${findings.filter((f) => f.confirmed).length}/${findings.length} vulns confirmadas`,
    body: `Diagnóstico real contra ${diag.target.url}.`,
    raw: {
      findings,
      target: diag.target.url,
      recon: recon
        ? {
            surface: recon.surface_summary,
            tech: recon.tech,
            jwt: recon.jwt,
            angles: recon.findings.map((f) => ({ category: f.category, severity: f.severity, title: f.title, angle: f.angle })),
          }
        : undefined,
    },
  };
}

/** Secuencia de eventos `attack.*` para el replay de una vuln (view=all). */
export function toTimelineEvents(r: AttackResult, plugin: EnginePlugin) {
  const m = plugin.catalog[r.vuln_id];
  const sev = toEventSeverity(m.severity);
  const events: Array<Record<string, unknown>> = [];

  for (const s of r.steps) {
    events.push({
      type: 'attack.step',
      vuln_id: r.vuln_id,
      source: 'attacker',
      severity: 'info',
      title: s.technique,
      body: `${s.request} — ${s.response_summary}`,
      raw: {
        technique: s.technique,
        request: s.request,
        response_summary: s.response_summary,
        mitre: s.mitre,
        ip: s.exchange?.reqHeaders?.['x-forwarded-for'],
        user_agent: s.exchange?.reqHeaders?.['user-agent'],
      },
    });
  }

  if (r.confirmed) {
    events.push({
      type: 'attack.success',
      vuln_id: r.vuln_id,
      source: 'attacker',
      severity: sev,
      title: `Explotada: ${m.title}`,
      body: r.summary,
      raw: {
        gained: r.gained,
        foothold: r.foothold,
        data_exfiltrated: r.data_exfiltrated,
      },
    });
  } else if (r.blocked) {
    events.push({
      type: 'attack.blocked',
      vuln_id: r.vuln_id,
      source: 'attacker',
      severity: 'info',
      title: `Bloqueada: ${m.title}`,
      body: r.summary,
      raw: {},
    });
  }

  events.push({
    type: 'attack.done',
    vuln_id: r.vuln_id,
    source: 'attacker',
    severity: 'info',
    title: `Fin del ataque a ${r.vuln_id}`,
    body: r.summary,
    raw: { vuln_id: r.vuln_id, attacker_active: r.attacker_active },
  });

  return events;
}
