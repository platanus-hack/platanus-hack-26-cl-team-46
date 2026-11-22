import type { SimulationRecord } from './simulation.types.js';
import { SSE_MAX_BACKLOG, TimelineService } from './timeline.service.js';

function setup() {
  const record = {
    sim_id: 'sim-1',
    next_seq: 1,
    timeline: [],
  } as unknown as SimulationRecord;
  const store = {
    get: () => record,
    update: (_id: string, fn: (r: SimulationRecord) => void) => {
      fn(record);
      return record;
    },
  };
  return { timeline: new TimelineService(store as never), record };
}

const note = { type: 'sim.status', title: 'x', raw: { status: 'running' } };

describe('SSE del timeline', () => {
  it('un cliente que no lee se corta al pasar el atraso máximo y suelta su suscripción', () => {
    const { timeline } = setup();
    const stream = timeline.sseStream('sim-1', 'user');
    expect(timeline.listenerCount('sim-1')).toBe(1);
    for (let i = 0; i < SSE_MAX_BACKLOG + 10; i++)
      timeline.append('sim-1', 'system', note, { trusted: true });
    expect(timeline.listenerCount('sim-1')).toBe(0);
    // El timeline sigue funcionando para el resto.
    expect(() =>
      timeline.append('sim-1', 'system', note, { trusted: true }),
    ).not.toThrow();
    void stream.cancel();
  });

  it('al cancelar el stream se suelta la suscripción', async () => {
    const { timeline } = setup();
    const stream = timeline.sseStream('sim-1', 'user');
    const reader = stream.getReader();
    expect(timeline.listenerCount('sim-1')).toBe(1);
    await reader.cancel();
    expect(timeline.listenerCount('sim-1')).toBe(0);
  });

  it('un historial largo no cuenta como atraso (va en un solo chunk)', async () => {
    const { timeline } = setup();
    for (let i = 0; i < SSE_MAX_BACKLOG * 2; i++)
      timeline.append('sim-1', 'system', note, { trusted: true });
    const stream = timeline.sseStream('sim-1', 'user');
    expect(timeline.listenerCount('sim-1')).toBe(1);
    const reader = stream.getReader();
    const { value } = await reader.read();
    expect(value!.match(/^id: /gm)).toHaveLength(SSE_MAX_BACKLOG * 2);
    await reader.cancel();
  });

  it('un oyente que falla no impide publicar', () => {
    const { timeline, record } = setup();
    timeline.subscribe('sim-1', () => {
      throw new Error('stream cerrado');
    });
    timeline.append('sim-1', 'system', note, { trusted: true });
    expect(record.timeline).toHaveLength(1);
  });
});
