import type { SimLlm } from '../brain/llm.client.js';
import {
  EVENT_TYPES,
  type SimulationRecord,
  type TimelineEvent,
} from '../simulation.types.js';
import { HttpException } from '@nestjs/common';
import {
  needsReport,
  REGENERATE_COOLDOWN_MS,
  ReportAgent,
} from './report.agent.js';
import { benchmarkable } from './reports.controller.js';
import {
  assembleResult,
  computeReportMetrics,
  fallbackResult,
  rankFor,
  reportPrompts,
  type ReportOutput,
} from './report.prompt.js';

const T0 = Date.parse('2026-11-21T20:00:00.000Z');
const W = 'weak-password-no-rate-limit';
const PLAN = {
  findings: [
    { vuln_id: W, order: 1 },
    { vuln_id: 'idor', order: 2 },
  ],
};

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
    sim_id: 'sim-1',
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

/** Fuerza bruta → el developer cambia la contraseña (no sirve) → rota el secreto (sí sirve). */
const TIMELINE = [
  ev(1, 'hacker', 'attack.plan', -30, { raw: PLAN }),
  ev(2, 'user', 'control.start', 0),
  ev(3, 'hacker', 'attack.success', 40, { vuln_id: W }),
  ev(4, 'hacker', 'attack.done', 45, {
    vuln_id: W,
    raw: { vuln_id: W, attacker_active: true },
  }),
  ev(5, 'user', 'user.message', 90, {
    title: 'Cámbiale la contraseña a Martín',
  }),
  ev(6, 'user', 'user.action', 150, {
    title: 'Rotar JWT_SECRET',
    raw: { action: 'rotate_secret' },
  }),
  ev(7, 'user', 'user.message', 151, { title: 'Acción: Rotar JWT_SECRET' }),
  ev(8, 'system', 'change.deployed', 180),
  ev(9, 'hacker', 'attack.verify', 200, {
    vuln_id: W,
    raw: { vuln_id: W, still_exploitable: true, attacker_active: false },
  }),
  ev(10, 'observer', 'sim.finished', 300, {
    raw: { summary: 'Rotaste a tiempo.' },
  }),
  ev(11, 'system', 'sim.status', 300, { raw: { status: 'finished' } }),
];

function record(
  timeline = TIMELINE,
  status: SimulationRecord['status'] = 'finished',
): SimulationRecord {
  return {
    sim_id: 'sim-1',
    sandbox_id: 'sbx-1',
    repo_url: 'https://github.com/hack26-sandboxes/apuntes',
    status,
    created_at: new Date(T0 - 60_000).toISOString(),
    updated_at: new Date(T0).toISOString(),
    hacker_mode: 'emulated',
    threads: [],
    attack_plan: PLAN,
    debrief: { summary: 'Rotaste a tiempo.' },
    next_seq: timeline.length + 1,
    timeline,
  };
}

const OUTPUT: ReportOutput = {
  diagnosis: 'Contuviste. Rotar el secreto en T+02:30 cortó la sesión robada.',
  skills: {
    contencion: 90,
    reaccion: 120,
    precision: 60,
    protocolo: 55,
    integridad: -5,
  },
  vectors: [
    { id: W, name: 'Fuerza bruta en el login', family: 'B', score: 80 },
  ],
  timeline: [
    {
      t: 999,
      attack: 'Entra con qwerty123',
      userAction: 'Cambió la contraseña',
      result: 'tarde',
      seq: null,
      vuln_id: null,
    },
    {
      t: 40,
      attack: 'Login exitoso',
      userAction: 'Nada',
      result: 'empeora',
      seq: null,
      vuln_id: null,
    },
  ],
  recommendations: {
    summary: 'Bien.',
    didWell: ['Rotaste el secreto.'],
    improve: [],
  },
  min_steps: 1,
  ai_followed: 50,
  ai_moments: [],
  hinty_note: '',
  fixes: [
    {
      title: 'Rate limit',
      done: false,
      file: null,
      steps: ['Agrega rate limit'],
    },
  ],
};

describe('métricas del reporte', () => {
  it('mide tiempo, pasos y veredicto desde el timeline', () => {
    const m = computeReportMetrics(record());
    expect(m.time).toBe(300);
    expect(m.prompts).toBe(1); // el mensaje delegado por la acción rápida no cuenta
    expect(m.manual).toBe(1);
    expect(m.steps).toBe(2);
    expect(m.played).toEqual([W]);
    expect(m.verdict).toBe('contenido');
    expect(m.attack_started).toBe(true);
  });

  it('si el atacante sigue adentro al cierre, te hackearon', () => {
    const m = computeReportMetrics(record(TIMELINE.slice(0, 5)));
    expect(m.verdict).toBe('hackeado');
  });

  it('el rango sale del promedio y se topa en Copiloto si te hackearon', () => {
    expect(rankFor(85, 'contenido')).toBe('Instructor');
    expect(rankFor(85, 'hackeado')).toBe('Copiloto');
    expect(rankFor(10, 'contenido')).toBe('Pasajero');
  });

  it('el prompt incluye el timeline con tiempos relativos y el chat completo', () => {
    const s = record();
    const { prompt } = reportPrompts(s, computeReportMetrics(s), {
      repo: 'apuntes',
      deployed_url: null,
    });
    expect(prompt).toContain('T+01:30');
    expect(prompt).toContain('Cámbiale la contraseña a Martín');
    expect(prompt).toContain('T-00:30'); // antes de partir
  });
});

describe('armado del reporte', () => {
  it('lo medido gana sobre lo que dice el modelo', () => {
    const m = computeReportMetrics(record());
    const r = assembleResult(OUTPUT, m, 'apuntes');
    expect(r.verdict).toBe('contenido');
    expect(r.hud).toEqual({ time: 300, steps: 2, minSteps: 1, contained: 1 });
    expect(r.skills.reaccion).toBe(100);
    expect(r.skills.integridad).toBe(0);
    expect(r.aiUsage).toMatchObject({ prompts: 1, followed: 1, manual: 1 });
    expect(r.mode).toBe('examen');
    expect(r).not.toHaveProperty('clickyUsage');
    expect(r.timeline.map((e) => e.t)).toEqual([40, 300]); // ordenado y dentro del incidente
    expect(r.fixes[0]).not.toHaveProperty('file');
    expect(r.vectors).toEqual([
      { id: W, name: 'Fuerza bruta en el login', family: 'B', score: 80 },
    ]);
  });

  it('el respaldo arma un reporte válido sin LLM', () => {
    const s = record();
    const r = fallbackResult(s, computeReportMetrics(s), 'apuntes');
    expect(r.verdict).toBe('contenido');
    expect(r.diagnosis).toBe('Rotaste a tiempo.');
    expect(r.vectors).toHaveLength(1);
    expect(r.timeline[0]).toMatchObject({
      t: 40,
      userAction: 'Cámbiale la contraseña a Martín',
    });
  });

  it('solo hay reporte si la simulación cerró después de partir (o terminó)', () => {
    expect(needsReport(record())).toBe(true);
    expect(needsReport(record(TIMELINE, 'running'))).toBe(false);
    expect(needsReport(record([TIMELINE[0]], 'failed'))).toBe(false);
    expect(needsReport(record(TIMELINE.slice(0, 4), 'stopped'))).toBe(true);
  });
});

describe('agente de reportes', () => {
  function setup(llm: Partial<SimLlm> | undefined) {
    const sims = new Map([['sim-1', record()]]);
    const store = {
      get: (id: string) => sims.get(id),
      list: () => [...sims.values()],
      update: (
        id: string,
        p: Partial<SimulationRecord> | ((s: SimulationRecord) => void),
      ) => {
        const s = sims.get(id)!;
        if (typeof p === 'function') p(s);
        else Object.assign(s, p);
        return s;
      },
    };
    const config = {
      get: (k: string) =>
        k === 'ANTHROPIC_API_KEY'
          ? undefined
          : k.startsWith('SIM_EFFORT')
            ? 'high'
            : 'claude-opus-5-5',
    };
    const agent = new ReportAgent(
      config as never,
      store as never,
      { onAppend: () => () => {} } as never,
      {
        get: (id: string) => sims.get(id)!,
        ownerOf: () => ({ github_id: 7, login: 'rai' }),
      } as never,
      {
        get: () => ({
          repo_url: 'https://github.com/hack26-sandboxes/apuntes',
          name: 'Apuntes',
        }),
      } as never,
    );
    agent.useLlm(llm as SimLlm | undefined);
    return { agent, sims };
  }

  it('genera el reporte con el modelo y congela el dueño', async () => {
    const structured = vi.fn().mockResolvedValue({
      data: OUTPUT,
      model: 'claude-opus-5-5',
      ms: 10,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const { agent, sims } = setup({ structured });
    agent.request('sim-1', 'finished');
    await vi.waitFor(() =>
      expect(sims.get('sim-1')!.report!.status).toBe('ready'),
    );
    const r = sims.get('sim-1')!.report!;
    expect(r.owner).toEqual({ github_id: 7, login: 'rai' });
    expect(r.title).toBe('Apuntes');
    expect(r.degraded).toBe(false);
    expect(r.result!.repo).toBe('Apuntes');
    expect(structured).toHaveBeenCalledTimes(1);
  });

  it('si la API falla en todos los intentos, usa el respaldo', async () => {
    const structured = vi.fn().mockRejectedValue(new Error('overloaded'));
    const { agent, sims } = setup({ structured });
    agent.request('sim-1', 'finished');
    await vi.waitFor(() =>
      expect(sims.get('sim-1')!.report!.status).toBe('ready'),
    );
    expect(structured).toHaveBeenCalledTimes(3);
    expect(sims.get('sim-1')!.report!.degraded).toBe(true);
  });

  it('no regenera un reporte listo salvo que se fuerce', async () => {
    const structured = vi.fn().mockResolvedValue({
      data: OUTPUT,
      model: 'm',
      ms: 1,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const { agent, sims } = setup({ structured });
    agent.request('sim-1', 'finished');
    await vi.waitFor(() =>
      expect(sims.get('sim-1')!.report!.status).toBe('ready'),
    );
    agent.request('sim-1', 'finished');
    expect(sims.get('sim-1')!.report!.status).toBe('ready');
    agent.request('sim-1', 'finished', { force: true });
    await vi.waitFor(() => expect(structured).toHaveBeenCalledTimes(2));
  });

  it('regenerar a mano tiene cooldown y conserva el resultado anterior mientras tanto', async () => {
    let release!: () => void;
    const structured = vi
      .fn()
      .mockResolvedValueOnce({
        data: OUTPUT,
        model: 'm',
        ms: 1,
        usage: { input_tokens: 1, output_tokens: 1 },
      })
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            release = () =>
              r({
                data: OUTPUT,
                model: 'm2',
                ms: 1,
                usage: { input_tokens: 1, output_tokens: 1 },
              });
          }),
      );
    const { agent, sims } = setup({ structured });
    const report = () => sims.get('sim-1')!.report!;
    agent.request('sim-1', 'finished');
    await vi.waitFor(() => expect(report().status).toBe('ready'));
    const first = report().result;
    const t0 = Date.now();
    agent.request('sim-1', 'finished', { force: true, now: t0 });
    await vi.waitFor(() => expect(report().status).toBe('generating'));
    // Mientras se regenera, el resultado anterior sigue ahí.
    expect(report().result).toBe(first);
    release();
    await vi.waitFor(() => expect(report().status).toBe('ready'));
    expect(report().model).toBe('m2');
    // Otra regeneración antes del cooldown: 429.
    const err = (() => {
      try {
        agent.request('sim-1', 'finished', { force: true, now: t0 + 60_000 });
      } catch (e) {
        return e as HttpException;
      }
    })();
    expect(err).toBeInstanceOf(HttpException);
    expect(err!.getStatus()).toBe(429);
    // Pasado el cooldown, se puede.
    expect(() =>
      agent.request('sim-1', 'finished', {
        force: true,
        now: t0 + REGENERATE_COOLDOWN_MS + 1,
      }),
    ).not.toThrow();
  });
});

describe('agente de reportes: regeneración fallida', () => {
  it('si regenerar falla con el modelo, queda el reporte anterior en vez del respaldo', async () => {
    const sims = new Map([['sim-1', record()]]);
    const store = {
      get: (id: string) => sims.get(id),
      list: () => [...sims.values()],
      update: (
        id: string,
        p: Partial<SimulationRecord> | ((s: SimulationRecord) => void),
      ) => {
        const r = sims.get(id)!;
        if (typeof p === 'function') p(r);
        else Object.assign(r, p);
        return r;
      },
    };
    const agent = new ReportAgent(
      {
        get: (k: string) => (k.startsWith('SIM_EFFORT') ? 'high' : 'm'),
      } as never,
      store as never,
      { onAppend: () => () => {} } as never,
      { get: (id: string) => sims.get(id)!, ownerOf: () => undefined } as never,
      {
        get: () => ({ repo_url: 'https://github.com/x/y', name: 'Y' }),
      } as never,
    );
    const structured = vi
      .fn()
      .mockResolvedValueOnce({
        data: OUTPUT,
        model: 'm',
        ms: 1,
        usage: { input_tokens: 1, output_tokens: 1 },
      })
      .mockRejectedValue(new Error('overloaded'));
    agent.useLlm({ structured } as unknown as SimLlm);
    agent.request('sim-1', 'finished');
    await vi.waitFor(() =>
      expect(sims.get('sim-1')!.report!.status).toBe('ready'),
    );
    const good = sims.get('sim-1')!.report!.result;
    agent.request('sim-1', 'finished', { force: true });
    await vi.waitFor(() => expect(structured).toHaveBeenCalledTimes(4));
    await vi.waitFor(() =>
      expect(sims.get('sim-1')!.report!.status).toBe('ready'),
    );
    expect(sims.get('sim-1')!.report!.result).toBe(good);
    expect(sims.get('sim-1')!.report!.degraded).toBe(false);
  });
});

describe('benchmark', () => {
  it('deja fuera las corridas con hacker externo que recibió el token', () => {
    const base = record();
    expect(benchmarkable(base)).toBe(true);
    expect(benchmarkable({ ...base, hacker_mode: 'external' })).toBe(false);
    // El motor interno también es external, pero nunca entrega el token.
    expect(
      benchmarkable({ ...base, hacker_mode: 'external', engine_driven: true }),
    ).toBe(true);
  });
});
