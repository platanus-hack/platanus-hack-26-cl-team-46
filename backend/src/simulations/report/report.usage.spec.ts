import {
  EVENT_TYPES,
  type SimulationRecord,
  type TimelineEvent,
} from '../simulation.types.js';
import {
  computeBenchmark,
  median,
  MIN_SAMPLE,
  percentile,
} from './benchmark.js';
import {
  assembleResult,
  computeReportMetrics,
  fallbackResult,
  reportPrompts,
  type ReportOutput,
} from './report.prompt.js';
import type { SimulationResult } from './report.types.js';

/**
 * Lo nuevo del reporte: anclas del replay, uso del agente de código, uso de Hinty
 * (modo instructor) y benchmark contra otras corridas.
 */

const T0 = Date.parse('2026-11-22T03:00:00.000Z');

function ev(
  seq: number,
  actor: TimelineEvent['actor'],
  type: string,
  sec: number,
  extra: Partial<TimelineEvent> = {},
): TimelineEvent {
  return {
    seq,
    t: new Date(T0 + sec * 1000).toISOString(),
    sim_id: 'sim-2',
    actor,
    type,
    visibility: EVENT_TYPES[type].visibility,
    vuln_id: null,
    source: actor,
    severity: 'info',
    title: type,
    body: '',
    raw: {},
    ...extra,
  };
}

const PLAN = { findings: [{ vuln_id: 'idor', order: 1 }] };

/** Abre Hinty a T+60 (pausa 60 s), le pregunta, sigue un paso, y después le pide el fix al agente. */
const TIMELINE = [
  ev(1, 'hacker', 'attack.plan', -10, { raw: PLAN }),
  ev(2, 'user', 'control.start', 0),
  ev(3, 'user', 'control.pause', 60, { raw: { reason: 'hinty' } }),
  ev(4, 'system', 'hinty.question', 70, {
    body: '¿qué significa este 401?',
    raw: {
      question: '¿qué significa este 401?',
      step_done: false,
      marks: 3,
      guided: true,
    },
  }),
  ev(5, 'system', 'hinty.question', 80, {
    raw: { question: 'ver los logs', step_done: true, marks: 1, guided: true },
  }),
  ev(6, 'user', 'control.resume', 120, { raw: { reason: 'hinty' } }),
  ev(7, 'user', 'user.message', 150, { title: 'Arregla el IDOR de las notas' }),
  ev(8, 'coder', 'coder.reply', 160, { title: 'Agrego el filtro por user_id' }),
  ev(9, 'system', 'change.commit', 170),
  ev(10, 'system', 'change.deployed', 190),
  ev(11, 'hacker', 'attack.success', 200, { vuln_id: 'idor' }),
  ev(12, 'hacker', 'attack.done', 205, {
    vuln_id: 'idor',
    raw: { vuln_id: 'idor', attacker_active: true },
  }),
  ev(13, 'system', 'sim.status', 300, { raw: { status: 'finished' } }),
];

function record(timeline = TIMELINE): SimulationRecord {
  return {
    sim_id: 'sim-2',
    sandbox_id: 'sbx-2',
    repo_url: 'https://github.com/hack26-sandboxes/apuntes',
    status: 'finished',
    created_at: new Date(T0 - 60_000).toISOString(),
    updated_at: new Date(T0).toISOString(),
    hacker_mode: 'emulated',
    threads: [],
    attack_plan: PLAN,
    next_seq: timeline.length + 1,
    timeline,
  };
}

const OUTPUT: ReportOutput = {
  diagnosis: 'Te hackearon. El IDOR siguió abierto en T+02:20.',
  skills: {
    contencion: 40,
    reaccion: 60,
    precision: 50,
    protocolo: 50,
    integridad: 80,
  },
  vectors: [{ id: 'idor', name: 'Notas ajenas', family: 'A', score: 40 }],
  timeline: [
    {
      t: 5,
      attack: 'Lee notas ajenas',
      userAction: 'Pidió el fix',
      result: 'tarde',
      seq: 11,
      vuln_id: null,
    },
    {
      t: 9999,
      attack: 'Sigue adentro',
      userAction: 'Nada',
      result: 'empeora',
      seq: 999,
      vuln_id: 'idor',
    },
  ],
  recommendations: { summary: 'Ok.', didWell: [], improve: [] },
  min_steps: 1,
  ai_followed: 1,
  ai_moments: [
    {
      seq: 7,
      prompt: 'Arreglar el IDOR',
      outcome: 'seguida',
      note: 'Se desplegó.',
    },
    { seq: 11, prompt: 'No es un mensaje', outcome: 'ignorada', note: 'x' },
  ],
  hinty_note: 'Usaste a Hinty para leer el 401 antes de actuar.',
  fixes: [],
};

describe('métricas de uso', () => {
  const m = computeReportMetrics(record());

  it('el tiempo de incidente y las anclas descuentan la pausa por Hinty', () => {
    expect(m.time).toBe(240);
    expect(m.anchors.get(7)?.t).toBe(90); // mensaje a los 150 s de reloj, 60 en pausa
    expect(m.anchors.get(11)).toMatchObject({ t: 140, vuln_id: 'idor' });
    expect(m.anchors.get(1)?.t).toBe(0); // antes de partir
  });

  it('mide el uso del agente de código', () => {
    expect(m.prompts).toBe(1);
    expect(m.first_prompt).toBe(90);
    expect(m.avg_reply).toBe(10);
    expect(m.changes).toEqual({
      commits: 1,
      env: 0,
      db: 0,
      restarts: 0,
      deploys: 1,
      failed: 0,
    });
  });

  it('preguntar a Hinty durante el incidente es modo instructor', () => {
    expect(m.mode).toBe('instructor');
    expect(m.hinty).toEqual({
      questions: 1,
      steps: 1,
      highlights: 4,
      sessions: 1,
      paused: 60,
      moments: [{ t: 60, question: '¿qué significa este 401?', guided: true }],
    });
  });

  it('sin preguntas a Hinty es examen, aunque haya abierto el dock', () => {
    const tl = TIMELINE.filter((e) => e.type !== 'hinty.question');
    expect(computeReportMetrics(record(tl)).mode).toBe('examen');
  });

  it('el prompt usa tiempo de incidente y trae lo medido de Hinty y del agente', () => {
    const { prompt } = reportPrompts(record(), m, {
      repo: 'apuntes',
      deployed_url: null,
    });
    expect(prompt).toContain('#7 T+01:30');
    expect(prompt).toContain('Preguntas: 1');
    expect(prompt).toContain('Primer mensaje al agente: T+01:30');
    expect(prompt).toContain('1 commits');
  });
});

describe('armado con anclas y uso', () => {
  const m = computeReportMetrics(record());

  it('el tiempo de cada momento sale del evento anclado', () => {
    const r = assembleResult(OUTPUT, m, 'apuntes');
    expect(r.timeline[0]).toEqual({
      t: 140,
      attack: 'Lee notas ajenas',
      userAction: 'Pidió el fix',
      result: 'tarde',
      vulnId: 'idor',
      seq: 11,
    });
    // Ancla inexistente: se queda con el t del modelo (acotado) y sin seq.
    expect(r.timeline[1]).toMatchObject({ t: 240, vulnId: 'idor' });
    expect(r.timeline[1]).not.toHaveProperty('seq');
  });

  it('el uso de IA junta lo medido con los momentos del modelo', () => {
    const r = assembleResult(OUTPUT, m, 'apuntes');
    expect(r.aiUsage).toMatchObject({
      prompts: 1,
      followed: 1,
      manual: 0,
      firstPrompt: 90,
      avgReply: 10,
    });
    expect(r.aiUsage.moments).toEqual([
      {
        t: 90,
        seq: 7,
        prompt: 'Arreglar el IDOR',
        outcome: 'seguida',
        note: 'Se desplegó.',
      },
    ]);
  });

  it('modo instructor trae el uso de Hinty con la lectura del agente', () => {
    const r = assembleResult(OUTPUT, m, 'apuntes');
    expect(r.mode).toBe('instructor');
    expect(r.clickyUsage).toMatchObject({
      questions: 1,
      highlights: 4,
      hintsFollowed: 1,
      sessions: 1,
      pausedSeconds: 60,
      note: 'Usaste a Hinty para leer el 401 antes de actuar.',
    });
  });

  it('el respaldo también trae anclas, uso de IA y Hinty', () => {
    const r = fallbackResult(record(), m, 'apuntes');
    expect(r.mode).toBe('instructor');
    expect(r.clickyUsage?.questions).toBe(1);
    expect(r.clickyUsage).not.toHaveProperty('note');
    expect(r.timeline[0]).toMatchObject({ t: 140, seq: 11, vulnId: 'idor' });
    expect(r.aiUsage).toMatchObject({ firstPrompt: 90, moments: [] });
  });
});

// ------------------------------------------------------------ benchmark

function result(p: {
  score: number;
  time?: number;
  steps?: number;
  verdict?: SimulationResult['verdict'];
  vectors?: { id: string; score: number }[];
}): SimulationResult {
  const s = p.score;
  return {
    mode: 'examen',
    verdict: p.verdict ?? 'contenido',
    diagnosis: '',
    rank: 'Piloto',
    repo: 'x',
    hud: {
      time: p.time ?? 300,
      steps: p.steps ?? 4,
      minSteps: 2,
      contained: 1,
    },
    skills: {
      contencion: s,
      reaccion: s,
      precision: s,
      protocolo: s,
      integridad: s,
    },
    vectors: (p.vectors ?? [{ id: 'idor', score: s }]).map((v) => ({
      ...v,
      name: v.id,
      family: 'A' as const,
    })),
    timeline: [],
    recommendations: { summary: '', didWell: [], improve: [] },
    aiUsage: { prompts: 0, followed: 0, manual: 0 },
    fixes: [],
  };
}

describe('benchmark', () => {
  it('mediana y percentil (empates cuentan la mitad)', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBeNull();
    expect(percentile(50, [10, 50, 90, 30], 'higher')).toBe(63);
    expect(percentile(100, [200, 300, 50], 'lower')).toBe(67);
  });

  it('con pocas corridas no compara', () => {
    const b = computeBenchmark(result({ score: 70 }), [
      { result: result({ score: 40 }), owner: 'a' },
    ]);
    expect(b.runs).toBe(1);
    expect(b.overall.score).toMatchObject({
      you: 70,
      median: null,
      percentile: null,
      runs: 1,
    });
    expect(b.overall.contained_rate).toBeNull();
    expect(b.skills).toBeNull();
    expect(MIN_SAMPLE).toBe(3);
  });

  it('compara contra las corridas comparables y por vector solo contra el mismo vector', () => {
    const you = result({
      score: 70,
      time: 200,
      steps: 3,
      vectors: [
        { id: 'idor', score: 80 },
        { id: 'sqli', score: 10 },
      ],
    });
    const runs = [
      {
        result: result({ score: 40, time: 400, verdict: 'hackeado' }),
        owner: 'a',
      },
      { result: result({ score: 60, time: 300 }), owner: 'b' },
      { result: result({ score: 90, time: 100 }), owner: 'b' },
      {
        result: result({
          score: 50,
          time: 250,
          vectors: [{ id: 'xss', score: 50 }],
        }),
        owner: 'c',
      },
      // El ataque nunca partió: no cuenta.
      {
        result: {
          ...result({ score: 0 }),
          vectors: [],
          hud: { time: 0, steps: 0, minSteps: 1, contained: 0 },
        },
        owner: 'd',
      },
    ];
    const b = computeBenchmark(you, runs);
    expect(b.runs).toBe(4);
    expect(b.devs).toBe(3);
    expect(b.overall.score).toEqual({
      you: 70,
      median: 55,
      percentile: 75,
      runs: 4,
      better: 'higher',
    });
    expect(b.overall.time).toMatchObject({
      median: 275,
      percentile: 75,
      better: 'lower',
    });
    expect(b.overall.contained_rate).toBe(75);
    expect(b.skills?.contencion).toBe(55);
    const idor = b.vectors.find((v) => v.id === 'idor')!;
    expect(idor.score).toMatchObject({
      you: 80,
      runs: 3,
      median: 60,
      percentile: 67,
    });
    const sqli = b.vectors.find((v) => v.id === 'sqli')!;
    expect(sqli.score).toMatchObject({
      runs: 0,
      median: null,
      percentile: null,
    });
  });

  it('no expone nada de las otras corridas', () => {
    const b = computeBenchmark(result({ score: 70 }), [
      {
        result: {
          ...result({ score: 40 }),
          repo: 'secreto/privado',
          diagnosis: 'texto ajeno',
        },
        owner: 'ana',
      },
      { result: result({ score: 50 }), owner: 'ana' },
      { result: result({ score: 60 }), owner: 'beto' },
    ]);
    const json = JSON.stringify(b);
    expect(json).not.toContain('secreto');
    expect(json).not.toContain('texto ajeno');
    expect(json).not.toContain('ana');
  });
});
