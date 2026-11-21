/** Helpers de sesión para el target Tasks (/register, /login). */
import { hex } from '../../core/rng.ts';
import type { AttackContext } from '../../core/types.ts';

export async function lowPrivSession(ctx: AttackContext): Promise<{ token: string; id: number }> {
  if (ctx.target.weak_login) {
    const res = await ctx.http.post('/login', { email: ctx.target.weak_login.email, password: ctx.target.weak_login.password });
    if (res.status === 200) {
      const b = res.json as { token: string; user: { id: number } };
      return { token: b.token, id: b.user.id };
    }
  }
  const email = `rt-${hex(ctx.rng, 6)}@redteam.local`;
  const password = `Rt-${hex(ctx.rng, 6)}!`;
  const res = await ctx.http.post('/register', { email, password });
  const b = res.json as { token: string; user: { id: number } };
  if (res.status !== 201 || !b?.token) throw new Error(`registro Tasks falló: HTTP ${res.status}`);
  ctx.tracker.add(`cuenta desechable ${email} (Tasks no permite borrarla)`);
  return { token: b.token, id: b.user.id };
}
