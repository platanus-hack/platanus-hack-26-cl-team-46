import { EVENT_TYPES, type SimulationRecord, type TimelineEvent } from '../simulation.types.js';
import { EngineHacker, attackerStillInside } from './engine.hacker.js';
import type { EngineRunResult } from './engine.client.js';

const CONFIG: Record<string, unknown> = {
  ENGINE_REPLAY_STEP_SECONDS: 30,
  ENGINE_PLUGIN: 'apuntes',
  AGENT_API_SECRET: 'secreto',
  PUBLIC_BACKEND_URL: 'https://api.mayday.test/',
};

const REPLAY = {
  'jwt-not-invalidated-on-password-change': [
    { type: 'attack.step', vuln_id: 'jwt-not-invalidated-on-password-change', severity: 'info', title: 'Robo de token', body: 'GET /api/notes — 200', raw: {} },
    { type: 'attack.success', vuln_id: 'jwt-not-invalidated-on-password-change', severity: 'warning', title: 'Explotada', body: '', raw: { foothold: { type: 'jwt', detail: 'JWT válido 30 días' } } },
    { type: 'attack.done', vuln_id: 'jwt-not-invalidated-on-password-change', severity: 'info', title: 'Fin', body: '', raw: { attacker_active: true } },
  ],
  idor: [
    { type: 'attack.step', vuln_id: 'idor', severity: 'info', title: 'Enumera notas', body: '', raw: {} },
    { type: 'attack.success', vuln_id: 'idor', severity: 'critical', title: 'Explotada', body: '', raw: { foothold: { type: 'data' } } },
    { type: 'attack.done', vuln_id: 'idor', severity: 'info', title: 'Fin', body: '', raw: { attacker_active: false } },
  ],
};

const FIRST_PASS: EngineRunResult = {
  ok: true,
  exit_code: 0,
  duration_s: 40,
  log: '',
  stderr: '',
  artifacts: {
    attack_plan: {
      raw: {
        target: 'https://sbx-1.onrender.com',
        findings: [
          { vuln_id: 'idor', title: 'IDOR', severity: 'high', order: 3, confirmed: true, repo_ref: { file: 'src/routes/notes.ts', line: 4 } },
          { vuln_id: 'jwt-not-invalidated-on-password-change', title: 'JWT', severity: 'high', order: 2, confirmed: true, location: '.env.example:2' },
          { vuln_id: 'stored-xss', title: 'XSS', severity: 'high', order: 8, confirmed: false },
        ],
      },
    },
    diagnosis: { summary: { confirmed: 2, total: 3, requests: 45 }, duration_ms: 1100 },
    replay: REPLAY,
  },
};

function setup(over: Partial<SimulationRecord> = {}) {
  const records = new Map<string, SimulationRecord>();
  const sim: SimulationRecord = {
    sim_id: 'sim-1',
    sandbox_id: 'sbx-1',
    repo_url: 'https://github.com/acme/apuntes',
    status: 'starting',
    created_at: '',
    updated_at: '',
    hacker_mode: 'external',
    engine_driven: true,
    threads: [],
    next_seq: 1,
    timeline: [],
    sandbox_commit: 'abc1234',
    ...over,
  };
  records.set(sim.sim_id, sim);
  let listener: (e: TimelineEvent) => void = () => {};
  const append = (actor: TimelineEvent['actor'], input: Partial<TimelineEvent> & { type: string }) => {
    const s = records.get('sim-1')!;
    const e: TimelineEvent = {
      seq: s.next_seq++,
      t: new Date().toISOString(),
      sim_id: 'sim-1',
      actor,
      visibility: EVENT_TYPES[input.type]?.visibility ?? 'internal',
      vuln_id: null,
      source: String(actor),
      severity: 'info',
      title: input.type,
      body: '',
      raw: {},
      ...input,
    };
    s.timeline.push(e);
    listener(e);
    return e;
  };
  const store = {
    get: (id: string) => records.get(id),
    list: () => [...records.values()],
    update: (id: string, patch: Partial<SimulationRecord> | ((r: SimulationRecord) => void)) => {
      const r = records.get(id)!;
      if (typeof patch === 'function') patch(r);
      else Object.assign(r, patch);
      return r;
    },
  };
  const sims = {
    get: (id: string) => records.get(id)!,
    fail: vi.fn(),
    // Como el servicio real: el attack.plan queda guardado en la simulación.
    postFromAgent: vi.fn((_id: string, role: string, input: Partial<TimelineEvent> & { type: string }) => {
      if (input.type === 'attack.plan') records.get('sim-1')!.attack_plan = input.raw;
      return append(role as TimelineEvent['actor'], input);
    }),
  };
  const client = {
    enabled: true,
    start: vi.fn(async (_spec: Record<string, unknown>) => 'fc-1'),
    status: vi.fn(async () => ({ status: 'done' as const, result: FIRST_PASS })),
  };
  const sandboxes = {
    get: () => ({
      deploy_repo_url: 'https://github.com/mayday-sbx/sbx-1',
      commit_sha: 'abc1234',
      render: { url: 'https://sbx-1.onrender.com' },
      manifest: { seed_users: [{ email: 'admin@x.cl', password: 'a', role: 'admin' }, { email: 'martin@x.cl', password: 'qwerty123', role: 'user' }] },
    }),
  };
  const timeline = { onAppend: (l: (e: TimelineEvent) => void) => ((listener = l), () => {}) };
  const config = { get: (k: string) => CONFIG[k] };
  const hacker = new EngineHacker(
    config as never,
    client as never,
    store as never,
    timeline as never,
    sims as never,
    sandboxes as never,
  );
  hacker.onModuleInit();
  return { hacker, sim: () => records.get('sim-1')!, sims, client, append, tick: () => (hacker as unknown as { tick(): Promise<void> }).tick() };
}

describe('EngineHacker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lanza la primera pasada cuando la app queda desplegada', async () => {
    const t = setup();
    t.append('system', { type: 'deploy.ready' });
    await vi.waitFor(() => expect(t.client.start).toHaveBeenCalled());
    const spec = t.client.start.mock.calls[0][0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(spec).toMatchObject({
      url: 'https://sbx-1.onrender.com',
      // El mirror desplegado: sandbox_commit es un sha del mirror, no del repo original.
      repo: 'https://github.com/mayday-sbx/sbx-1',
      commit: 'abc1234',
      plugin: 'apuntes',
      weak_login: { email: 'martin@x.cl', password: 'qwerty123' },
      progress: { url: 'https://api.mayday.test/sim/sim-1/engine/progress' },
    });
    expect(spec.progress.token).toMatch(/^sim-1\./);
    expect(t.sim().engine).toMatchObject({ status: 'running', call_id: 'fc-1' });
  });

  it('con el resultado publica el plan solo con lo confirmado y con archivo y línea', async () => {
    const t = setup();
    t.append('system', { type: 'deploy.ready' });
    await vi.waitFor(() => expect(t.sim().engine?.call_id).toBe('fc-1'));
    await t.tick();
    const plan = t.sim().timeline.find((e) => e.type === 'attack.plan')!;
    expect(plan.actor).toBe('hacker');
    const findings = plan.raw.findings as { vuln_id: string; file?: string; line?: number }[];
    expect(findings.map((f) => f.vuln_id)).toEqual(['idor', 'jwt-not-invalidated-on-password-change']);
    expect(findings[0]).toMatchObject({ file: 'src/routes/notes.ts', line: 4 });
    expect(findings[1]).toMatchObject({ file: '.env.example', line: 2 });
    expect(t.sim().engine).toMatchObject({ status: 'done', summary: { confirmed: 2, total: 3, requests: 45, correlated: 2 } });
  });

  it('guarda el avance en vivo mientras corre', async () => {
    const t = setup();
    t.append('system', { type: 'deploy.ready' });
    await vi.waitFor(() => expect(t.sim().engine).toBeDefined());
    t.hacker.progress('sim-1', ['▶ idor (read-only)', '  → [idor] CONFIRMADO']);
    expect(t.sim().engine!.log.slice(-2)).toEqual(['▶ idor (read-only)', '  → [idor] CONFIRMADO']);
  });

  it('repite los pasos reales de una vuln con reloj humano, en orden y respetando la pausa', async () => {
    const t = setup();
    t.append('system', { type: 'deploy.ready' });
    await vi.waitFor(() => expect(t.sim().engine?.call_id).toBe('fc-1'));
    await t.tick();
    t.hacker.select('sim-1', ['jwt-not-invalidated-on-password-change', 'idor']);
    t.sim().status = 'running';
    t.append('user', { type: 'control.start' });
    const attacks = () => t.sim().timeline.filter((e) => e.actor === 'hacker' && e.type !== 'attack.plan');
    expect(attacks()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(attacks().map((e) => e.type)).toEqual(['attack.step']);
    expect(attacks()[0].vuln_id).toBe('jwt-not-invalidated-on-password-change');
    expect(attacks()[0].raw.replay).toBe(true);
    t.append('user', { type: 'control.pause' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(attacks()).toHaveLength(1);
    t.append('user', { type: 'control.resume' });
    await vi.advanceTimersByTimeAsync(4_000 + 2 * 39_000);
    expect(attacks().map((e) => e.type)).toEqual(['attack.step', 'attack.success', 'attack.done']);
    // control.next sigue con la siguiente elegida.
    t.append('observer', { type: 'control.next' });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(attacks().at(-1)!.vuln_id).toBe('idor');
    // El plan quedó solo con las elegidas, con `order` reescrito (planOrder ordena por ese campo).
    const plan = t.sim().attack_plan as { findings: { vuln_id: string; order: number }[] };
    expect(plan.findings.map((f) => [f.vuln_id, f.order])).toEqual([
      ['jwt-not-invalidated-on-password-change', 1],
      ['idor', 2],
    ]);
  });

  it('ignora control.next de una vuln que no se eligió', async () => {
    const t = setup();
    t.append('system', { type: 'deploy.ready' });
    await vi.waitFor(() => expect(t.sim().engine?.call_id).toBe('fc-1'));
    await t.tick();
    t.hacker.select('sim-1', ['jwt-not-invalidated-on-password-change']);
    t.sim().status = 'running';
    t.append('observer', { type: 'control.next', raw: { vuln_id: 'idor' } });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.sim().timeline.some((e) => e.actor === 'hacker' && e.vuln_id === 'idor')).toBe(false);
  });

  it('no toca simulaciones external que no son del motor interno', async () => {
    const t = setup({ engine_driven: undefined });
    t.append('system', { type: 'deploy.ready' });
    await t.tick();
    expect(t.client.start).not.toHaveBeenCalled();
    expect(t.sims.fail).not.toHaveBeenCalled();
  });

  it('una primera pasada que quedó sin call_id (reinicio) falla en vez de colgarse', async () => {
    const t = setup({
      deploy_ready_at: 'x',
      engine: { status: 'running', started_at: new Date(Date.now() - 10 * 60_000).toISOString(), log: [], played: [], verifies: [] },
    });
    await t.tick();
    expect(t.sim().engine!.status).toBe('failed');
    expect(t.sims.fail).toHaveBeenCalled();
  });

  it('verifica atacando de verdad solo esa vuln y decide si el atacante sigue adentro', async () => {
    const t = setup();
    t.append('system', { type: 'deploy.ready' });
    await vi.waitFor(() => expect(t.sim().engine?.call_id).toBe('fc-1'));
    await t.tick();
    t.sim().status = 'running';
    t.append('user', { type: 'control.start' });
    await vi.advanceTimersByTimeAsync(200_000);

    t.client.start.mockResolvedValueOnce('fc-verify');
    t.client.status.mockResolvedValueOnce({
      status: 'done',
      result: { ...FIRST_PASS, artifacts: { diagnoses: [{ vuln_id: 'jwt-not-invalidated-on-password-change', verdict: 'confirmed' }] } },
    });
    const verify = t.append('observer', { type: 'control.verify', raw: { vuln_id: 'jwt-not-invalidated-on-password-change' } });
    await vi.waitFor(() => expect(t.client.start).toHaveBeenCalledTimes(2));
    expect(t.client.start.mock.calls[1][0]).toMatchObject({ only: ['jwt-not-invalidated-on-password-change'], no_recon: true, seed: `sim-1-verify-${verify.seq}` });
    await vi.waitFor(() => expect(t.sim().engine!.verifies[0].call_id).toBe('fc-verify'));
    await t.tick();
    const v = t.sim().timeline.find((e) => e.type === 'attack.verify')!;
    expect(v.raw).toMatchObject({ still_exploitable: true, attacker_active: true, verified_live: true });
    expect(t.sim().engine!.verifies[0].status).toBe('done');
  });

  it('un veredicto inconclusive no cuenta como arreglado', async () => {
    const t = setup();
    t.append('system', { type: 'deploy.ready' });
    await vi.waitFor(() => expect(t.sim().engine?.call_id).toBe('fc-1'));
    await t.tick();
    t.sim().status = 'running';
    t.client.start.mockResolvedValueOnce('fc-verify');
    t.client.status.mockResolvedValueOnce({
      status: 'done',
      result: { ...FIRST_PASS, artifacts: { diagnoses: [{ vuln_id: 'idor', verdict: 'inconclusive' }] } },
    });
    t.append('observer', { type: 'control.verify', raw: { vuln_id: 'idor' } });
    await vi.waitFor(() => expect(t.sim().engine!.verifies[0]?.call_id).toBe('fc-verify'));
    await t.tick();
    const v = t.sim().timeline.find((e) => e.type === 'attack.verify')!;
    expect(v.raw).toMatchObject({ still_exploitable: true, verified_live: false });
  });
});

describe('attackerStillInside', () => {
  const base = (timeline: Partial<TimelineEvent>[]): SimulationRecord =>
    ({
      engine: { replay: REPLAY },
      timeline: timeline.map((e, i) => ({ seq: i + 1, actor: 'system', raw: {}, vuln_id: null, ...e })),
    }) as unknown as SimulationRecord;
  const attacked = { actor: 'hacker' as const, type: 'attack.step', vuln_id: 'jwt-not-invalidated-on-password-change' };
  const vuln = 'jwt-not-invalidated-on-password-change';

  it('cambiar la contraseña no saca al atacante: su JWT sigue sirviendo', () => {
    const r = attackerStillInside(base([attacked, { type: 'change.db' }, { type: 'change.deployed' }]), vuln, true);
    expect(r.active).toBe(true);
    expect(r.footholds[0].valid).toBe(true);
  });

  it('rotar JWT_SECRET sin desplegar todavía no lo saca', () => {
    const r = attackerStillInside(base([attacked, { type: 'change.env', raw: { keys: ['JWT_SECRET'] } }]), vuln, true);
    expect(r.active).toBe(true);
  });

  it('rotar JWT_SECRET y desplegar lo saca si la vuln ya no responde', () => {
    const r = attackerStillInside(
      base([attacked, { type: 'change.env', raw: { keys: ['JWT_SECRET'] } }, { type: 'change.deployed' }]),
      vuln,
      false,
    );
    expect(r.active).toBe(false);
    expect(r.footholds[0].valid).toBe(false);
  });

  it('rotar JWT_SECRET no basta si la vuln sigue explotable: roba un token nuevo', () => {
    const r = attackerStillInside(
      base([attacked, { type: 'change.env', raw: { keys: ['JWT_SECRET'] } }, { type: 'change.deployed' }]),
      vuln,
      true,
    );
    expect(r.active).toBe(true);
    expect(r.footholds[0].valid).toBe(false);
  });

  it('una fuga de datos no deja acceso persistente', () => {
    const r = attackerStillInside(base([{ ...attacked, vuln_id: 'idor' }]), 'idor', true);
    expect(r.active).toBe(false);
  });
});
