import {
  decideRecovery,
  heldByOtherInstance,
  LEASE_TTL_MS,
} from './sandbox-recovery.js';
import type { SandboxRecord } from './sandbox.types.js';

const now = Date.parse('2026-11-21T23:40:00Z');
const ago = (ms: number) => new Date(now - ms).toISOString();

function sbx(patch: Partial<SandboxRecord>): SandboxRecord {
  return {
    sandbox_id: 'sbx-1',
    repo_url: 'https://github.com/a/b',
    mode: 'agent',
    status: 'provisioning',
    created_at: ago(60_000),
    updated_at: ago(30_000),
    env: {},
    pending_inputs: [],
    deploys: [],
    ...patch,
  };
}

describe('decideRecovery', () => {
  it('no toca un sandbox que otra instancia viva sigue procesando (deploy sin downtime)', () => {
    const s = sbx({ lease: { owner: 'vieja', heartbeat_at: ago(5_000) } });
    expect(heldByOtherInstance(s, 'nueva', now)).toBe(true);
    expect(decideRecovery(s, 'nueva', now)).toEqual({ kind: 'skip' });
  });

  it('retoma el aprovisionamiento si la dueña dejó de dar heartbeat', () => {
    const s = sbx({
      lease: { owner: 'vieja', heartbeat_at: ago(LEASE_TTL_MS + 1_000) },
    });
    expect(decideRecovery(s, 'nueva', now)).toEqual({ kind: 'reprovision' });
  });

  it('retoma registros sin lease (creados antes de este cambio)', () => {
    expect(decideRecovery(sbx({}), 'nueva', now)).toEqual({
      kind: 'reprovision',
    });
  });

  it('sigue el deploy de Render que estaba en curso', () => {
    const s = sbx({
      status: 'deploying',
      render: {
        service_id: 'srv-1',
        service_name: 'sbx-1',
        dashboard_url: '',
        generation: 0,
      },
      current_deploy: {
        id: 'dep-1',
        status: 'build_in_progress',
        reason: 'patch',
        started_at: ago(20_000),
      },
    });
    expect(decideRecovery(s, 'nueva', now)).toEqual({
      kind: 'follow',
      deployId: 'dep-1',
    });
  });

  it('si el agente ya estaba lanzado, lo deja a cargo', () => {
    const s = sbx({
      agent: {
        workspace_id: 'ws',
        session_id: 'se',
        deep_link: '',
        reason: '',
        started_at: ago(10_000),
        plans_submitted: 0,
      },
    });
    expect(decideRecovery(s, 'nueva', now)).toEqual({ kind: 'agent' });
  });

  it('una operación cortada antes de lanzar el deploy queda como interrumpida', () => {
    const s = sbx({ status: 'deploying' });
    expect(decideRecovery(s, 'nueva', now)).toEqual({ kind: 'interrupted' });
  });

  it('ignora sandboxes que no están en curso', () => {
    expect(decideRecovery(sbx({ status: 'ready' }), 'nueva', now)).toEqual({
      kind: 'skip',
    });
    expect(decideRecovery(sbx({ status: 'analyzing' }), 'nueva', now)).toEqual({
      kind: 'skip',
    });
  });

  it('su propio lease no cuenta como de otra instancia', () => {
    const s = sbx({ lease: { owner: 'yo', heartbeat_at: ago(1_000) } });
    expect(decideRecovery(s, 'yo', now)).toEqual({ kind: 'reprovision' });
  });
});
