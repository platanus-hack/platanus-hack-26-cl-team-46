import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { SandboxRecord } from '../sandboxes/sandbox.types.js';
import { AgentOrchestrator } from './agent.orchestrator.js';

const CONFIG: Record<string, unknown> = {
  AGENT_API_SECRET: 'secreto-de-prueba-largo',
  PUBLIC_BACKEND_URL: 'https://api.example.com',
  CONDUCTOR_API_KEY: 'k',
  GITHUB_TOKEN: 't',
  AGENT_MAX_PLANS: 6,
};

function record(patch: Partial<SandboxRecord> = {}): SandboxRecord {
  const now = new Date().toISOString();
  return {
    sandbox_id: 'sbx-0000aaaa',
    repo_url: 'https://github.com/a/app',
    mode: 'agent',
    status: 'provisioning',
    created_at: now,
    updated_at: now,
    env: {},
    pending_inputs: [],
    deploys: [],
    ...patch,
  };
}

const agent = {
  workspace_id: 'ws',
  session_id: 'se',
  deep_link: '',
  reason: '',
  started_at: new Date().toISOString(),
  plans_submitted: 0,
};

function setup(initial: SandboxRecord = record()) {
  const items = new Map([[initial.sandbox_id, initial]]);
  const store = {
    get: (id: string) => items.get(id),
    list: () => [...items.values()],
    update: (
      id: string,
      patch: Partial<SandboxRecord> | ((s: SandboxRecord) => void),
    ) => {
      const s = items.get(id)!;
      if (typeof patch === 'function') patch(s);
      else Object.assign(s, patch);
      return s;
    },
  };
  const conductor = {
    createWorkspace: vi.fn(),
    archiveWorkspace: vi.fn(async () => undefined),
    workspaceStatus: vi.fn(),
    sessionStatus: vi.fn(),
  };
  const orch = new AgentOrchestrator(
    { get: (k: string) => CONFIG[k] } as never,
    conductor as never,
    store as never,
    { emit: vi.fn() } as never,
  );
  return { orch, conductor, store };
}

describe('AgentOrchestrator.requireRunning (escrituras del agente)', () => {
  it('deja escribir con el agente activo o mientras se lanza la VM', () => {
    const { orch } = setup();
    expect(() => orch.requireRunning(record({ agent }))).not.toThrow();
    expect(() =>
      orch.requireRunning(
        record({ agent_launching_at: new Date().toISOString() }),
      ),
    ).not.toThrow();
  });

  it('rechaza con la corrida terminada, sin agente o con el sandbox borrándose', () => {
    const { orch } = setup();
    for (const s of [
      record({ agent: { ...agent, finished_at: new Date().toISOString() } }),
      record(),
      record({ agent, deleting_at: new Date().toISOString() }),
      record({ agent, status: 'deleted' }),
    ])
      expect(() => orch.requireRunning(s)).toThrow(ConflictException);
  });
});

describe('AgentOrchestrator.start (lanzamiento con marcador)', () => {
  it('marca el lanzamiento antes de crear la VM y lo cambia por el agente después', async () => {
    const { orch, conductor, store } = setup();
    let created!: (v: unknown) => void;
    conductor.createWorkspace.mockReturnValue(
      new Promise((r) => (created = r)),
    );
    const started = orch.start('sbx-0000aaaa', 'motivo');
    await Promise.resolve();
    const during = store.get('sbx-0000aaaa')!;
    expect(during.status).toBe('analyzing');
    expect(during.agent_launching_at).toBeDefined();
    expect(during.agent).toBeUndefined();

    created({ workspaceId: 'ws-1', sessionId: 'se-1', deepLink: '' });
    await started;
    const after = store.get('sbx-0000aaaa')!;
    expect(after.agent?.workspace_id).toBe('ws-1');
    expect(after.agent_launching_at).toBeUndefined();
  });

  it('si crear la VM falla, quita el marcador y propaga el error', async () => {
    const { orch, conductor, store } = setup();
    conductor.createWorkspace.mockRejectedValue(new Error('sin VMs'));
    await expect(orch.start('sbx-0000aaaa', 'motivo')).rejects.toThrow(
      'sin VMs',
    );
    expect(store.get('sbx-0000aaaa')!.agent_launching_at).toBeUndefined();
  });

  it('no lanza nada si el sandbox se está borrando', async () => {
    const { orch, conductor } = setup(
      record({ deleting_at: new Date().toISOString() }),
    );
    await orch.start('sbx-0000aaaa', 'motivo');
    expect(conductor.createWorkspace).not.toHaveBeenCalled();
  });
});

describe('AgentOrchestrator.monitor', () => {
  it('no se solapa consigo mismo si una vuelta tarda más que el intervalo', async () => {
    const { orch, conductor } = setup(record({ status: 'analyzing', agent }));
    let release!: (v: unknown) => void;
    conductor.workspaceStatus.mockReturnValue(
      new Promise((r) => (release = r)),
    );
    const monitor = (
      orch as unknown as { monitor(): Promise<void> }
    ).monitor.bind(orch);
    const first = monitor();
    await monitor(); // vuelve al tiro: la primera sigue corriendo
    expect(conductor.workspaceStatus).toHaveBeenCalledTimes(1);
    release({ status: 'initializing' });
    await first;
  });
});
