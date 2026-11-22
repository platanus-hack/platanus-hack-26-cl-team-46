import { signSimToken, verifySimToken } from './sim-token.js';
import { buildSimPrompt } from './sim-prompts.js';
import { wakeMessage } from './simulation.dispatcher.js';
import {
  canPost,
  EVENT_TYPES,
  SIM_ROLES,
  type SimulationRecord,
  type TimelineEvent,
} from './simulation.types.js';
import { pendingFor } from './timeline.service.js';

function ev(
  seq: number,
  actor: TimelineEvent['actor'],
  type: string,
  extra: Partial<TimelineEvent> = {},
): TimelineEvent {
  return {
    seq,
    t: '2026-11-21T17:00:00.000Z',
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

describe('catálogo de eventos', () => {
  it('cada tipo despierta solo roles válidos', () => {
    for (const spec of Object.values(EVENT_TYPES)) {
      for (const r of spec.wakes) expect(SIM_ROLES).toContain(r);
    }
  });

  it('respeta los carriles de cada rol', () => {
    expect(canPost('hacker', 'attack.success')).toBe(true);
    expect(canPost('hacker', 'notify')).toBe(false);
    expect(canPost('generator', 'notify')).toBe(true);
    expect(canPost('coder', 'state.update')).toBe(false);
    expect(canPost('observer', 'control.verify')).toBe(true);
    expect(canPost('coder', 'change.deployed')).toBe(false); // los cambios los emite el backend
    expect(canPost('user', 'control.start')).toBe(true);
    expect(canPost('hacker', 'no.existe')).toBe(false);
  });
});

describe('pendingFor', () => {
  const timeline = [
    ev(1, 'hacker', 'attack.plan'),
    ev(2, 'user', 'control.start'),
    ev(3, 'hacker', 'attack.success'),
    ev(4, 'user', 'user.message'),
    ev(5, 'observer', 'control.verify'),
  ];

  it('entrega solo lo que despierta al rol y después del cursor', () => {
    expect(pendingFor(timeline, 'observer', 0).map((e) => e.seq)).toEqual([
      1, 2, 3,
    ]);
    expect(pendingFor(timeline, 'observer', 2).map((e) => e.seq)).toEqual([3]);
    expect(pendingFor(timeline, 'hacker', 0).map((e) => e.seq)).toEqual([2, 5]);
    expect(pendingFor(timeline, 'coder', 0).map((e) => e.seq)).toEqual([4]);
    expect(pendingFor(timeline, 'generator', 0).map((e) => e.seq)).toEqual([3]);
  });

  it('no despierta a un rol con sus propios eventos', () => {
    const t = [ev(1, 'observer', 'control.next')];
    expect(pendingFor(t, 'observer', 0)).toEqual([]);
  });
});

describe('wakeMessage', () => {
  it('incluye los eventos y la CLI del rol', () => {
    const sim = { sim_id: 'sim-1', status: 'running' } as SimulationRecord;
    const msg = wakeMessage(
      sim,
      'hacker',
      [
        ev(7, 'observer', 'control.next', {
          vuln_id: 'idor',
          raw: { vuln_id: 'idor' },
        }),
      ],
      2,
    );
    expect(msg).toContain('#7');
    expect(msg).toContain('vuln=idor');
    expect(msg).toContain('2 eventos más');
    expect(msg).toContain('/tmp/sim-hacker.mjs');
  });
});

describe('token de simulación', () => {
  it('solo sirve para su simulación', () => {
    const t = signSimToken('secreto-suficientemente-largo', 'sim-1');
    expect(verifySimToken('secreto-suficientemente-largo', t, 'sim-1')).toBe(
      true,
    );
    expect(verifySimToken('secreto-suficientemente-largo', t, 'sim-2')).toBe(
      false,
    );
    expect(verifySimToken('otro-secreto-suficientemente', t, 'sim-1')).toBe(
      false,
    );
  });
});

describe('prompts', () => {
  it('cada rol recibe su CLI y el catálogo', () => {
    for (const role of SIM_ROLES) {
      const p = buildSimPrompt({
        simId: 'sim-1',
        repoUrl: 'https://github.com/x/y',
        role,
      });
      expect(p).toContain(`/sim/cli.mjs?role=${role}`);
      expect(p).toContain('`attack.plan`');
    }
  });
});
