import {
  activeElapsedMs,
  computeFacts,
  type IncidentFacts,
  type VulnStatus,
} from '../simulations/brain/facts.js';
import {
  BASE_CHANNELS,
  NOTIFY_CHANNELS,
  type SimulationRecord,
  type TimelineEvent,
} from '../simulations/simulation.types.js';

/**
 * Lo que Hinty sabe del simulacro que el developer está mirando. Sale del registro de la
 * simulación (el backend es la fuente de verdad), no de la pantalla:
 * - la app y sus canales;
 * - la "clave del profesor": la falla en juego, cómo la explota el atacante y si sigue adentro
 *   (secreta mientras corre: sirve para graduar las pistas, no para recitarla);
 * - lo que hizo el atacante y cómo evaluó el observador cada acción del developer;
 * - lo que el developer vio y pidió (lo mismo que tiene en pantalla, en orden);
 * - al terminar, el debrief y el reporte, para explicarlo todo.
 */
export type BriefSim = Pick<
  SimulationRecord,
  | 'status'
  | 'repo_url'
  | 'tools_detected'
  | 'context'
  | 'attack_plan'
  | 'state'
  | 'debrief'
  | 'report'
  | 'timeline'
>;

interface Finding {
  vuln_id: string;
  title?: string;
  file?: string;
  line?: number;
  evidence?: string;
  severity?: string;
  exploit_summary?: string;
  symptoms?: string;
  real_case?: string;
}

const STATUS: Record<VulnStatus, string> = {
  pending: 'todavía no parte',
  exploiting: 'el atacante lo está explotando ahora',
  exploited:
    'el atacante logró su objetivo y no ha sido contenido (sigue con el acceso que consiguió)',
  contained:
    'contenido: el atacante perdió el acceso, pero la falla sigue en el código',
  fixed: 'arreglado y verificado: ya no es explotable',
};

const SIM_PHASE: Record<string, string> = {
  starting: 'preparándose (todavía no parte el ataque)',
  ready: 'lista para partir (todavía no parte el ataque)',
  running: 'en curso',
  paused:
    'en pausa mientras habla contigo: el reloj del incidente y el atacante están detenidos',
  finished: 'terminada',
};

/** Lo que el developer ve en su pantalla (feed, chat, cambios). */
const SEEN = new Set([
  'notify',
  'user.message',
  'user.action',
  'coder.reply',
  'change.commit',
  'change.env',
  'change.restart',
  'change.db',
  'change.deployed',
  'change.deploy_failed',
]);
const ATTACK = /^attack\.(step|success|blocked|done|verify)$/;

function clip(s: unknown, n: number): string {
  const t = (typeof s === 'string' ? s : s == null ? '' : JSON.stringify(s))
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** T+mm:ss desde que partió el ataque (antes de partir, la hora). */
function rel(t: string, started?: string): string {
  if (!started) return t.slice(11, 19);
  const d = Date.parse(t) - Date.parse(started);
  return d < 0 ? `antes de partir` : `T+${mmss(d)}`;
}

function findingsOf(plan: BriefSim['attack_plan']): Map<string, Finding> {
  const list = Array.isArray(plan?.findings)
    ? (plan.findings as Finding[]).filter((f) => typeof f?.vuln_id === 'string')
    : [];
  return new Map(list.map((f) => [f.vuln_id, f]));
}

function channelsOf(s: BriefSim): string[] {
  const tools = (s.tools_detected ?? []).filter((t) =>
    (NOTIFY_CHANNELS as readonly string[]).includes(t),
  );
  return [...new Set([...BASE_CHANNELS, ...tools])];
}

function appBlock(s: BriefSim): string {
  const repo = s.repo_url.replace(/\/$/, '').split('/').slice(-2).join('/');
  const ctx = s.context;
  return [
    `## La app del developer`,
    `- Repo: ${repo}`,
    ctx?.summary && `- Qué es: ${clip(ctx.summary, 500)}`,
    ctx?.stack && `- Stack: ${clip(ctx.stack, 200)}`,
    `- Canales por donde le llegan avisos: ${channelsOf(s).join(', ')}. Si una herramienta (Sentry, Datadog…) no está en la lista, su repo no la tiene: se entera por clientes y compañeros.`,
  ]
    .filter(Boolean)
    .join('\n');
}

function findingLines(f: Finding | undefined, full: boolean): string[] {
  if (!f) return [];
  const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '';
  return [
    where || f.evidence
      ? `  - Dónde está la falla: ${[where, clip(f.evidence, 300)].filter(Boolean).join(' — ')}`
      : '',
    f.exploit_summary
      ? `  - Cómo lo explota el atacante: ${clip(f.exploit_summary, 300)}`
      : '',
    full && f.symptoms
      ? `  - Señales que puede ver el developer: ${clip(f.symptoms, 300)}`
      : '',
    f.severity ? `  - Severidad: ${f.severity}` : '',
    full && f.real_case
      ? `  - Caso real parecido: ${clip(f.real_case, 200)}`
      : '',
  ].filter(Boolean);
}

function vulnBlock(
  id: string,
  facts: IncidentFacts,
  findings: Map<string, Finding>,
  full: boolean,
): string {
  const v = facts.vulns[id];
  const f = findings.get(id);
  const verify = v.last_verify
    ? `  - Última verificación real después de un cambio: ${v.last_verify.still_exploitable ? 'sigue explotable' : 'ya no es explotable'}, ${v.last_verify.attacker_active ? 'el atacante conserva su acceso' : 'el atacante perdió su acceso'}.`
    : '';
  return [
    `- ${id}${f?.title ? ` (${clip(f.title, 80)})` : ''}: ${STATUS[v.status]}.`,
    ...findingLines(f, full),
    verify,
  ]
    .filter(Boolean)
    .join('\n');
}

function eventLine(e: TimelineEvent, started?: string): string {
  const at = rel(e.t, started);
  switch (e.type) {
    case 'notify': {
      const from = typeof e.raw?.from === 'string' ? ` de ${e.raw.from}` : '';
      return `${at} · aviso por ${e.source}${from} (${e.severity}): ${clip(e.title, 120)} — ${clip(e.body, 220)}`;
    }
    case 'user.message':
      return `${at} · el developer le pide a su agente: "${clip(e.body || e.title, 300)}"`;
    case 'coder.reply':
      return `${at} · su agente responde: "${clip(e.body || e.title, 280)}"`;
    case 'user.action':
      return `${at} · acción rápida: ${clip(e.title, 160)}`;
    default:
      return `${at} · ${e.type === 'change.deploy_failed' ? 'falló el despliegue' : 'cambio'}: ${clip(e.title, 160)}${e.body ? ` — ${clip(e.body, 160)}` : ''}`;
  }
}

function attackLine(e: TimelineEvent, started?: string): string {
  const raw = e.raw ?? {};
  const detail = [raw.technique, raw.request, raw.gained, raw.foothold]
    .filter((x) => x != null && x !== '')
    .map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
    .join(' · ');
  return `${rel(e.t, started)} · ${e.type}${e.vuln_id ? ` [${e.vuln_id}]` : ''}: ${clip(e.title, 140)}${detail ? ` — ${clip(detail, 220)}` : ''}`;
}

function assessmentsBlock(s: BriefSim, n: number): string {
  const list = (s.state?.assessments ?? []).slice(-n);
  if (!list.length) return '';
  return [
    `## Cómo se evaluó cada acción del developer (observador)`,
    ...list.map(
      (a) =>
        `- ${clip(a.action, 140)} → ${clip(a.verdict, 40)}: ${clip(a.why, 220)}`,
    ),
  ].join('\n');
}

function debriefBlock(debrief: Record<string, unknown>): string {
  const per = Array.isArray(debrief.per_vuln)
    ? (debrief.per_vuln as Array<Record<string, unknown>>)
    : [];
  return [
    `## Debrief (lo que ve en el historial al terminar)`,
    `- Resultado: ${clip(debrief.outcome, 40)} · puntaje ${clip(debrief.score, 6)}`,
    debrief.summary ? `- Resumen: ${clip(debrief.summary, 600)}` : '',
    ...per.map(
      (v) =>
        `- ${clip(v.vuln_id, 60)} (${clip(v.verdict, 20)}): qué pasó: ${clip(v.what_happened, 240)} · dónde: ${clip(v.where, 120)} · qué hizo: ${clip(v.what_you_did, 240)} · lo correcto: ${clip(v.correct_fix, 300)} · caso real: ${clip(v.real_case, 160)}`,
    ),
  ]
    .filter(Boolean)
    .join('\n');
}

function reportBlock(report: BriefSim['report']): string {
  const r = report?.result;
  if (!r) return '';
  return [
    `## Reporte final (pantalla "Ver reporte")`,
    `- Veredicto: ${r.verdict} · rango ${r.rank}${r.diagnosis ? ` · ${clip(r.diagnosis, 400)}` : ''}`,
    r.recommendations?.summary
      ? `- Cierre del coach: ${clip(r.recommendations.summary, 300)}`
      : '',
    ...(r.recommendations?.didWell ?? []).map(
      (d) => `- Hizo bien: ${clip(d, 200)}`,
    ),
    ...(r.recommendations?.improve ?? []).map(
      (i) => `- A mejorar: ${clip(i.point, 160)} (${clip(i.why, 200)})`,
    ),
    ...(r.fixes ?? []).map(
      (f) =>
        `- Arreglo pendiente en su repo real${f.done ? ' (ya hecho en la simulación)' : ''}: ${clip(f.title, 120)}${f.file ? ` en ${f.file}` : ''} — ${clip(f.steps?.join(' / '), 300)}`,
    ),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Lo último que vio y lo último que hizo, en orden. Los avisos llegan mucho más seguido que
 * los pedidos del developer: con un solo tope, sus pedidos y cambios quedarían fuera.
 */
function recentSeen(
  seen: TimelineEvent[],
  notices: number,
  actions: number,
): TimelineEvent[] {
  const keep = new Set([
    ...seen.filter((e) => e.type === 'notify').slice(-notices),
    ...seen.filter((e) => e.type !== 'notify').slice(-actions),
  ]);
  return seen.filter((e) => keep.has(e));
}

export function simBrief(s: BriefSim, now = Date.now()): string {
  const facts = computeFacts(s.timeline, s.attack_plan);
  const findings = findingsOf(s.attack_plan);
  const started = facts.started_t;
  const finished = s.status === 'finished';
  const attacked = facts.order.filter(
    (id) => facts.vulns[id].status !== 'pending',
  );
  const pending = facts.order.filter(
    (id) => facts.vulns[id].status === 'pending',
  );

  const status = [
    `## Estado del simulacro`,
    `- Fase: ${SIM_PHASE[s.status] ?? s.status}.`,
    started
      ? `- Tiempo activo del incidente: ${mmss(activeElapsedMs(s.timeline, started, now))} (sin contar las pausas).`
      : '',
    facts.order.length
      ? `- Incidentes del simulacro: ${facts.order.length}; ya atacados: ${attacked.length}.`
      : '',
    started
      ? `- ¿El atacante conserva algún acceso ahora? ${facts.attacker_active ? 'sí' : 'no'}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const seen = s.timeline.filter((e) => SEEN.has(e.type));
  const attacks = s.timeline.filter((e) => ATTACK.test(e.type));

  if (finished) {
    return [
      `# El simulacro que está mirando (TERMINADO: ya nada es secreto)`,
      appBlock(s),
      status,
      attacked.length
        ? [
            `## Lo que pasó con cada incidente`,
            ...attacked.map((id) => vulnBlock(id, facts, findings, true)),
          ].join('\n')
        : '- El ataque nunca partió: el developer cerró antes.',
      s.debrief ? debriefBlock(s.debrief) : '',
      reportBlock(s.report),
      assessmentsBlock(s, 8),
      attacks.length
        ? [
            `## Lo que hizo el atacante`,
            ...attacks.slice(-14).map((e) => attackLine(e, started)),
          ].join('\n')
        : '',
      seen.length
        ? [
            `## Lo que vio e hizo el developer (en orden)`,
            ...recentSeen(seen, 14, 20).map((e) => eventLine(e, started)),
          ].join('\n')
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  // En curso: lo último atacado primero, que es lo que el developer está viviendo.
  const inPlay = [...attacked].reverse();
  const key = inPlay.length
    ? [
        `## Tu clave de profesor (SECRETA: el developer no la ve; úsala para graduar tus pistas, nunca la recites)`,
        `Incidentes ya atacados, el más reciente primero:`,
        ...inPlay.map((id, i) => vulnBlock(id, facts, findings, i === 0)),
        pending.length
          ? `Quedan ${pending.length} incidente(s) por partir: no los menciones ni los anticipes.`
          : 'No quedan incidentes por partir.',
      ].join('\n')
    : [
        `## Tu clave de profesor (SECRETA)`,
        started
          ? '- El ataque partió pero el atacante todavía no toca ninguna falla.'
          : '- El ataque todavía no parte. No anticipes qué va a pasar: ayúdalo a orientarse en la pantalla.',
      ].join('\n');

  return [
    `# El simulacro que está mirando`,
    appBlock(s),
    status,
    key,
    attacks.length
      ? [
          `## Lo que hizo el atacante (SECRETO: el developer solo ve sus efectos)`,
          ...attacks.slice(-10).map((e) => attackLine(e, started)),
        ].join('\n')
      : '',
    assessmentsBlock(s, 5),
    seen.length
      ? [
          `## Lo que el developer ha visto y hecho (lo mismo que tiene en pantalla, en orden)`,
          ...recentSeen(seen, 12, 16).map((e) => eventLine(e, started)),
        ].join('\n')
      : `## Lo que el developer ha visto y hecho\n- Todavía nada.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
