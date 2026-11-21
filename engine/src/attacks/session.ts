/** Helpers de sesión compartidos por los módulos de ataque. */
import type { AttackContext } from '../types.ts';

export function rand(n = 6): string {
  return Math.random().toString(16).slice(2, 2 + n);
}

export interface Account {
  email: string;
  password: string;
  token: string;
  id: number;
  role: string;
}

/**
 * Registra una cuenta desechable del red team. El registro es libre en la
 * víctima, así evitamos tocar las cuentas seed. Marcada claramente para el
 * limpiado posterior.
 */
export async function registerThrowaway(ctx: AttackContext): Promise<Account> {
  const email = `rt-${rand()}@redteam.local`;
  const password = `Rt-${rand()}-${rand()}!`;
  const res = await ctx.http.post('/api/auth/register', {
    email,
    password,
    name: `redteam-${rand()}`,
  });
  const body = res.json as { token: string; user: { id: number; role: string } };
  if (res.status !== 201 || !body?.token) {
    throw new Error(`registro falló: HTTP ${res.status} ${res.text.slice(0, 200)}`);
  }
  return { email, password, token: body.token, id: body.user.id, role: body.user.role };
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
