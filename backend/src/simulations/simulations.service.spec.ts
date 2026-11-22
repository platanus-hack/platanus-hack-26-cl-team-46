import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConductorError } from '../conductor/conductor.client.js';
import { SandboxesService } from '../sandboxes/sandboxes.service.js';
import { REDACTED } from './redact-secrets.js';
import {
  canTransition,
  CLOSED_STATUSES,
  TRANSITIONS,
  type SimStatus,
  type SimulationRecord,
} from './simulation.types.js';
import { SimulationsService } from './simulations.service.js';
import { TimelineService } from './timeline.service.js';

const CONDUCTOR_KEY = 'cdr_live_1234567890abcdef';
const PLAN = {
  findings: [
    {
      vuln_id: 'idor',
      title: 'IDOR',
      file: 'src/routes/notes.ts',
      line: 42,
      severity: 'high',
      order: 1,
    },
    { vuln_id: 'sqli', severity: 'critical', order: 2 },
  ],
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(config: Record<string, unknown> = {}) {
  const records = new Map<string, SimulationRecord>();
  const store = {
    get: (id: string) => records.get(id),
    list: () => [...records.values()],
    insert: (r: SimulationRecord) => (records.set(r.sim_id, r), r),
    update: (
      id: string,
      patch: Partial<SimulationRecord> | ((r: SimulationRecord) => void),
    ) => {
      const r = records.get(id);
      if (!r) throw new Error(`Simulación ${id} no existe`);
      if (typeof patch === 'function') patch(r);
      else Object.assign(r, patch);
      return r;
    },
  };
  const timeline = new TimelineService(store as never);
  const CONFIG: Record<string, unknown> = {
    AGENT_API_SECRET: 'secreto-suficientemente-largo',
    PUBLIC_BACKEND_URL: 'https://api.test',
    CONDUCTOR_API_KEY: CONDUCTOR_KEY,
    GITHUB_TOKEN: 'token-github-de-prueba',
    ANTHROPIC_API_KEY: 'clave-anthropic-de-prueba',
    SIM_API_ROLES: 'infra,observer,generator',
    SIM_DEBUG_VIEW: false,
    ...config,
  };
  const sbx = {
    sandbox_id: 'sbx-1',
    repo_url: 'https://github.com/acme/apuntes',
    status: 'ready',
    commit_sha: 'abc1234',
    render: { url: 'https://sbx-1.onrender.com' },
    manifest: {
      seed_users: [
        { email: 'martin@x.cl', password: 'qwerty123', role: 'user' },
      ],
    },
  };
  const sandboxes = {
    get: vi.fn((id: string) => {
      if (id !== 'sbx-1') throw new NotFoundException();
      return sbx;
    }),
    list: () => [sbx],
    findReusable: vi.fn((): unknown => undefined),
    create: vi.fn(async () => ({ sandbox_id: 'sbx-2' })),
    touch: vi.fn(),
    registerUsage: vi.fn(),
    isBusy: () => false,
    waitIdle: vi.fn(async () => {}),
  };
  const unsubscribe = vi.fn();
  const sandboxEvents = { subscribe: vi.fn(() => unsubscribe) };
  const conductor = {
    createWorkspace: vi.fn(async () => ({
      workspaceId: 'ws-1',
      sessionId: 'ses-hacker',
      deepLink: 'conductor://w&session=1',
    })),
    createSession: vi.fn(async () => ({
      id: 'ses-coder',
      deepLink: 'conductor://s',
    })),
    archiveWorkspace: vi.fn(async () => ({})),
  };
  const sims = new SimulationsService(
    { get: (k: string) => CONFIG[k] } as never,
    store as never,
    timeline,
    sandboxes as never,
    sandboxEvents as never,
    conductor as never,
    {} as never,
  );
  const insert = (over: Partial<SimulationRecord> = {}) =>
    store.insert({
      sim_id: 'sim-1',
      sandbox_id: 'sbx-1',
      repo_url: sbx.repo_url,
      status: 'running',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      hacker_mode: 'emulated',
      tools_detected: [],
      workspace_id: 'ws-1',
      threads: [
        { role: 'hacker', mode: 'conductor', cursor: 0, wakes: 0 },
        { role: 'observer', mode: 'api', cursor: 0, wakes: 0 },
        { role: 'coder', mode: 'conductor', cursor: 0, wakes: 0 },
      ],
      attack_plan: structuredClone(PLAN),
      next_seq: 1,
      timeline: [],
      ...over,
    });
  return {
    sims,
    records,
    timeline,
    sandboxes,
    conductor,
    unsubscribe,
    insert,
    sim: (id = 'sim-1') => records.get(id)!,
  };
}

describe('máquina de estados', () => {
  it('los estados cerrados no tienen salida y los vivos pueden cerrarse', () => {
    for (const s of CLOSED_STATUSES) expect(TRANSITIONS[s]).toEqual([]);
    for (const s of ['starting', 'ready', 'running', 'paused'] as SimStatus[]) {
      expect(canTransition(s, 'failed')).toBe(true);
      expect(canTransition(s, 'stopped')).toBe(true);
    }
  });

  it('solo se parte desde ready y solo se termina con el incidente en curso', () => {
    expect(canTransition('ready', 'running')).toBe(true);
    expect(canTransition('starting', 'running')).toBe(false);
    expect(canTransition('running', 'finished')).toBe(true);
    expect(canTransition('paused', 'finished')).toBe(true);
    expect(canTransition('ready', 'finished')).toBe(false);
    expect(canTransition('stopped', 'finished')).toBe(false);
  });
});

describe('SimulationsService', () => {
  afterEach(() => vi.useRealTimers());

  describe('un sandbox, una simulación viva', () => {
    it('no reusa ni deja pedir un sandbox con una simulación en curso', async () => {
      const h = harness();
      h.insert({ status: 'ready' });
      await expect(h.sims.create({ sandbox_id: 'sbx-1' })).rejects.toThrow(
        ConflictException,
      );
      await h.sims.create({ repo_url: 'https://github.com/acme/apuntes' });
      const opts = h.sandboxes.findReusable.mock.calls[0] as unknown as [
        { busy: Set<string> },
      ];
      expect([...opts[0].busy]).toEqual(['sbx-1']);
      expect(h.sandboxes.create).toHaveBeenCalled();
    });

    it('con la simulación anterior cerrada, el sandbox se vuelve a usar', async () => {
      const h = harness();
      h.insert({ status: 'finished' });
      const view = await h.sims.create({ sandbox_id: 'sbx-1' });
      expect(view.sandbox.sandbox_id).toBe('sbx-1');
    });

    it('findReusable salta los sandboxes ocupados', () => {
      const base = {
        status: 'ready',
        repo_url: 'https://github.com/acme/apuntes',
      };
      const store = {
        list: () => [
          { ...base, sandbox_id: 'sbx-1', updated_at: '2026-11-22T10:00:00Z' },
          { ...base, sandbox_id: 'sbx-2', updated_at: '2026-11-22T09:00:00Z' },
        ],
      };
      const find = (busy?: Set<string>) =>
        SandboxesService.prototype.findReusable.call({ store } as never, {
          repo_url: base.repo_url,
          busy,
        })?.sandbox_id;
      expect(find()).toBe('sbx-1');
      expect(find(new Set(['sbx-1']))).toBe('sbx-2');
      expect(find(new Set(['sbx-1', 'sbx-2']))).toBeUndefined();
    });

    it('findReusable salta un sandbox que se está borrando', () => {
      const store = {
        list: () => [
          {
            status: 'ready',
            repo_url: 'https://github.com/acme/apuntes',
            sandbox_id: 'sbx-1',
            updated_at: '2026-11-22T10:00:00Z',
            deleting_at: '2026-11-22T10:05:00Z',
          },
        ],
      };
      expect(
        SandboxesService.prototype.findReusable.call({ store } as never, {
          repo_url: 'https://github.com/acme/apuntes',
        }),
      ).toBeUndefined();
    });
  });

  describe('cierre', () => {
    it('al terminar archiva el workspace y suelta el puente, una sola vez', async () => {
      const h = harness();
      h.insert();
      h.sims.onModuleInit();
      h.sims.postFromAgent('sim-1', 'observer', {
        type: 'sim.finished',
        title: 'Simulación terminada',
        raw: { summary: 'ok' },
      });
      expect(h.sim().status).toBe('finished');
      await vi.waitFor(() =>
        expect(h.sim().workspace_archived_at).toBeDefined(),
      );
      expect(h.conductor.archiveWorkspace).toHaveBeenCalledWith('ws-1');
      expect(h.unsubscribe).toHaveBeenCalled();
      await h.sims.stop('sim-1');
      expect(h.conductor.archiveWorkspace).toHaveBeenCalledTimes(1);
      expect(h.sim().status).toBe('finished');
    });

    it('al fallar también se archiva el workspace', async () => {
      const h = harness();
      h.insert();
      h.sims.fail('sim-1', 'se cayó');
      await vi.waitFor(() =>
        expect(h.conductor.archiveWorkspace).toHaveBeenCalledWith('ws-1'),
      );
    });

    it('un debrief que llega después de un Stop no la reabre como terminada', async () => {
      const h = harness();
      h.insert();
      await h.sims.stop('sim-1');
      expect(h.sim().status).toBe('stopped');
      expect(() =>
        h.sims.postFromAgent('sim-1', 'observer', {
          type: 'sim.finished',
          title: 'Simulación terminada',
          raw: { summary: 'tarde' },
        }),
      ).toThrow(ConflictException);
      expect(h.sim().status).toBe('stopped');
      expect(h.sim().debrief).toBeUndefined();
    });

    it('si se detiene mientras se crea la VM, archiva lo creado y no crea threads', async () => {
      const h = harness();
      const ws = deferred<{
        workspaceId: string;
        sessionId: string;
        deepLink: string;
      }>();
      h.conductor.createWorkspace.mockReturnValueOnce(ws.promise);
      const { sim_id } = await h.sims.create({ sandbox_id: 'sbx-1' });
      await vi.waitFor(() =>
        expect(h.conductor.createWorkspace).toHaveBeenCalled(),
      );
      await h.sims.stop(sim_id);
      ws.resolve({
        workspaceId: 'ws-tarde',
        sessionId: 'ses-1',
        deepLink: 'conductor://w',
      });
      await vi.waitFor(() =>
        expect(h.conductor.archiveWorkspace).toHaveBeenCalledWith('ws-tarde'),
      );
      expect(h.conductor.createSession).not.toHaveBeenCalled();
      expect(h.sim(sim_id).status).toBe('stopped');
    });
  });

  describe('preparación con reintentos acotados', () => {
    it('reintenta crear el workspace con backoff y falla después de 8 intentos', async () => {
      vi.useFakeTimers();
      const h = harness();
      h.insert({ status: 'starting', workspace_id: undefined });
      h.conductor.createWorkspace.mockRejectedValue(new Error('caído'));
      await h.sims.launch('sim-1');
      expect(h.conductor.createWorkspace).toHaveBeenCalledTimes(1);
      // Dentro del backoff no se vuelve a intentar.
      await h.sims.launch('sim-1');
      expect(h.conductor.createWorkspace).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 7; i++) {
        vi.advanceTimersByTime(60_000);
        await h.sims.launch('sim-1');
      }
      expect(h.conductor.createWorkspace).toHaveBeenCalledTimes(8);
      expect(h.sim().status).toBe('failed');
      expect(h.sim().error).toContain('8 intentos');
    });

    it('un workspace caído al crear threads falla la simulación al tiro', async () => {
      const h = harness();
      h.insert({ status: 'starting' });
      h.sim().threads[2].session_id = undefined;
      h.sim().threads[0].session_id = 'ses-hacker';
      h.conductor.createSession.mockRejectedValue(
        new ConductorError('error (HTTP 409)', 409, 'workspace_gone'),
      );
      await h.sims.createMissingThreads('sim-1');
      expect(h.sim().status).toBe('failed');
    });

    it('watchdog: falla una simulación que no queda lista en 20 minutos', () => {
      const h = harness();
      const now = Date.parse('2026-11-22T12:00:00Z');
      h.insert({
        status: 'starting',
        created_at: '2026-11-22T11:00:00Z',
        deploy_ready_at: '2026-11-22T11:39:00Z',
      });
      h.sims.checkStartingTimeout('sim-1', now - 2 * 60_000);
      expect(h.sim().status).toBe('starting');
      h.sims.checkStartingTimeout('sim-1', now);
      expect(h.sim().status).toBe('failed');
      expect(h.sim().error).toContain('20 minutos');
    });

    it('watchdog: no corre mientras el sandbox sigue desplegando', () => {
      const h = harness();
      h.sandboxes.get.mockReturnValue({
        ...h.sandboxes.get('sbx-1'),
        status: 'deploying',
      });
      h.insert({ status: 'starting', created_at: '2026-11-22T10:00:00Z' });
      h.sims.checkStartingTimeout('sim-1', Date.parse('2026-11-22T12:00:00Z'));
      expect(h.sim().status).toBe('starting');
    });
  });

  describe('lo que ve cada uno', () => {
    it('el jugador no ve la hoja de respuestas con el incidente vivo', () => {
      const h = harness();
      h.insert({
        state: {
          phase: 'under_attack',
          attacker_active: true,
          current_vuln: 'idor',
          vulns: {},
          compromised: [],
          assessments: [],
        },
      });
      const live = h.sims.playerView(h.sim());
      expect(JSON.stringify(live)).not.toContain('src/routes/notes.ts');
      expect(live.state).toEqual({ phase: 'under_attack' });
      expect(h.sims.canSeeInternals(h.sim())).toBe(false);
      h.sim().status = 'finished';
      expect(h.sims.playerView(h.sim()).attack_plan).toEqual(PLAN);
      expect(h.sims.canSeeInternals(h.sim())).toBe(true);
    });

    it('con SIM_DEBUG_VIEW se ve todo aunque esté vivo', () => {
      const h = harness({ SIM_DEBUG_VIEW: true });
      h.insert();
      expect(h.sims.playerView(h.sim()).attack_plan).toEqual(PLAN);
    });

    it('GET /sim/:id/deploy no le da contraseñas al coder', async () => {
      const h = harness();
      h.insert();
      const coder = await h.sims.deployStatus('sim-1', 0, 'coder');
      expect(coder.seed_users).toEqual([
        { email: 'martin@x.cl', role: 'user' },
      ]);
      const hacker = await h.sims.deployStatus('sim-1', 0, 'hacker');
      expect(hacker.seed_users[0]).toHaveProperty('password', 'qwerty123');
    });

    it('lo que escribe el coder no guarda credenciales del backend', () => {
      const h = harness();
      h.insert();
      const e = h.sims.postFromAgent('sim-1', 'coder', {
        type: 'coder.reply',
        title: `Listo (${CONDUCTOR_KEY})`,
        body: `Encontré CONDUCTOR_API_KEY=${CONDUCTOR_KEY} en el entorno`,
        raw: { env: { CONDUCTOR_API_KEY: CONDUCTOR_KEY } },
      });
      expect(JSON.stringify(e)).not.toContain(CONDUCTOR_KEY);
      expect(e.body).toBe(
        `Encontré CONDUCTOR_API_KEY=${REDACTED} en el entorno`,
      );
    });
  });

  describe('vulns fuera del plan', () => {
    it('control next/verify con una vuln que no está en el plan responde 400', () => {
      const h = harness();
      h.insert();
      expect(() => h.sims.control('sim-1', 'next', 'no-existe')).toThrow(
        BadRequestException,
      );
      expect(() => h.sims.control('sim-1', 'verify', 'no-existe')).toThrow(
        BadRequestException,
      );
      expect(() =>
        h.sims.postFromAgent('sim-1', 'observer', {
          type: 'control.next',
          title: 'next',
          vuln_id: 'no-existe',
          raw: { vuln_id: 'no-existe' },
        }),
      ).toThrow(BadRequestException);
      h.sims.control('sim-1', 'next', 'sqli');
      expect(h.sim().timeline.at(-1)).toMatchObject({
        type: 'control.next',
        vuln_id: 'sqli',
      });
    });
  });
});
