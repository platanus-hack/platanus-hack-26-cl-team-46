import { buildSimPrompt } from '../sim-prompts.js';
import {
  EVENT_TYPES,
  type SimulationRecord,
  type TimelineEvent,
} from '../simulation.types.js';
import { TimelineService } from '../timeline.service.js';
import {
  computeFacts,
  direct,
  DEFAULT_DIRECTOR,
  nextBlockedReason,
} from './facts.js';
import type { SimLlm } from './llm.client.js';
import { generatorSchema, type ObserverOutput } from './schemas.js';
import { SimulationBrain } from './simulation.brain.js';
import { toIncidentState } from './tasks.js';

const T0 = Date.parse('2026-11-21T20:00:00.000Z');
const PLAN = {
  findings: [
    { vuln_id: 'weak-password-no-rate-limit', order: 1 },
    { vuln_id: 'idor', order: 2 },
    { vuln_id: 'sql-injection', order: 3 },
  ],
};

function ev(
  seq: number,
  actor: TimelineEvent['actor'],
  type: string,
  extra: Partial<TimelineEvent> & { min?: number } = {},
): TimelineEvent {
  const { min = seq / 10, ...rest } = extra;
  return {
    seq,
    t: new Date(T0 + min * 60_000).toISOString(),
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
    ...rest,
  };
}

const W = 'weak-password-no-rate-limit';
/** Fuerza bruta exitosa sobre la cuenta de Martín. */
const attacked = [
  ev(1, 'hacker', 'attack.plan', { raw: PLAN }),
  ev(2, 'user', 'control.start'),
  ev(3, 'hacker', 'attack.step', { vuln_id: W }),
  ev(4, 'hacker', 'attack.success', { vuln_id: W }),
  ev(5, 'hacker', 'attack.done', {
    vuln_id: W,
    raw: { vuln_id: W, attacker_active: true },
  }),
];

function sim(
  timeline: TimelineEvent[],
  status: SimulationRecord['status'] = 'running',
) {
  return { status, timeline, attack_plan: PLAN };
}

describe('hechos del incidente', () => {
  it('sigue el estado de cada vuln desde el timeline', () => {
    const f = computeFacts(attacked, PLAN);
    expect(f.order).toEqual([W, 'idor', 'sql-injection']);
    expect(f.vulns[W].status).toBe('exploited');
    expect(f.vulns.idor.status).toBe('pending');
    expect(f.attacker_active).toBe(true);
    expect(f.attack_in_progress).toBe(false);
  });

  it('un arreglo que no saca al atacante deja la vuln explotada', () => {
    const f = computeFacts(
      [
        ...attacked,
        ev(6, 'system', 'change.deployed'),
        ev(7, 'observer', 'control.verify', {
          vuln_id: W,
          raw: { vuln_id: W },
        }),
        ev(8, 'hacker', 'attack.verify', {
          vuln_id: W,
          raw: { vuln_id: W, still_exploitable: false, attacker_active: true },
        }),
      ],
      PLAN,
    );
    expect(f.vulns[W].status).toBe('exploited');
    expect(f.attacker_active).toBe(true);
    expect(f.pending_verifies).toEqual([]);
  });

  it('arreglado y sin atacante = fixed', () => {
    const f = computeFacts(
      [
        ...attacked,
        ev(6, 'system', 'change.deployed'),
        ev(7, 'observer', 'control.verify', { vuln_id: W }),
        ev(8, 'hacker', 'attack.verify', {
          vuln_id: W,
          raw: { still_exploitable: false, attacker_active: false },
        }),
      ],
      PLAN,
    );
    expect(f.vulns[W].status).toBe('fixed');
    expect(f.attacker_active).toBe(false);
  });
});

describe('director', () => {
  const now = (min: number) => T0 + min * 60_000;

  it('no hace nada si la simulación no está corriendo', () => {
    expect(direct(sim(attacked, 'ready'), now(10))).toEqual([]);
  });

  it('pide verificar después de un cambio desplegado, una sola vez', () => {
    const t = [...attacked, ev(6, 'system', 'change.deployed')];
    expect(direct(sim(t), now(1))).toEqual([
      expect.objectContaining({ type: 'verify', vuln_id: W }),
    ]);
    const t2 = [...t, ev(7, 'observer', 'control.verify', { vuln_id: W })];
    expect(direct(sim(t2), now(1))).toEqual([]);
  });

  it('un commit sin desplegar no gatilla verificación', () => {
    const t = [...attacked, ev(6, 'system', 'change.commit')];
    expect(direct(sim(t), now(1)).filter((a) => a.type === 'verify')).toEqual(
      [],
    );
  });

  it('no escala en el mismo momento del ataque ni mientras hay un ataque en curso', () => {
    expect(direct(sim(attacked), now(0.6))).toEqual([]);
    const inProgress = [...attacked, ev(6, 'user', 'control.next')];
    expect(direct(sim(inProgress), now(30))).toEqual([]);
  });

  it('escala cuando el developer ya reaccionó y pasó el tiempo', () => {
    const t = [...attacked, ev(6, 'user', 'user.message', { min: 1 })];
    expect(direct(sim(t), now(2))).toEqual([]);
    expect(direct(sim(t), now(0.5 + 3.1))).toEqual([
      expect.objectContaining({ type: 'next', vuln_id: 'idor' }),
    ]);
  });

  it('si el developer no hace nada, escala igual después de un rato largo', () => {
    expect(direct(sim(attacked), now(5))).toEqual([]);
    expect(direct(sim(attacked), now(9))).toEqual([
      expect.objectContaining({ type: 'next', vuln_id: 'idor' }),
    ]);
  });

  it('con todo contenido pasa a la siguiente, y cierra al llegar al máximo', () => {
    const contained = [
      ...attacked,
      ev(6, 'system', 'change.deployed', { min: 2 }),
      ev(7, 'observer', 'control.verify', { vuln_id: W, min: 2 }),
      ev(8, 'hacker', 'attack.verify', {
        vuln_id: W,
        min: 3,
        raw: { still_exploitable: false, attacker_active: false },
      }),
    ];
    expect(direct(sim(contained), now(3.1))).toEqual([]); // deja ver la buena noticia
    expect(direct(sim(contained), now(3.5))).toEqual([
      expect.objectContaining({ type: 'next', vuln_id: 'idor' }),
    ]);
    expect(
      direct(sim(contained), now(3.5), {
        ...DEFAULT_DIRECTOR,
        maxIncidents: 1,
      }),
    ).toEqual([expect.objectContaining({ type: 'finish' })]);
  });
});

describe('siguiente vuln a pedido del developer', () => {
  it('no deja encolar vulns mientras el atacante sigue en una', () => {
    // El bug real: 12 clics en "Siguiente vuln" jugaron las 4 vulns en 45 s.
    const t = [...attacked.slice(0, 3), ev(4, 'user', 'control.next')];
    expect(nextBlockedReason(sim(attacked.slice(0, 2)))).toMatch(/todavía/);
    expect(nextBlockedReason(sim(t))).toMatch(/todavía/);
  });

  it('tampoco mientras se re-verifica', () => {
    const t = [
      ...attacked,
      ev(6, 'system', 'change.deployed'),
      ev(7, 'observer', 'control.verify', { vuln_id: W }),
    ];
    expect(nextBlockedReason(sim(t))).toMatch(/re-verificando/);
  });

  it('se puede cuando el ataque anterior terminó', () => {
    expect(nextBlockedReason(sim(attacked))).toBeNull();
  });
});

describe('estado del observer', () => {
  it('los hechos mandan sobre lo que redacta el modelo', () => {
    const out: ObserverOutput = {
      phase: 'recovered',
      current_vuln: W,
      vulns: [{ vuln_id: W, status: 'fixed', note: 'rate limit desplegado' }],
      compromised: ['JWT de martin.soto'],
      assessments: [],
      summary: 'Todo arreglado',
    };
    const st = toIncidentState(out, computeFacts(attacked, PLAN));
    expect(st.attacker_active).toBe(true);
    expect(st.vulns[W]).toEqual({
      status: 'exploited',
      note: 'rate limit desplegado',
    });
    expect(st.vulns.idor.status).toBe('pending');
  });
});

describe('esquema del generador', () => {
  it('solo acepta los canales detectados y severidades válidas', () => {
    const schema = generatorSchema(['email', 'support', 'phone', 'render']);
    const n = { title: 't', body: 'b', from: null, room: null, vuln_id: null };
    expect(
      schema.safeParse({
        notifications: [{ ...n, channel: 'email', severity: 'warning' }],
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        notifications: [{ ...n, channel: 'sentry', severity: 'warning' }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        notifications: [{ ...n, channel: 'email', severity: 'medium' }],
      }).success,
    ).toBe(false);
  });

  it('acepta mensajes de slack con sala del chat del equipo', () => {
    const schema = generatorSchema(['email', 'slack']);
    const n = {
      title: '¿Alguien más ve la app lenta?',
      body: '',
      vuln_id: null,
    };
    const msg = {
      ...n,
      channel: 'slack',
      from: 'Tomás Vidal',
      severity: 'info',
    };
    expect(
      schema.safeParse({ notifications: [{ ...msg, room: '#general' }] })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({ notifications: [{ ...msg, room: '#random' }] })
        .success,
    ).toBe(false);
  });
});

describe('prompts de Conductor con roles en el backend', () => {
  it('el coder no depende de un thread de infra que no existe', () => {
    const p = buildSimPrompt({
      simId: 'sim-1',
      repoUrl: 'https://github.com/x/y',
      role: 'coder',
      conductorRoles: ['hacker', 'coder'],
    });
    expect(p).toContain('corren dentro de nuestro backend');
    expect(p).not.toContain('van al thread infra');
  });
});

// ------------------------------------------------------------ cerebro con un modelo falso

function harness(
  threadModes: Partial<Record<string, 'api' | 'conductor'>> = {},
) {
  const record: SimulationRecord = {
    sim_id: 'sim-1',
    sandbox_id: 'sbx-1',
    repo_url: 'https://github.com/x/y',
    status: 'running',
    created_at: '',
    updated_at: '',
    hacker_mode: 'emulated',
    tools_detected: [],
    threads: (
      ['infra', 'hacker', 'observer', 'generator', 'coder'] as const
    ).map((role) => ({
      role,
      mode:
        threadModes[role] ??
        (['hacker', 'coder'].includes(role) ? 'conductor' : 'api'),
      cursor: 0,
      wakes: 0,
    })),
    attack_plan: PLAN,
    next_seq: 1,
    timeline: [],
  };
  const store = {
    get: () => record,
    list: () => [record],
    update: (
      _id: string,
      fn: ((r: SimulationRecord) => void) | Partial<SimulationRecord>,
    ) => {
      if (typeof fn === 'function') fn(record);
      else Object.assign(record, fn);
      return record;
    },
  };
  const timeline = new TimelineService(store as never);
  const posted: Array<{
    role: string;
    type: string;
    raw?: Record<string, unknown>;
  }> = [];
  const sims = {
    channels: () => ['email', 'support', 'phone', 'render'],
    advanceCursor: (_id: string, role: string, seq: number) => {
      const t = record.threads.find((x) => x.role === role)!;
      t.cursor = Math.max(t.cursor, seq);
    },
    postFromAgent: (
      id: string,
      role: string,
      input: { type: string; title: string; raw?: Record<string, unknown> },
    ) => {
      posted.push({ role, type: input.type, raw: input.raw });
      return timeline.append(id, role as never, input);
    },
  };
  const sandboxes = {
    get: () => ({
      render: { url: 'https://sbx-1.onrender.com' },
      manifest: { seed_users: [] },
    }),
  };
  const config = {
    get: (k: string) =>
      (
        ({ SIM_MAX_INCIDENTS: 3, ANTHROPIC_API_KEY: undefined }) as Record<
          string,
          unknown
        >
      )[k] ?? (k.startsWith('SIM_EFFORT') ? 'low' : 'claude-test'),
  };
  const brain = new SimulationBrain(
    config as never,
    sims as never,
    store as never,
    timeline,
    sandboxes as never,
  );
  const calls: string[] = [];
  const llm = {
    structured: vi.fn(async (call: { system: string }) => {
      calls.push(
        call.system.includes('Tu tarea: las notificaciones')
          ? 'generator'
          : 'observer',
      );
      const data = call.system.includes('Tu tarea: las notificaciones')
        ? {
            notifications: [
              {
                channel: 'email',
                title: 'No puedo entrar',
                body: 'Hola…',
                from: 'Martín <martin@x.cl>',
                severity: 'warning',
                vuln_id: W,
              },
              {
                channel: 'sentry',
                title: 'canal no detectado',
                body: '',
                from: null,
                severity: 'info',
                vuln_id: null,
              },
            ],
          }
        : {
            phase: 'under_attack',
            current_vuln: W,
            vulns: [],
            compromised: [],
            assessments: [],
            summary: 'Atacante adentro',
          };
      return {
        data,
        model: 'claude-test',
        ms: 5,
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      };
    }),
  };
  brain.useLlm(llm as unknown as SimLlm);
  brain.onModuleInit();
  return { brain, record, timeline, posted, llm, calls };
}

describe('SimulationBrain', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('un ataque produce notificaciones (solo por canales detectados) y un nuevo estado', async () => {
    const h = harness();
    h.timeline.append('sim-1', 'hacker', {
      type: 'attack.success',
      title: 'JWT robado',
      vuln_id: W,
      raw: {},
    });
    h.timeline.append('sim-1', 'hacker', {
      type: 'attack.done',
      title: 'fin',
      vuln_id: W,
      raw: { attacker_active: true },
    });
    await vi.advanceTimersByTimeAsync(3_000);
    const notifies = h.posted.filter((p) => p.type === 'notify');
    expect(notifies).toHaveLength(1);
    expect(notifies[0].raw).toEqual({
      channel: 'email',
      from: 'Martín <martin@x.cl>',
    });
    const state = h.posted.find((p) => p.type === 'state.update');
    expect(state?.raw?.attacker_active).toBe(true);
    expect(
      h.record.threads.find((t) => t.role === 'generator')!.cursor,
    ).toBeGreaterThan(0);
    h.brain.onModuleDestroy();
  });

  it('antes de partir no gasta llamadas al modelo', async () => {
    const h = harness();
    h.record.status = 'ready';
    h.timeline.append('sim-1', 'infra', {
      type: 'context.ready',
      title: 'ctx',
      raw: { summary: 'x' },
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.llm.structured).not.toHaveBeenCalled();
    h.brain.onModuleDestroy();
  });

  it('el director pide verificar al desplegarse un cambio', async () => {
    const h = harness();
    for (const e of attacked.slice(1))
      h.timeline.append('sim-1', e.actor, {
        type: e.type,
        title: e.title,
        vuln_id: e.vuln_id,
        raw: e.raw,
      });
    h.timeline.append(
      'sim-1',
      'system',
      { type: 'change.deployed', title: 'ok' },
      { trusted: true },
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(h.posted).toContainEqual(
      expect.objectContaining({ role: 'observer', type: 'control.verify' }),
    );
    h.brain.onModuleDestroy();
  });

  it('un pedido de infra recibe respuesta aunque no haya thread de infra', async () => {
    const h = harness();
    h.timeline.append('sim-1', 'coder', {
      type: 'infra.request',
      title: 'más RAM',
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(h.posted).toContainEqual(
      expect.objectContaining({ role: 'infra', type: 'infra.reply' }),
    );
    h.brain.onModuleDestroy();
  });
});

describe('ataques bloqueados', () => {
  it('un ataque que termina sin attack.success queda contenido y no frena al director', () => {
    const blocked = [
      ev(1, 'hacker', 'attack.plan', { raw: PLAN }),
      ev(2, 'user', 'control.start'),
      ev(3, 'hacker', 'attack.blocked', { vuln_id: W }),
      ev(4, 'hacker', 'attack.done', {
        vuln_id: W,
        min: 1,
        raw: { attacker_active: false },
      }),
    ];
    const f = computeFacts(blocked, PLAN);
    expect(f.vulns[W].status).toBe('contained');
    expect(f.attacker_active).toBe(false);
    // Sin verificaciones de por medio, escala después del tiempo de espera.
    expect(direct(sim(blocked), T0 + 10 * 60_000).map((a) => a.type)).toEqual([
      'next',
    ]);
  });

  it('un attack.success que llega después del done (fuera de orden) sigue contando', () => {
    const outOfOrder = [
      ev(1, 'hacker', 'attack.plan', { raw: PLAN }),
      ev(2, 'user', 'control.start'),
      ev(3, 'hacker', 'attack.done', {
        vuln_id: W,
        raw: { attacker_active: false },
      }),
      ev(4, 'hacker', 'attack.success', { vuln_id: W }),
    ];
    expect(computeFacts(outOfOrder, PLAN).vulns[W].status).toBe('exploited');
  });
});

describe('prompts de Conductor: reglas pedagógicas', () => {
  const p = (role: 'hacker' | 'coder' | 'infra' | 'generator') =>
    buildSimPrompt({ simId: 'sim-1', repoUrl: 'https://github.com/x/y', role });

  it('el hacker conoce las severidades válidas y no usa credenciales ajenas', () => {
    expect(p('hacker')).toContain(
      'acepta **solo** `info`, `warning` o `critical`',
    );
    expect(p('hacker')).toContain('No uses credenciales que no ganaste');
    expect(p('hacker')).toContain('`attacker_active` es **por vuln**');
  });

  it('el coder no nombra problemas que el developer no vio y responde corto', () => {
    expect(p('coder')).not.toContain('menciónalo y ofrece arreglarlo');
    expect(p('coder')).toContain(
      'No nombres problemas que el developer no ha visto',
    );
    expect(p('coder')).toContain('Máximo unas 120 palabras');
    expect(p('coder')).not.toContain('rotar `JWT_SECRET`');
  });

  it('los roles de respaldo no filtran la lección', () => {
    expect(p('infra')).toContain('No hagas análisis de seguridad');
    expect(p('generator')).toContain('Nunca expliques la causa ni el arreglo');
  });
});

describe('coherencia del incidente (sim-a53b6f4f)', () => {
  it('el generador no inventa monitores a la medida de la vuln', async () => {
    const { GENERATOR_SYSTEM } = await import('./prompts.js');
    expect(GENERATOR_SYSTEM).toContain(
      'Nunca inventes un monitor hecho a la medida de la vulnerabilidad',
    );
    expect(GENERATOR_SYSTEM).toContain(
      'analítica de producto, no de seguridad',
    );
  });

  it('el coder trata el incidente como real y parte por lo que pasó', () => {
    const p = buildSimPrompt({
      simId: 'sim-1',
      repoUrl: 'https://github.com/x/y',
      role: 'coder',
    });
    expect(p).toContain('es su app en producción y un incidente de verdad');
    expect(p).toContain('cuéntale primero qué pasó en su app');
    expect(p).toContain('que algo no aparezca no prueba que no pasó');
  });

  it('el coder no reconoce la tramoya del simulador', () => {
    const p = buildSimPrompt({
      simId: 'sim-1',
      repoUrl: 'https://github.com/x/y',
      role: 'coder',
    });
    expect(p).toContain(
      'Para el developer eres Claude, su asistente de código',
    );
    expect(p).toContain('no sabes de qué te hablan');
    expect(p).toContain('como si fuera producción');
  });
});
