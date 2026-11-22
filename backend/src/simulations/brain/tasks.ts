import type {
  IncidentState,
  NotifyChannel,
  SimContext,
  SimulationRecord,
  TimelineEvent,
} from '../simulation.types.js';
import { computeFacts, type IncidentFacts } from './facts.js';
import type { SimLlm, StructuredResult, TaskModel } from './llm.client.js';
import {
  CONTEXT_SYSTEM,
  DEBRIEF_SYSTEM,
  GENERATOR_SYSTEM,
  OBSERVER_SYSTEM,
} from './prompts.js';
import {
  contextSchema,
  debriefSchema,
  generatorSchema,
  observerSchema,
  type ContextOutput,
  type DebriefOutput,
  type GeneratorOutput,
  type ObserverOutput,
} from './schemas.js';

/**
 * Las cuatro tareas del cerebro como funciones puras sobre el registro de la
 * simulación: arman el prompt, llaman al modelo y devuelven la salida lista
 * para publicar. Las usan el SimulationBrain (en vivo) y el script de replay.
 */

type SimView = Pick<
  SimulationRecord,
  'sim_id' | 'status' | 'timeline' | 'attack_plan' | 'state' | 'context'
>;

export interface AppInfo {
  deployed_url: string | null;
  seed_users: Array<{ email: string; role?: string }>;
}

// ------------------------------------------------------------ formato

/** Texto de un campo del plan (que viene de un LLM y puede no ser string). */
function txt(v: unknown, fallback: string): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : fallback;
}

function clip(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function hhmmss(t: string) {
  return t.slice(11, 19);
}

export function fmtEvent(
  e: TimelineEvent,
  opts: { body?: number; raw?: number } = {},
): string {
  const { body = 600, raw = 800 } = opts;
  const head = `#${e.seq} ${hhmmss(e.t)} · ${e.actor} · ${e.type}${e.vuln_id ? ` · vuln=${e.vuln_id}` : ''}${e.severity !== 'info' ? ` · ${e.severity}` : ''} — ${e.title}`;
  const b =
    e.body && body > 0
      ? `\n  ${clip(e.body, body).replace(/\n/g, '\n  ')}`
      : '';
  const r =
    raw > 0 && Object.keys(e.raw ?? {}).length
      ? `\n  raw: ${clip(JSON.stringify(e.raw), raw)}`
      : '';
  return head + b + r;
}

function section(title: string, lines: string[], empty = '(nada)') {
  return `## ${title}\n${lines.length ? lines.join('\n') : empty}`;
}

/** El observer no necesita cómo se explota cada vuln (y ese detalle gatilla los clasificadores de seguridad). */
function planForObserver(s: SimView): Array<Record<string, unknown>> {
  return findings(s).map(({ exploit_summary: _omit, ...rest }) => rest);
}

function findings(s: SimView): Array<Record<string, unknown>> {
  const f = s.attack_plan?.findings;
  return Array.isArray(f) ? (f as Array<Record<string, unknown>>) : [];
}

function contextBlock(ctx: SimContext | undefined | null, app: AppInfo) {
  return [
    `App desplegada: ${app.deployed_url ?? '(sin URL)'}`,
    `Usuarios seed: ${app.seed_users.map((u) => `${u.email}${u.role ? ` (${u.role})` : ''}`).join(', ') || '(ninguno)'}`,
    ctx
      ? `Contexto de la app:\n${JSON.stringify(
          {
            summary: ctx.summary,
            stack: ctx.stack,
            architecture: ctx.architecture,
            personas: ctx.personas,
            notes: ctx.notes,
          },
          null,
          1,
        )}`
      : 'Contexto de la app: (todavía no está listo)',
  ].join('\n');
}

export function factsBlock(f: IncidentFacts): string {
  const lines = f.order.map((id) => {
    const v = f.vulns[id];
    const verify = v.last_verify
      ? ` · última verificación #${v.last_verify.seq}: still_exploitable=${v.last_verify.still_exploitable}, attacker_active=${v.last_verify.attacker_active}`
      : '';
    return `- ${id}: ${v.status}${verify}`;
  });
  return [
    `Atacante adentro (según su último reporte): ${f.attacker_active ? 'sí' : 'no'}`,
    `Ataque en curso: ${f.attack_in_progress ? 'sí' : 'no'}`,
    f.pending_verifies.length
      ? `Verificaciones pendientes: ${f.pending_verifies.join(', ')}`
      : 'Verificaciones pendientes: ninguna',
    ...lines,
  ].join('\n');
}

const STORY_TYPES =
  /^(attack\.|change\.|user\.action|control\.(start|next|pause|resume|finish)|sim\.status)/;

// ------------------------------------------------------------ context

export interface RepoFile {
  path: string;
  content: string;
}

export function contextPrompt(input: {
  files: RepoFile[];
  tree: string[];
  app: AppInfo;
  deployNotes?: string;
}): string {
  return [
    section(
      'Usuarios seed (personas reales de la app)',
      input.app.seed_users.map(
        (u) => `- ${u.email}${u.role ? ` (${u.role})` : ''}`,
      ),
    ),
    input.deployNotes
      ? section('Notas del agente que desplegó la app', [input.deployNotes])
      : '',
    section(
      'Archivos del repo',
      input.tree.map((p) => `- ${p}`),
    ),
    ...input.files.map((f) => `## ${f.path}\n\`\`\`\n${f.content}\n\`\`\``),
    'Devuelve el paquete de contexto de esta app.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function runContext(
  llm: SimLlm,
  model: TaskModel,
  input: Parameters<typeof contextPrompt>[0],
): Promise<StructuredResult<ContextOutput>> {
  return llm.structured({
    model,
    system: CONTEXT_SYSTEM,
    prompt: contextPrompt(input),
    schema: contextSchema,
  });
}

/** El formato que esperan los demás agentes (SimContext): personas sin nulls. */
export function toSimContext(out: ContextOutput): SimContext {
  return {
    summary: out.summary,
    stack: out.stack,
    architecture: out.architecture,
    endpoints: out.endpoints,
    personas: out.personas.map((p) => ({
      name: p.name,
      ...(p.email ? { email: p.email } : {}),
      ...(p.role ? { role: p.role } : {}),
      ...(p.notes ? { notes: p.notes } : {}),
    })),
    notes: out.notes,
  };
}

// ------------------------------------------------------------ generator

export function generatorPrompts(
  s: SimView,
  channels: NotifyChannel[],
  app: AppInfo,
  pending: TimelineEvent[],
  now = new Date().toISOString(),
  instruction = 'Devuelve entre 0 y 3 notificaciones nuevas.',
) {
  const firstNew = pending[0]?.seq ?? Infinity;
  const stable = [
    `## Canales permitidos\n${channels.join(', ')}`,
    `## La app\n${contextBlock(s.context, app)}`,
    section(
      'Plan del atacante (interno: úsalo para que los síntomas calcen con el código, nunca para nombrar la vuln)',
      findings(s).map(
        (f) =>
          `- ${String(f.vuln_id)} (${txt(f.file, '?')}:${txt(f.line, '?')}): ${clip(txt(f.symptoms, ''), 300)}`,
      ),
    ),
  ].join('\n\n');

  const sent = s.timeline
    .filter((e) => e.type === 'notify' && e.seq < firstNew)
    .slice(-12)
    .map(
      (e) =>
        `- [${e.source}] ${hhmmss(e.t)} ${e.title}\n  ${clip(e.body, 700).replace(/\n/g, '\n  ')}`,
    );
  const before = s.timeline
    .filter((e) => e.seq < firstNew && STORY_TYPES.test(e.type))
    .slice(-25)
    .map((e) => fmtEvent(e, { body: 200, raw: 300 }));
  const st = s.state;
  const prompt = [
    `Hora actual: ${hhmmss(now)} UTC. Estado de la simulación: ${s.status}.`,
    `## Estado del incidente\n${
      st
        ? `${st.summary ?? ''}\nAtacante adentro: ${st.attacker_active ? 'sí' : 'no'}\n${Object.entries(
            st.vulns ?? {},
          )
            .map(([k, v]) => `- ${k}: ${v.status}`)
            .join('\n')}`
        : '(sin estado todavía)'
    }`,
    section(
      'Tus notificaciones anteriores (la más reciente al final)',
      sent,
      '(todavía no mandas ninguna)',
    ),
    section('Lo que pasó antes', before),
    section(
      'Eventos nuevos',
      pending.map((e) => fmtEvent(e, { body: 800, raw: 1200 })),
    ),
    instruction,
  ].join('\n\n');
  return { stable, prompt };
}

/**
 * "Alertas" de monitoreo que no alertan nada: una request suelta o tráfico normal
 * convertido en notificación ("GET /api/users/me: 1 request con 200… (normal)").
 * Ninguna herramienta real avisa eso; solo confunde. Se descartan.
 */
export function isNoiseAlert(n: {
  channel: string;
  title: string;
  body: string;
}): boolean {
  if (!['render', 'datadog'].includes(n.channel)) return false;
  return (
    /:\s*1\s+request\b/i.test(n.title) ||
    /\b1\s+request(\s+con)?\s+(status\s+)?2\d\d\b/i.test(n.title) ||
    /tr[áa]fico total[^\n]*\(normal\)/i.test(n.body)
  );
}

export async function runGenerator(
  llm: SimLlm,
  model: TaskModel,
  s: SimView,
  channels: NotifyChannel[],
  app: AppInfo,
  pending: TimelineEvent[],
  now?: string,
  instruction?: string,
): Promise<StructuredResult<GeneratorOutput>> {
  const { stable, prompt } = generatorPrompts(
    s,
    channels,
    app,
    pending,
    now,
    instruction,
  );
  const res = await llm.structured({
    model,
    system: GENERATOR_SYSTEM,
    stable,
    prompt,
    schema: generatorSchema(channels),
  });
  res.data.notifications = res.data.notifications
    .filter((n) => !isNoiseAlert(n))
    .slice(0, 3);
  return res;
}

// ------------------------------------------------------------ observer

export function observerPrompts(
  s: SimView,
  app: AppInfo,
  pending: TimelineEvent[],
  now = new Date().toISOString(),
) {
  const firstNew = pending[0]?.seq ?? Infinity;
  const facts = computeFacts(s.timeline, s.attack_plan);
  const stable = [
    `## La app\n${contextBlock(s.context, app)}`,
    `## Plan del atacante\n${clip(JSON.stringify(planForObserver(s), null, 1), 12_000)}`,
  ].join('\n\n');
  const chat = s.timeline
    .filter((e) => ['user.message', 'coder.reply'].includes(e.type))
    .slice(-10)
    .map((e) => fmtEvent(e, { body: 800, raw: 0 }));
  const before = s.timeline
    .filter((e) => e.seq < firstNew && STORY_TYPES.test(e.type))
    .slice(-30)
    .map((e) => fmtEvent(e, { body: 200, raw: 400 }));
  const prompt = [
    `Hora actual: ${hhmmss(now)} UTC. Estado de la simulación: ${s.status}.`,
    `## Hechos verificados (calculados desde el timeline; mandan sobre cualquier suposición)\n${factsBlock(facts)}`,
    `## Estado anterior\n${s.state ? JSON.stringify(s.state, null, 1) : '(ninguno)'}`,
    section(
      'Conversación reciente del developer con su agente de código',
      chat,
    ),
    section('Lo que pasó antes', before),
    section(
      'Eventos nuevos',
      pending.map((e) => fmtEvent(e, { body: 800, raw: 1500 })),
    ),
    'Devuelve el estado completo actualizado.',
  ].join('\n\n');
  return { stable, prompt, facts };
}

export async function runObserver(
  llm: SimLlm,
  model: TaskModel,
  s: SimView,
  app: AppInfo,
  pending: TimelineEvent[],
  now?: string,
): Promise<StructuredResult<IncidentState>> {
  const { stable, prompt, facts } = observerPrompts(s, app, pending, now);
  const res = await llm.structured({
    model,
    system: OBSERVER_SYSTEM,
    stable,
    prompt,
    schema: observerSchema,
  });
  return { ...res, data: toIncidentState(res.data, facts) };
}

/** El estado del LLM, con los hechos verificados por encima (status y attacker_active). */
export function toIncidentState(
  out: ObserverOutput,
  facts: IncidentFacts,
): IncidentState {
  const vulns: IncidentState['vulns'] = {};
  for (const v of out.vulns)
    vulns[v.vuln_id] = { status: v.status, note: v.note };
  for (const id of facts.order) {
    const f = facts.vulns[id];
    vulns[id] = { ...(vulns[id] ?? { note: '' }), status: f.status };
  }
  return {
    phase: out.phase,
    attacker_active: facts.attacker_active,
    current_vuln: out.current_vuln,
    vulns,
    compromised: out.compromised,
    assessments: out.assessments,
    summary: out.summary,
  };
}

/** Estado inicial cuando llega el plan: todo pendiente, sin LLM. */
export function initialState(s: SimView, phase = 'preparing'): IncidentState {
  const facts = computeFacts(s.timeline, s.attack_plan);
  const notes = new Map(
    findings(s).map((f) => [
      String(f.vuln_id),
      `${txt(f.file, '?')}:${txt(f.line, '?')}`,
    ]),
  );
  return {
    phase,
    attacker_active: false,
    current_vuln: null,
    vulns: Object.fromEntries(
      facts.order.map((id) => [
        id,
        { status: 'pending', note: notes.get(id) ?? '' },
      ]),
    ),
    compromised: [],
    assessments: [],
    summary:
      phase === 'preparing'
        ? `Plan de ataque listo con ${facts.order.length} vulnerabilidades; esperando que el developer parta.`
        : 'El ataque comenzó.',
  };
}

// ------------------------------------------------------------ debrief

export function debriefPrompts(s: SimView, app: AppInfo) {
  const facts = computeFacts(s.timeline, s.attack_plan);
  const stable = [
    `## La app\n${contextBlock(s.context, app)}`,
    `## Plan del atacante\n${clip(JSON.stringify(findings(s), null, 1), 15_000)}`,
  ].join('\n\n');
  const lines = s.timeline
    .filter(
      (e) =>
        !['deploy.progress', 'agent.note', 'state.update'].includes(e.type),
    )
    .slice(-400)
    .map((e) => {
      if (e.type === 'notify')
        return `#${e.seq} ${hhmmss(e.t)} · notify[${e.source}] — ${e.title}`;
      if (e.type === 'user.message' || e.type === 'coder.reply')
        return fmtEvent(e, { body: 1200, raw: 0 });
      return fmtEvent(e, { body: 300, raw: 600 });
    });
  const prompt = [
    `## Hechos verificados al cierre\n${factsBlock(facts)}`,
    `## Último estado del incidente\n${s.state ? JSON.stringify(s.state, null, 1) : '(ninguno)'}`,
    section('Timeline completo', lines),
    'Escribe el debrief.',
  ].join('\n\n');
  return { stable, prompt };
}

export async function runDebrief(
  llm: SimLlm,
  model: TaskModel,
  s: SimView,
  app: AppInfo,
): Promise<StructuredResult<DebriefOutput>> {
  const { stable, prompt } = debriefPrompts(s, app);
  const res = await llm.structured({
    model,
    system: DEBRIEF_SYSTEM,
    stable,
    prompt,
    schema: debriefSchema,
  });
  res.data.score = Math.max(0, Math.min(100, Math.round(res.data.score)));
  return res;
}
