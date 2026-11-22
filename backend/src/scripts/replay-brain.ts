/**
 * Replay de las tareas del cerebro sobre una simulación real, para comparar
 * modelos con los mismos datos que vio el agente original.
 *
 *   pnpm --filter backend build
 *   node --env-file=.env.brain dist/scripts/replay-brain.js \
 *     --sim sim-ed22258c --tasks generator,observer,debrief \
 *     --models claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5 --out ../.context/replay/report.md
 *
 * Opciones: --api <url> (default https://api.mayday.rip), --file <sim.json> --timeline <timeline.json>
 * (en vez de la API), --limit N (muestras por tarea, default 4), --effort <nivel>,
 * --repo-dir <dir> (para la tarea context).
 */
import { writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import type {
  IncidentState,
  NotifyChannel,
  SimulationRecord,
  TimelineEvent,
} from '../simulations/simulation.types.js';
import { EVENT_TYPES } from '../simulations/simulation.types.js';
import {
  SimLlm,
  type Effort,
  type StructuredResult,
  type TaskModel,
} from '../simulations/brain/llm.client.js';
import { collectRepoFiles } from '../simulations/brain/repo-files.js';
import {
  runContext,
  runDebrief,
  runGenerator,
  runObserver,
  type AppInfo,
} from '../simulations/brain/tasks.js';

const args = parseArgs(process.argv.slice(2));
const API = (args.api ?? 'https://api.mayday.rip').replace(/\/+$/, '');
const TASKS = (args.tasks ?? 'generator,observer,debrief').split(',');
const MODELS = (
  args.models ?? 'claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5'
).split(',');
const LIMIT = Number(args.limit ?? 4);
const DEFAULT_EFFORT: Record<string, Effort> = {
  context: 'low',
  generator: 'low',
  observer: 'medium',
  debrief: 'high',
};
/** US$ por millón de tokens (entrada, salida). */
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};

type SimJson = SimulationRecord & {
  channels: NotifyChannel[];
  sandbox: {
    deployed_url: string | null;
    seed_users: Array<{ email: string; role?: string }>;
  };
};

const key = process.env.ANTHROPIC_API_KEY;
if (!key) throw new Error('Falta ANTHROPIC_API_KEY');
const llm = SimLlm.fromApiKey(key);

const sim = (await load(
  args.file,
  `${API}/simulations/${args.sim}`,
)) as SimJson;
const timeline = (await load(
  args.timeline,
  `${API}/simulations/${args.sim}/timeline?view=all`,
)) as TimelineEvent[];
const app: AppInfo = {
  deployed_url: sim.sandbox?.deployed_url ?? null,
  seed_users: (sim.sandbox?.seed_users ?? []).map((u) => ({
    email: u.email,
    role: u.role,
  })),
};
const out: string[] = [
  `# Replay de ${sim.sim_id}`,
  '',
  `Modelos: ${MODELS.join(', ')}`,
  '',
];
const totals = new Map<
  string,
  { calls: number; ms: number; usd: number; errors: number }
>();

for (const task of TASKS) {
  out.push(`\n## ${task}\n`);
  for (const sample of samples(task).slice(0, LIMIT)) {
    out.push(
      `\n### ${sample.label}\n`,
      sample.original
        ? `**Original (agente en Conductor):**\n\n${sample.original}\n`
        : '',
    );
    const results = await Promise.all(
      MODELS.map(async (model) => {
        const m: TaskModel = {
          model,
          effort: (args.effort as Effort) ?? DEFAULT_EFFORT[task],
          maxTokens: task === 'debrief' ? 16_000 : 12_000,
          timeoutMs: 300_000,
        };
        try {
          return { model, res: await sample.run(m) };
        } catch (err) {
          return { model, err: (err as Error).message };
        }
      }),
    );
    for (const r of results) {
      const t = totals.get(`${task}:${r.model}`) ?? {
        calls: 0,
        ms: 0,
        usd: 0,
        errors: 0,
      };
      if ('err' in r) {
        t.errors += 1;
        out.push(`**${r.model}** — ERROR: ${r.err}\n`);
      } else {
        const res = r.res!;
        const [pi, po] = PRICES[r.model] ?? [0, 0];
        const usd =
          ((res.usage.input_tokens +
            res.usage.cache_creation_input_tokens * 1.25 +
            res.usage.cache_read_input_tokens * 0.1) *
            pi +
            res.usage.output_tokens * po) /
          1e6;
        t.calls += 1;
        t.ms += res.ms;
        t.usd += usd;
        out.push(
          `**${r.model}** — ${(res.ms / 1000).toFixed(1)} s · in ${res.usage.input_tokens + res.usage.cache_read_input_tokens + res.usage.cache_creation_input_tokens} · out ${res.usage.output_tokens} · US$${usd.toFixed(4)}\n\n${sample.show(res.data)}\n`,
        );
      }
      totals.set(`${task}:${r.model}`, t);
    }
    process.stderr.write(`· ${task} ${sample.label}\n`);
  }
}

out.push(
  '\n## Resumen\n',
  '| tarea | modelo | llamadas | errores | latencia media | costo total |',
  '|---|---|---|---|---|---|',
);
for (const [k, t] of totals) {
  const [task, model] = k.split(':');
  out.push(
    `| ${task} | ${model} | ${t.calls} | ${t.errors} | ${t.calls ? (t.ms / t.calls / 1000).toFixed(1) : '-'} s | US$${t.usd.toFixed(4)} |`,
  );
}
const report = out.join('\n');
if (args.out) await writeFile(args.out, report);
console.log(report);

// ------------------------------------------------------------ muestras

interface Sample {
  label: string;
  original?: string;
  run: (m: TaskModel) => Promise<StructuredResult<unknown>>;
  show: (data: unknown) => string;
}

function samples(task: string): Sample[] {
  if (task === 'generator') return generatorSamples();
  if (task === 'observer') return observerSamples();
  if (task === 'debrief') return [debriefSample()];
  if (task === 'context') return [contextSample()];
  throw new Error(`Tarea desconocida: ${task}`);
}

function viewAt(seq: number, status: SimulationRecord['status'] = 'running') {
  const before = timeline.filter((e) => e.seq < seq);
  const lastState = before.filter((e) => e.type === 'state.update').at(-1);
  return {
    sim_id: sim.sim_id,
    status,
    timeline: before,
    attack_plan: sim.attack_plan,
    context: sim.context,
    state: lastState?.raw as IncidentState | undefined,
  };
}

function wakes(e: TimelineEvent, role: 'generator' | 'observer') {
  return e.actor !== role && EVENT_TYPES[e.type]?.wakes.includes(role);
}

/** Cada turno original del generador: los eventos que lo despertaron y lo que publicó. */
function generatorSamples(): Sample[] {
  const started = timeline.find((e) => e.type === 'control.start')?.seq ?? 0;
  const groups: TimelineEvent[][] = [];
  for (const e of timeline) {
    if (e.type !== 'notify' || e.seq < started) continue;
    const last = groups.at(-1);
    const between = last
      ? timeline.filter(
          (x) =>
            x.seq > last.at(-1)!.seq && x.seq < e.seq && wakes(x, 'generator'),
        )
      : [];
    if (last && between.length === 0) last.push(e);
    else groups.push([e]);
  }
  let prev = started;
  return groups.map((g) => {
    const pending = timeline.filter(
      (x) => x.seq > prev && x.seq < g[0].seq && wakes(x, 'generator'),
    );
    prev = g.at(-1)!.seq;
    const v = viewAt(g[0].seq);
    return {
      label: `Turno antes de #${g[0].seq} (eventos nuevos: ${pending.map((p) => `#${p.seq} ${p.type}`).join(', ')})`,
      original: g
        .map(
          (n) =>
            `- [${n.source}] **${n.title}**\n\n  ${n.body.replace(/\n/g, '\n  ')}`,
        )
        .join('\n'),
      run: (m) => runGenerator(llm, m, v, sim.channels, app, pending, g[0].t),
      show: (d) => {
        const ns = (
          d as {
            notifications: Array<{
              channel: string;
              title: string;
              body: string;
              from: string | null;
              severity: string;
            }>;
          }
        ).notifications;
        return ns.length
          ? ns
              .map(
                (n) =>
                  `- [${n.channel} · ${n.severity}${n.from ? ` · ${n.from}` : ''}] **${n.title}**\n\n  ${n.body.replace(/\n/g, '\n  ')}`,
              )
              .join('\n')
          : '_(sin notificaciones)_';
      },
    };
  });
}

/** Cada state.update original del observer después de partir. */
function observerSamples(): Sample[] {
  const started = timeline.find((e) => e.type === 'control.start')?.seq ?? 0;
  const states = timeline.filter(
    (e) => e.type === 'state.update' && e.seq > started,
  );
  let prev = started;
  return states.map((st) => {
    const pending = timeline.filter(
      (x) => x.seq > prev && x.seq < st.seq && wakes(x, 'observer'),
    );
    prev = st.seq;
    const v = viewAt(st.seq);
    return {
      label: `state.update #${st.seq} (eventos nuevos: ${pending.map((p) => `#${p.seq} ${p.type}`).join(', ')})`,
      original: showState(st.raw as IncidentState),
      run: (m) => runObserver(llm, m, v, app, pending, st.t),
      show: (d) => showState(d as IncidentState),
    };
  });
}

function showState(s: IncidentState) {
  return [
    `phase=${s.phase} · attacker_active=${s.attacker_active} · ${s.summary ?? ''}`,
    ...Object.entries(s.vulns ?? {})
      .filter(([, v]) => v.status !== 'pending')
      .map(([k, v]) => `- ${k}: ${v.status} — ${v.note ?? ''}`),
    ...(s.compromised ?? []).map((c) => `- comprometido: ${c}`),
    ...(s.assessments ?? []).map(
      (a) => `- evaluación: ${a.action} → **${a.verdict}** (${a.why})`,
    ),
  ].join('\n');
}

function debriefSample(): Sample {
  const fin = timeline.find((e) => e.type === 'sim.finished');
  const end = fin?.seq ?? Infinity;
  const v = viewAt(end, 'running');
  return {
    label: 'Debrief al cierre',
    original: fin
      ? '```json\n' + JSON.stringify(fin.raw, null, 1).slice(0, 6000) + '\n```'
      : undefined,
    run: (m) => runDebrief(llm, m, v, app),
    show: (d) =>
      '```json\n' + JSON.stringify(d, null, 1).slice(0, 6000) + '\n```',
  };
}

function contextSample(): Sample {
  const dir = args['repo-dir'];
  if (!dir) throw new Error('context necesita --repo-dir');
  const ctx = timeline.find((e) => e.type === 'context.ready');
  return {
    label: 'Contexto de la app',
    original: ctx
      ? '```json\n' + JSON.stringify(ctx.raw, null, 1) + '\n```'
      : undefined,
    run: async (m) =>
      runContext(llm, m, { ...(await collectRepoFiles(dir)), app }),
    show: (d) => '```json\n' + JSON.stringify(d, null, 1) + '\n```',
  };
}

// ------------------------------------------------------------ utilidades

async function load(file: string | undefined, url: string): Promise<unknown> {
  if (file) return JSON.parse(readFileSync(file, 'utf8'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

function parseArgs(argv: string[]): Record<string, string> {
  const r: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) r[argv[i].slice(2)] = argv[i + 1] ?? '';
    if (argv[i].startsWith('--')) i++;
  }
  return r;
}
