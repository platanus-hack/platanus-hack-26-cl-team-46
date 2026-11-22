import { ConductorError } from '../conductor/conductor.client.js';
import { SimulationDispatcher } from './simulation.dispatcher.js';
import {
  EVENT_TYPES,
  type SimulationRecord,
  type TimelineEvent,
} from './simulation.types.js';

function record(simId: string): SimulationRecord {
  const e: TimelineEvent = {
    seq: 1,
    t: new Date().toISOString(),
    sim_id: simId,
    actor: 'user',
    type: 'user.message',
    visibility: EVENT_TYPES['user.message'].visibility,
    vuln_id: null,
    source: 'user',
    severity: 'info',
    title: 'hola',
    body: 'hola',
    raw: {},
  };
  return {
    sim_id: simId,
    sandbox_id: `sbx-${simId}`,
    repo_url: 'https://github.com/acme/apuntes',
    status: 'running',
    created_at: '',
    updated_at: '',
    hacker_mode: 'emulated',
    workspace_id: `ws-${simId}`,
    threads: [
      {
        role: 'coder',
        mode: 'conductor',
        session_id: `ses-${simId}`,
        cursor: 0,
        wakes: 0,
      },
    ],
    next_seq: 2,
    timeline: [e],
  };
}

function setup(sessionStatus: (sessionId: string) => Promise<unknown>) {
  const records = new Map(
    ['a', 'b'].map((id) => [id, record(id)] as [string, SimulationRecord]),
  );
  const store = {
    get: (id: string) => records.get(id),
    update: (id: string, fn: (r: SimulationRecord) => void) => {
      fn(records.get(id)!);
      return records.get(id);
    },
  };
  const sims = {
    active: () => [...records.values()],
    isActive: (s: SimulationRecord) => s.status === 'running',
    syncSandbox: vi.fn(),
    checkReady: vi.fn(),
    checkStartingTimeout: vi.fn(),
    launchingIds: new Set<string>(),
    fail: vi.fn(),
  };
  const conductor = {
    sessionStatus: vi.fn(sessionStatus),
    sendMessage: vi.fn(async () => ({})),
    workspaceStatus: vi.fn(async () => ({ status: 'archived' })),
  };
  const dispatcher = new SimulationDispatcher(
    sims as never,
    store as never,
    conductor as never,
    { onAppend: () => () => {} } as never,
    { tick: vi.fn() } as never,
  );
  return { dispatcher, sims, conductor };
}

describe('SimulationDispatcher', () => {
  it('un workspace archivado (error tipado) falla la simulación', async () => {
    const t = setup(async (id) => {
      if (id === 'ses-a')
        throw new ConductorError(
          'El servicio de agentes respondió con un error (HTTP 409)',
          409,
          'workspace_gone',
        );
      return { status: 'idle' };
    });
    await t.dispatcher.tick();
    expect(t.sims.fail).toHaveBeenCalledWith(
      'a',
      'El entorno de los agentes se detuvo',
    );
    expect(t.sims.fail).toHaveBeenCalledTimes(1);
    // La otra simulación sigue: su coder se despierta igual.
    expect(t.conductor.sendMessage).toHaveBeenCalledWith(
      'ses-b',
      expect.any(String),
    );
  });

  it('una llamada colgada en una simulación no frena a las demás', async () => {
    let release!: () => void;
    const hung = new Promise<{ status: string }>((r) => {
      release = () => r({ status: 'working' });
    });
    const t = setup(async (id) => (id === 'ses-a' ? hung : { status: 'idle' }));
    const tick = t.dispatcher.tick();
    await vi.waitFor(() =>
      expect(t.conductor.sendMessage).toHaveBeenCalledWith(
        'ses-b',
        expect.any(String),
      ),
    );
    // Mientras sigue colgada, un tick nuevo no se superpone (guardia de reentrada).
    await t.dispatcher.tick();
    expect(t.conductor.sessionStatus).toHaveBeenCalledTimes(2);
    release();
    await tick;
  });

  it('otros errores del servicio no fallan la simulación', async () => {
    const t = setup(async () => {
      throw new ConductorError('error (HTTP 500)', 500);
    });
    await t.dispatcher.tick();
    expect(t.sims.fail).not.toHaveBeenCalled();
  });
});
