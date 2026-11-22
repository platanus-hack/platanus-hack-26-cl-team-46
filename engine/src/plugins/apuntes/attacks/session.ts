/** Helpers de sesión compartidos por los módulos de ataque. */
import { hex } from '../../../core/rng.ts';
import type { AttackContext } from '../../../core/types.ts';

export interface Account {
  email: string;
  password: string;
  token: string;
  id: number;
  role: string;
}

/**
 * Registra una cuenta desechable del red team usando el RNG seeded (reproducible
 * con --seed). La víctima permite registro libre, así evitamos tocar las cuentas
 * seed. La app no deja borrar usuarios: se registra como residuo para el reset.
 */
export async function registerThrowaway(ctx: AttackContext): Promise<Account> {
  // El primer intento usa el tag determinista (reproducible con --seed). Si ese
  // email ya existe (409 — estado sucio o un re-run/verify), reintenta con otro
  // tag; así no se rompe la reproducibilidad en corridas frescas ni choca al re-verificar.
  let last = '';
  for (let i = 0; i < 5; i++) {
    const tag = hex(ctx.rng, 6);
    const email = `rt-${tag}@redteam.local`;
    const password = `Rt-${hex(ctx.rng, 4)}-${hex(ctx.rng, 4)}!`;
    const res = await ctx.http.post('/api/auth/register', { email, password, name: `redteam-${tag}` });
    if (res.status === 409) { last = `409 ${email}`; continue; }
    const body = res.json as { token: string; user: { id: number; role: string } };
    if (res.status !== 201 || !body?.token) {
      throw new Error(`registro falló: HTTP ${res.status} ${res.text.slice(0, 200)}`);
    }
    // Sin undo: la app no expone borrado de usuarios → residuo para el reset.
    ctx.tracker.add(`cuenta desechable ${email} (la app no permite borrarla)`);
    return { email, password, token: body.token, id: body.user.id, role: body.user.role };
  }
  throw new Error(`registro falló tras reintentos: ${last}`);
}

export async function loginApi(
  ctx: AttackContext,
  email: string,
  password: string,
): Promise<{ token: string; id: number; role: string } | null> {
  const res = await ctx.http.post('/api/auth/login', { email, password });
  if (res.status !== 200) return null;
  const body = res.json as { token: string; user: { id: number; role: string } };
  return { token: body.token, id: body.user.id, role: body.user.role };
}

export async function me(ctx: AttackContext, token: string): Promise<any> {
  const res = await ctx.http.get('/api/users/me', { token });
  return res.json;
}

/** Sesión de baja privilegia: usa la credencial débil conocida (read-only). */
export async function lowPrivSession(ctx: AttackContext): Promise<{ token: string; id: number; role: string }> {
  if (ctx.target.weak_login) {
    const s = await loginApi(ctx, ctx.target.weak_login.email, ctx.target.weak_login.password);
    if (s) return s;
  }
  // Fallback: si no hay credencial conocida, crea una (mutante).
  const a = await registerThrowaway(ctx);
  return { token: a.token, id: a.id, role: a.role };
}
