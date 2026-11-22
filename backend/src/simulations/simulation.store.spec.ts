import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SimulationStore } from './simulation.store.js';
import type { SimulationRecord } from './simulation.types.js';

/** Trabajo en curso (cerebro, motor, reportes) que termina después de onModuleDestroy y actualiza la simulación. */
@Injectable()
class LateWriter implements OnModuleDestroy {
  done?: Promise<void>;
  constructor(private readonly store: SimulationStore) {}
  onModuleDestroy() {
    this.done = new Promise((resolve) =>
      setTimeout(() => {
        this.store.update('sim-1', {
          status: 'finished',
        } as Partial<SimulationRecord>);
        resolve();
      }, 20),
    );
  }
  async beforeApplicationShutdown() {
    await this.done;
  }
}

describe('SimulationStore al apagar', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'simstore-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('guarda las actualizaciones que llegan durante el apagado y recién después cierra Postgres', async () => {
    const calls: string[] = [];
    const fakePool = {
      query: vi.fn(async (_sql: string, params?: unknown[]) => {
        calls.push(
          `query:${(params?.[1] as string | undefined)?.includes('finished') ? 'finished' : 'otro'}`,
        );
        return { rows: [] };
      }),
      end: vi.fn(async () => {
        calls.push('end');
      }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        SimulationStore,
        LateWriter,
        {
          provide: ConfigService,
          useValue: {
            get: (k: string) => (k === 'DATA_DIR' ? dir : undefined),
          },
        },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const store = app.get(SimulationStore);
    (store as unknown as { pool: typeof fakePool }).pool = fakePool;
    store.insert({
      sim_id: 'sim-1',
      status: 'running',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      timeline: [],
    } as unknown as SimulationRecord);

    await app.close();

    expect(calls).toContain('query:finished');
    expect(calls.at(-1)).toBe('end');
    expect(fakePool.end).toHaveBeenCalledTimes(1);
  });
});
