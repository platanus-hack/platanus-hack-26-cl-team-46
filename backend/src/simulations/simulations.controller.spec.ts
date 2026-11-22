import { ConflictException } from '@nestjs/common';
import type { SimulationRecord } from './simulation.types.js';
import { SimulationsController } from './simulations.controller.js';

function setup(status: SimulationRecord['status'], internals = false) {
  const sim = { sim_id: 'sim-1', status } as SimulationRecord;
  const sims = {
    get: () => sim,
    ownerOf: () => undefined,
    canSeeInternals: () => internals,
    start: vi.fn(() => {
      if (sim.status !== 'ready')
        throw new ConflictException(`La simulación está ${sim.status}`);
      return { sim_id: 'sim-1' };
    }),
  };
  const timeline = {
    list: vi.fn(() => []),
    sseStream: vi.fn(() => new ReadableStream()),
  };
  const auth = { assertAccess: vi.fn() };
  const engine = { select: vi.fn() };
  const brain = { ensureOpeningForFirst: vi.fn(async () => {}) };
  const controller = new SimulationsController(
    sims as never,
    timeline as never,
    auth as never,
    {} as never,
    engine as never,
    brain as never,
  );
  return { controller, sims, timeline, engine, brain };
}

describe('SimulationsController', () => {
  it('POST /start no toca el plan si la simulación no está lista', async () => {
    const t = setup('running');
    await expect(
      t.controller.start('sim-1', null, { vulns: ['idor'] }),
    ).rejects.toThrow(ConflictException);
    expect(t.engine.select).not.toHaveBeenCalled();
    expect(t.brain.ensureOpeningForFirst).not.toHaveBeenCalled();
  });

  it('POST /start con la simulación lista elige los incidentes y parte', async () => {
    const t = setup('ready');
    await t.controller.start('sim-1', null, { vulns: ['idor'] });
    expect(t.engine.select).toHaveBeenCalledWith('sim-1', ['idor']);
    expect(t.sims.start).toHaveBeenCalled();
  });

  it('view=all con el incidente vivo cae a la vista del jugador', () => {
    const t = setup('running');
    t.controller.events('sim-1', { view: 'all', types: undefined }, null);
    expect(t.timeline.list).toHaveBeenCalledWith(
      'sim-1',
      expect.objectContaining({ view: 'user' }),
    );
    t.controller.stream('sim-1', { view: 'all', types: undefined }, null);
    expect(t.timeline.sseStream).toHaveBeenCalledWith(
      'sim-1',
      'user',
      undefined,
    );
  });

  it('view=all se respeta con la simulación cerrada (o en modo debug)', () => {
    const t = setup('finished', true);
    t.controller.events('sim-1', { view: 'all', types: undefined }, null);
    expect(t.timeline.list).toHaveBeenCalledWith(
      'sim-1',
      expect.objectContaining({ view: 'all' }),
    );
  });
});
