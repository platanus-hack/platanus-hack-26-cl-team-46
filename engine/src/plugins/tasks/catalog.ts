/** Catálogo del target "Tasks": IDOR y SQLi (solapadas con Apuntes) + open-redirect (nueva). */
import type { VulnMeta } from '../../core/types.ts';

export const CATALOG: Record<string, VulnMeta> = {
  idor: {
    id: 'idor', title: 'IDOR en tareas', severity: 'high', difficulty: 1, order: 1,
    cwe: ['CWE-639'], owasp: ['A01:2021 Broken Access Control'],
    mitre_attack: ['T1213 — Data from Information Repositories'], d3fend: ['Autorización a nivel de objeto'],
    code_location: 'GET /tasks/:id sin filtro de dueño',
    real_case: 'First American (2019): IDs secuenciales exponían 885M de documentos.',
    fix_correct: 'Filtrar por dueño (WHERE id=$1 AND owner=$2) y 404 si no es del usuario.',
    fix_wrong: ['Cambiar a UUID (seguridad por oscuridad).'],
    teaching: 'Autoriza por dueño, no por ID.',
  },
  'sql-injection': {
    id: 'sql-injection', title: 'SQLi en la búsqueda de tareas', severity: 'critical', difficulty: 3, order: 2,
    cwe: ['CWE-89'], owasp: ['A03:2021 Injection'],
    mitre_attack: ['T1190 — Exploit Public-Facing Application'], d3fend: ['Queries parametrizadas'],
    code_location: 'GET /tasks?search= concatenado',
    real_case: 'TalkTalk (2015): SQLi expuso ~157.000 clientes.',
    fix_correct: 'Query parametrizada; asumir users leída y rotar credenciales.',
    fix_wrong: ['Escapar comillas a mano.'],
    teaching: 'Nunca concatenes input en SQL.',
  },
  'open-redirect': {
    id: 'open-redirect', title: 'Open redirect en /go', severity: 'medium', difficulty: 1, order: 3,
    cwe: ['CWE-601 URL Redirection to Untrusted Site'], owasp: ['A01:2021 Broken Access Control'],
    mitre_attack: ['T1566 — Phishing (habilitador)'], d3fend: ['Allowlist de destinos de redirect'],
    code_location: 'GET /go?to= redirige sin validar',
    real_case: 'Open redirects usados en campañas de phishing para dar legitimidad al dominio.',
    fix_correct: 'Allowlist de destinos o solo rutas relativas; nunca redirigir a URLs arbitrarias del usuario.',
    fix_wrong: ['Bloquear solo "http://" (se evade con //evil.com o https).'],
    teaching: 'Un redirect a URL controlada por el usuario es un trampolín de phishing.',
  },
};
