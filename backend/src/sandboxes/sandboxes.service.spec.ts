import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RenderApiError } from '../render/render.client.js';
import type { SandboxManifest } from './manifest.js';
import type { SandboxRecord } from './sandbox.types.js';
import {
  SandboxDeletedError,
  SandboxesService,
  shouldRecreateService,
} from './sandboxes.service.js';

/** Store en memoria con la misma semántica de update que SandboxStore. */
class MemoryStore {
  readonly items = new Map<string, SandboxRecord>();
  get(id: string) {
    return this.items.get(id);
  }
  list() {
    return [...this.items.values()];
  }
  insert(r: SandboxRecord) {
    this.items.set(r.sandbox_id, r);
    return r;
  }
  update(
    id: string,
    patch: Partial<SandboxRecord> | ((s: SandboxRecord) => void),
  ) {
    const current = this.items.get(id)!;
    if (typeof patch === 'function') patch(current);
    else Object.assign(current, patch);
    current.updated_at = new Date().toISOString();
    return current;
  }
  async refreshFromDatabase() {}
}

const CONFIG: Record<string, unknown> = {
  SANDBOX_MAX_PER_USER: 1,
  RENDER_SERVICE_LIMIT: 100,
  SANDBOX_IDLE_TTL_HOURS: 3,
  SANDBOX_FAILED_TTL_HOURS: 1,
  SANDBOX_DUPLICATE_GRACE_MIN: 20,
  SANDBOX_GC_INTERVAL_MIN: 10,
  RENDER_SERVICE_PLAN: 'free',
  RENDER_REGION: 'oregon',
};

const never = () => new Promise<never>(() => undefined);

function setup() {
  const store = new MemoryStore();
  const render = {
    countPlanResources: vi.fn(async () => ({ services: 0, postgres: 0 })),
    deleteService: vi.fn(async () => undefined),
    listLogs: vi.fn(),
    updateWebService: vi.fn(),
    getService: vi.fn(),
    createWebService: vi.fn(),
    ownerId: vi.fn(async () => 'tea-1'),
    replaceEnvVars: vi.fn(),
    triggerDeploy: vi.fn(),
  };
  const git = {
    org: 'hack26-sandboxes',
    mirrorsEnabled: true,
    // El aprovisionamiento queda "en curso" para siempre: el test mira solo el cupo.
    cloneSource: vi.fn(never),
    deleteMirror: vi.fn(async () => undefined),
    removeWorkdir: vi.fn(async () => undefined),
    mirrorUrl: (r: string) => `https://github.com/hack26-sandboxes/${r}`,
  };
  const agents = {
    assertConfigured: vi.fn(),
    stop: vi.fn(async () => undefined),
  };
  const events = { emit: vi.fn() };
  const databases = { release: vi.fn(async () => undefined) };
  const service = new SandboxesService(
    { get: (k: string) => CONFIG[k] } as never,
    store as never,
    events as never,
    render as never,
    git as never,
    databases as never,
    agents as never,
    {} as never,
  );
  return { service, store, render, git, agents, events };
}

function record(patch: Partial<SandboxRecord> = {}): SandboxRecord {
  const now = new Date().toISOString();
  return {
    sandbox_id: 'sbx-0000aaaa',
    repo_url: 'https://github.com/a/app',
    mode: 'agent',
    status: 'ready',
    created_at: now,
    updated_at: now,
    env: {},
    pending_inputs: [],
    deploys: [],
    ...patch,
  };
}

const render0 = {
  service_id: 'srv-1',
  service_name: 'sbx-0000aaaa',
  dashboard_url: '',
  url: 'https://sbx-0000aaaa.onrender.com',
  generation: 0,
};

beforeEach(() => {
  // Los heartbeats del lease son setInterval: falsos para no dejar timers vivos.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SandboxesService.create (cupo por usuario)', () => {
  it('POST en paralelo del mismo usuario no se pasan del límite', async () => {
    const { service, store } = setup();
    const owner = { github_id: 7, login: 'ana' };
    await Promise.all(
      [1, 2, 3].map(() =>
        service.create({ repo_url: 'https://github.com/a/app', owner }),
      ),
    );
    const live = store
      .list()
      .filter(
        (s) =>
          s.owner?.github_id === 7 &&
          s.status !== 'deleted' &&
          s.status !== 'failed',
      );
    expect(store.list()).toHaveLength(3);
    expect(live).toHaveLength(1); // SANDBOX_MAX_PER_USER = 1
  });

  it('guarda la URL canónica y rechaza las que no son de GitHub', async () => {
    const { service, store } = setup();
    const s = await service.create({
      repo_url: 'HTTPS://GitHub.com/a/app.git',
    });
    expect(store.get(s.sandbox_id)!.repo_url).toBe('https://github.com/a/app');
    await expect(
      service.create({
        repo_url: 'https://github.com/hack26-sandboxes/%73bx-1',
      }),
    ).rejects.toThrow(/github\.com\/dueño\/repo/);
  });
});

describe('SandboxesService.remove', () => {
  it('marca el borrado al inicio, frena lo que está en vuelo y limpia los secretos', async () => {
    const { service, store, agents, render } = setup();
    store.insert(
      record({ env: { STRIPE_KEY: 'sk_live_x' }, render: { ...render0 } }),
    );
    let releaseStop!: () => void;
    agents.stop.mockImplementation(
      () => new Promise<undefined>((r) => (releaseStop = () => r(undefined))),
    );

    const first = service.remove('sbx-0000aaaa');
    const second = service.remove('sbx-0000aaaa');
    expect(second).toBe(first); // una sola eliminación

    const s = store.get('sbx-0000aaaa')!;
    expect(s.deleting_at).toBeDefined();
    expect(s.status).toBe('ready'); // no es un status público nuevo
    // Lo que esté en vuelo deja de crear recursos.
    expect(() =>
      (
        service as unknown as { assertNotDeleted(id: string): void }
      ).assertNotDeleted('sbx-0000aaaa'),
    ).toThrow(SandboxDeletedError);

    releaseStop();
    const done = await first;
    expect(done.status).toBe('deleted');
    expect(done.env).toEqual({});
    expect(done.deleting_at).toBeUndefined();
    expect(render.deleteService).toHaveBeenCalledTimes(1);
  });
});

describe('SandboxesService.logsStream', () => {
  it('si el cliente cancela con una llamada en curso, no queda una promesa rechazada suelta', async () => {
    const { service, store, render } = setup();
    store.insert(record({ render: { ...render0 } }));
    let fail!: (e: Error) => void;
    render.listLogs.mockImplementation(
      () => new Promise((_, reject) => (fail = reject)),
    );

    const reader = service.logsStream('sbx-0000aaaa', {}).getReader();
    expect((await reader.read()).value).toBe(': connected\n\n');
    await reader.cancel();
    // Antes: el catch hacía enqueue sobre el stream cerrado y la promesa de tick se rechazaba.
    fail(new Error('Render caído'));
    await new Promise((r) => setTimeout(r, 10));
    expect(render.listLogs).toHaveBeenCalledTimes(1);
  });

  it('tampoco si la llamada termina bien después de cancelar', async () => {
    const { service, store, render } = setup();
    store.insert(record({ render: { ...render0 } }));
    let ok!: (v: unknown) => void;
    render.listLogs.mockImplementation(() => new Promise((r) => (ok = r)));

    const reader = service.logsStream('sbx-0000aaaa', {}).getReader();
    await reader.read();
    await reader.cancel();
    ok({
      logs: [{ id: 'l1', timestamp: 't', message: 'm', labels: [] }],
      hasMore: false,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(render.listLogs).toHaveBeenCalledTimes(1);
  });
});

describe('recrear el servicio solo si hace falta', () => {
  const err = (status: number, message = 'invalid') =>
    new RenderApiError(status, 'PATCH', '/services/srv-1', { message });

  it('shouldRecreateService: cambio de runtime o servicio inexistente', () => {
    expect(shouldRecreateService(err(400), 'node', 'docker')).toBe(true);
    expect(shouldRecreateService(err(404), undefined, 'docker')).toBe(true);
    expect(
      shouldRecreateService(
        err(400, 'cannot change runtime'),
        undefined,
        'docker',
      ),
    ).toBe(true);
  });

  it('shouldRecreateService: validación, 429, permisos o errores no-Render no borran nada', () => {
    expect(shouldRecreateService(err(400), 'docker', 'docker')).toBe(false);
    expect(shouldRecreateService(err(400), undefined, 'docker')).toBe(false);
    expect(shouldRecreateService(err(429), 'node', 'docker')).toBe(false);
    expect(shouldRecreateService(err(403), 'node', 'docker')).toBe(false);
    expect(shouldRecreateService(err(500), 'node', 'docker')).toBe(false);
    expect(shouldRecreateService(new Error('x'), 'node', 'docker')).toBe(false);
  });

  const manifest: SandboxManifest = {
    runtime: 'docker',
    healthcheck_path: '/health',
    needs_postgres: false,
    database_url_env: 'DATABASE_URL',
    env: {},
    seed_users: [],
  };

  it('un 400 de validación sin cambio de runtime se informa sin borrar el servicio', async () => {
    const { service, store, render } = setup();
    store.insert(record({ status: 'analyzing', render: { ...render0 } }));
    render.updateWebService.mockRejectedValue(err(400, 'bad healthCheckPath'));
    render.getService.mockResolvedValue({
      serviceDetails: { runtime: 'docker' },
    });
    await expect(
      service.applyPlan('sbx-0000aaaa', manifest, 'agente'),
    ).rejects.toThrow(/bad healthCheckPath/);
    expect(render.deleteService).not.toHaveBeenCalled();
    expect(store.get('sbx-0000aaaa')!.render?.service_id).toBe('srv-1');
  });

  it('si recrear falla, el record no queda apuntando al servicio borrado', async () => {
    const { service, store, render } = setup();
    store.insert(record({ status: 'analyzing', render: { ...render0 } }));
    store.update('sbx-0000aaaa', {
      deploy_repo_url: 'https://github.com/hack26-sandboxes/sbx-0000aaaa',
    });
    render.updateWebService.mockRejectedValue(err(400, 'runtime'));
    render.getService.mockResolvedValue({
      serviceDetails: { runtime: 'node' },
    });
    render.createWebService.mockRejectedValue(err(400, 'name taken'));
    await expect(
      service.applyPlan('sbx-0000aaaa', manifest, 'agente'),
    ).rejects.toThrow(/name taken/);
    expect(render.deleteService).toHaveBeenCalledWith('srv-1');
    expect(store.get('sbx-0000aaaa')!.render).toBeUndefined();
  });
});
