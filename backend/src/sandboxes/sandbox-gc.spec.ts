import { pickToEvict, planCleanup, type SandboxUsage } from './sandbox-gc.js';
import type { SandboxRecord } from './sandbox.types.js';

const now = Date.parse('2026-11-22T06:00:00Z');
const H = 3_600_000;
const ago = (ms: number) => new Date(now - ms).toISOString();
const opts = {
  idleTtlMs: 3 * H,
  failedTtlMs: 1 * H,
  duplicateGraceMs: 20 * 60_000,
};
const alice = { github_id: 1, login: 'alice' };

function sbx(id: string, patch: Partial<SandboxRecord> = {}): SandboxRecord {
  return {
    sandbox_id: id,
    repo_url: 'https://github.com/a/app',
    mode: 'agent',
    status: 'ready',
    created_at: ago(10 * 60_000),
    updated_at: ago(1_000),
    env: {},
    pending_inputs: [],
    deploys: [],
    owner: alice,
    ...patch,
  };
}
const noUse: SandboxUsage = { activeSimulation: false };
const plan = (
  records: SandboxRecord[],
  usage: Record<string, SandboxUsage> = {},
  busy: string[] = [],
) =>
  planCleanup(
    records,
    (id) => usage[id] ?? noUse,
    (id) => busy.includes(id),
    now,
    opts,
  );

describe('planCleanup', () => {
  it('borra lo inactivo por más del TTL, aunque updated_at sea reciente', () => {
    const r = plan([sbx('viejo', { created_at: ago(5 * H) }), sbx('nuevo')]);
    expect(r.map((x) => x.sandbox_id)).toEqual(['viejo']);
    expect(r[0].reason).toContain('sin uso');
  });

  it('borra fallidos de más de 1 h', () => {
    const r = plan([sbx('f', { status: 'failed', created_at: ago(2 * H) })]);
    expect(r[0]).toMatchObject({ sandbox_id: 'f' });
    expect(r[0].reason).toContain('falló');
  });

  it('respeta una simulación en curso con el usuario activo', () => {
    const records = [sbx('s', { created_at: ago(5 * H) })];
    expect(
      plan(records, {
        s: { activeSimulation: true, lastUserActivity: ago(10 * 60_000) },
      }),
    ).toEqual([]);
  });

  it('una simulación abandonada (usuario inactivo) no protege el sandbox', () => {
    const records = [sbx('s', { created_at: ago(30 * H) })];
    const r = plan(records, {
      s: { activeSimulation: true, lastUserActivity: ago(5 * H) },
    });
    expect(r.map((x) => x.sandbox_id)).toEqual(['s']);
  });

  it('nunca toca lo que se está desplegando u ocupado', () => {
    const records = [
      sbx('prov', { status: 'provisioning', created_at: ago(9 * H) }),
      sbx('agente', { status: 'analyzing', created_at: ago(9 * H) }),
      sbx('ocupado', { created_at: ago(9 * H) }),
    ];
    expect(plan(records, {}, ['ocupado'])).toEqual([]);
  });

  it('deja una sola copia por repo y dueño (la que está arriba y más reciente)', () => {
    const records = [
      sbx('c1', { created_at: ago(60 * 60_000) }),
      sbx('c2', { created_at: ago(40 * 60_000) }),
      sbx('c3', { created_at: ago(30 * 60_000) }),
      sbx('fallida', { status: 'failed', created_at: ago(5 * 60_000) }),
    ];
    const ids = plan(records)
      .map((x) => x.sandbox_id)
      .sort();
    expect(ids).toEqual(['c1', 'c2']);
  });

  it('copias recientes (dentro del margen) y de otros dueños se respetan', () => {
    const records = [
      sbx('a1', { created_at: ago(10 * 60_000) }),
      sbx('a2', { created_at: ago(5 * 60_000) }),
      sbx('b1', {
        owner: { github_id: 2, login: 'bob' },
        created_at: ago(30 * 60_000),
      }),
    ];
    expect(plan(records)).toEqual([]);
  });
});

describe('pickToEvict (límite por usuario)', () => {
  const evict = (
    records: SandboxRecord[],
    needed: number,
    usage: Record<string, SandboxUsage> = {},
    busy: string[] = [],
  ) =>
    pickToEvict(
      records,
      'https://github.com/a/app',
      needed,
      (id) => usage[id] ?? noUse,
      (id) => busy.includes(id),
      now,
      opts,
    );

  it('primero los que no se usan: del mismo repo y después los más viejos', () => {
    const records = [
      sbx('otro-viejo', {
        repo_url: 'https://github.com/a/otro',
        created_at: ago(2 * H),
      }),
      sbx('mismo', { created_at: ago(30 * 60_000) }),
      sbx('otro-nuevo', {
        repo_url: 'https://github.com/a/otro',
        created_at: ago(20 * 60_000),
      }),
    ];
    expect(evict(records, 2)).toEqual(['mismo', 'otro-viejo']);
  });

  it('si todos están en uso, elimina el más antiguo igual (no bloquea)', () => {
    const active = (min: number) => ({
      activeSimulation: true,
      lastUserActivity: ago(min * 60_000),
    });
    const records = [
      sbx('nuevo', { created_at: ago(10 * 60_000) }),
      sbx('viejo', { created_at: ago(50 * 60_000) }),
      sbx('medio', { created_at: ago(30 * 60_000) }),
    ];
    expect(
      evict(records, 1, {
        nuevo: active(5),
        viejo: active(40),
        medio: active(20),
      }),
    ).toEqual(['viejo']);
  });

  it('lo que se está desplegando va al final, pero también se puede eliminar', () => {
    const records = [
      sbx('prov-viejo', {
        status: 'provisioning',
        created_at: ago(60 * 60_000),
      }),
      sbx('en-uso', { created_at: ago(30 * 60_000) }),
    ];
    const usage = {
      'en-uso': { activeSimulation: true, lastUserActivity: ago(60_000) },
    };
    expect(evict(records, 1, usage)).toEqual(['en-uso']);
    expect(evict(records, 2, usage)).toEqual(['en-uso', 'prov-viejo']);
  });

  it('no cuenta los fallidos ni borrados', () => {
    const records = [
      sbx('f', { status: 'failed' }),
      sbx('d', { status: 'deleted' }),
      sbx('ok'),
    ];
    expect(evict(records, 3)).toEqual(['ok']);
  });
});
