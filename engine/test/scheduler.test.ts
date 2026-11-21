import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSchedule } from '../src/core/scheduler.ts';
import type { Attack, SchedulingMeta } from '../src/core/types.ts';

function atk(id: string, order: number, scheduling?: SchedulingMeta): Attack {
  return {
    meta: { id, title: id, severity: 'high', difficulty: 1, order, cwe: [], owasp: [], mitre_attack: [], d3fend: [], code_location: '', real_case: '', fix_correct: '', fix_wrong: [], teaching: '' },
    mutating: false,
    scheduling,
    run: async () => ({ vuln_id: id, confirmed: false, blocked: false, steps: [], gained: [], attacker_active: false, summary: '' }),
  };
}

test('planSchedule: baseline solo, dependencia secuenciada, mutex separado, resto paralelo', () => {
  const attacks: Attack[] = [
    atk('weak-password', 1, { needsCleanBaseline: true, mutex: ['jwt'] }),
    atk('jwt', 2),
    atk('idor', 3),
    atk('admin', 4),
    atk('verbose-errors', 7, { alarmFootprint: 'medium' }),
    atk('sql', 6, { dependsOn: ['verbose-errors'] }),
  ];
  const plan = planSchedule(attacks);
  const laneOf = (id: string) => plan.explanation.find((e) => e.vuln_id === id)!.lane;

  // weak-password: baseline → lane propia (solo).
  const wpLane = plan.lanes[laneOf('weak-password')];
  assert.deepEqual(wpLane.attackIds, ['weak-password']);
  assert.equal(wpLane.solo, true);

  // sql depende de verbose-errors → lane posterior.
  assert.ok(laneOf('sql') > laneOf('verbose-errors'), 'sql no quedó después de verbose-errors');

  // mutex: weak-password y jwt no comparten lane.
  assert.notEqual(laneOf('weak-password'), laneOf('jwt'));

  // idor y admin son independientes → pueden ir en paralelo (misma lane).
  assert.equal(laneOf('idor'), laneOf('admin'));

  // La explicación nombra el motivo.
  assert.match(plan.explanation.find((e) => e.vuln_id === 'sql')!.reason, /depende de verbose-errors/);
  assert.match(plan.explanation.find((e) => e.vuln_id === 'weak-password')!.reason, /baseline/);
  assert.match(plan.explanation.find((e) => e.vuln_id === 'idor')!.reason, /paralelo/);
});

test('planSchedule: sin metadata, todo en una lane paralela', () => {
  const plan = planSchedule([atk('a', 1), atk('b', 2), atk('c', 3)]);
  assert.equal(plan.lanes.length, 1);
  assert.equal(plan.lanes[0].attackIds.length, 3);
});
