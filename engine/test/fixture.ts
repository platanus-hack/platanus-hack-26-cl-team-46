/**
 * Servidor víctima LOCAL en memoria para los tests: una app de notas con 8
 * debilidades plantadas, sin Postgres ni red externa. Permite validar los
 * módulos, el scope guard, la redacción y el teardown sin tocar Render.
 *
 * Es un fixture de test, no la app real (esa vive en victim-app/).
 */
import { createHmac, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';

const SECRET = 'fixture-secret';

function b64url(s: string): string {
  return Buffer.from(s).toString('base64url');
}
function signToken(p: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + 30 * 24 * 3600, ...p };
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const b = b64url(JSON.stringify(payload));
  const s = createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url');
  return `${h}.${b}.${s}`;
}
function verifyToken(token: string): any {
  const [h, b, s] = token.split('.');
  if (!h || !b || !s) return null;
  if (createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url') !== s) return null;
  try {
    const p = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
    if (p.exp && p.exp * 1000 < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}
// Hash con pinta de bcrypt (sin dependencia): $2a$10$ + 53 chars hex.
function hash(pw: string): string {
  return '$2a$10$' + createHash('sha256').update(pw).digest('hex').slice(0, 53);
}

interface U { id: number; email: string; password_hash: string; name: string; phone: string | null; role: string; created_at: string; updated_at: string; }
interface N { id: number; user_id: number; title: string; body: string; created_at: string; updated_at: string; }

export interface Fixture { server: Server; url: string; close: () => Promise<void>; users: U[]; notes: N[]; }

export async function startFixture(): Promise<Fixture> {
  const ts = '2026-01-01T00:00:00.000Z';
  const users: U[] = [
    { id: 1, email: 'catalina.rojas@example.com', password_hash: hash('Apuntes-Admin-2026!'), name: 'Catalina', phone: '+56 9 5550 1201', role: 'admin', created_at: ts, updated_at: ts },
    { id: 2, email: 'martin.soto@example.com', password_hash: hash('qwerty123'), name: 'Martin', phone: '+56 9 5550 3344', role: 'user', created_at: ts, updated_at: ts },
    { id: 3, email: 'javiera.munoz@example.com', password_hash: hash('Jm!8vQ2#rTz9'), name: 'Javiera', phone: '+56 9 5550 7788', role: 'user', created_at: ts, updated_at: ts },
    { id: 4, email: 'diego.fuentes@example.com', password_hash: hash('Df-2026'), name: 'Diego', phone: '+56 9 5550 9911', role: 'user', created_at: ts, updated_at: ts },
    { id: 5, email: 'fernanda.castillo@example.com', password_hash: hash('FerCast#2026'), name: 'Fernanda', phone: null, role: 'user', created_at: ts, updated_at: ts },
  ];
  const notes: N[] = [
    { id: 1, user_id: 2, title: 'Datos', body: 'cuenta 00-000', created_at: ts, updated_at: ts },
    { id: 2, user_id: 2, title: 'Wifi', body: 'clave', created_at: ts, updated_at: ts },
    { id: 3, user_id: 2, title: 'Ramos', body: 'calculo', created_at: ts, updated_at: ts },
    { id: 4, user_id: 1, title: 'Pendientes', body: 'backups', created_at: ts, updated_at: ts },
    { id: 5, user_id: 3, title: 'Clientes', body: 'contacto +56 9 5550 2020', created_at: ts, updated_at: ts },
    { id: 6, user_id: 4, title: 'Viaje', body: 'pasaporte P0000000', created_at: ts, updated_at: ts },
    { id: 7, user_id: 5, title: 'Direccion', body: 'Av. Inventada 1234', created_at: ts, updated_at: ts },
  ];
  let nextUser = 6;
  let nextNote = 8;

  function pub(u: U) {
    const { password_hash, ...rest } = u;
    return rest;
  }
  function auth(req: any): U | null {
    const h = req.headers['authorization'];
    let token = h?.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token && req.headers['cookie']) {
      const m = /(?:^|;\s*)token=([^;]+)/.exec(req.headers['cookie']);
      if (m) token = m[1];
    }
    if (!token) return null;
    const p = verifyToken(token);
    return p ? users.find((u) => u.id === p.sub) ?? null : null;
  }

  const server = createServer(async (req, res) => {
    const u = new URL(req.url!, 'http://x');
    const p = u.pathname;
    const bodyRaw = await readBody(req);
    const json = () => { try { return JSON.parse(bodyRaw); } catch { return {}; } };
    const send = (code: number, obj: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', ...headers });
      res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
    };

    // ── auth
    if (p === '/api/auth/register' && req.method === 'POST') {
      const { email, password, name } = json();
      if (!email || !password || !name) return send(400, { error: 'faltan campos' });
      if (users.find((x) => x.email === email)) return send(409, { error: 'existe' });
      const nu: U = { id: nextUser++, email, password_hash: hash(password), name, phone: null, role: 'user', created_at: ts, updated_at: ts };
      users.push(nu);
      return send(201, { token: signToken({ sub: nu.id, email, role: 'user' }), user: pub(nu) });
    }
    if (p === '/api/auth/login' && req.method === 'POST') {
      const { email, password } = json();
      const user = users.find((x) => x.email === email);
      if (!user || user.password_hash !== hash(String(password ?? ''))) return send(401, { error: 'credenciales' });
      return send(200, { token: signToken({ sub: user.id, email: user.email, role: user.role }), user: pub(user) });
    }

    // ── users
    if (p === '/api/users/me' && req.method === 'GET') {
      const me = auth(req);
      return me ? send(200, pub(me)) : send(401, { error: 'No autenticado' });
    }
    if (p === '/api/users/me' && req.method === 'PATCH') {
      const me = auth(req);
      if (!me) return send(401, { error: 'No autenticado' });
      const data = json();
      for (const k of ['name', 'email', 'phone', 'bio', 'role']) if (k in data) (me as any)[k] = data[k]; // mass assignment
      return send(200, pub(me));
    }
    if (p === '/api/users/me/password' && req.method === 'POST') {
      const me = auth(req);
      if (!me) return send(401, { error: 'No autenticado' });
      const { current_password, new_password } = json();
      if (me.password_hash !== hash(String(current_password ?? ''))) return send(400, { error: 'actual incorrecta' });
      me.password_hash = hash(String(new_password)); // NO invalida tokens (vuln)
      return send(200, { ok: true });
    }

    // ── notes
    if (p === '/api/notes' && req.method === 'GET') {
      const me = auth(req);
      if (!me) return send(401, { error: 'No autenticado' });
      const q = u.searchParams.get('q');
      // SQL armado con el input: una comilla sin cerrar rompe la consulta (como Postgres real).
      if (q && (q.match(/'/g) ?? []).length % 2 === 1) return send(500, { error: 'syntax error at or near "%"', code: '42601', detail: 'unterminated quoted string', position: '1', stack: 'error: syntax error\n    at Query (/app/node_modules/pg/lib/query.js:1:1)' }); // verbose
      if (q && /union\s+select/i.test(q) && /from users/i.test(q)) {
        return send(200, users.map((x) => ({ id: x.id, user_id: x.id, title: x.email, body: x.password_hash, created_at: x.created_at, updated_at: x.updated_at })));
      }
      return send(200, notes.filter((n) => n.user_id === me.id));
    }
    if (p === '/api/notes' && req.method === 'POST') {
      const me = auth(req);
      if (!me) return send(401, { error: 'No autenticado' });
      const { title, body } = json();
      if (!title) return send(400, { error: 'titulo' });
      const nn: N = { id: nextNote++, user_id: me.id, title, body: body ?? '', created_at: ts, updated_at: ts };
      notes.push(nn);
      return send(201, nn);
    }
    const noteId = /^\/api\/notes\/(\d+)$/.exec(p);
    if (noteId) {
      const me = auth(req);
      if (!me) return send(401, { error: 'No autenticado' });
      const id = Number(noteId[1]);
      if (req.method === 'GET') {
        const n = notes.find((x) => x.id === id); // IDOR: sin filtro de dueño
        return n ? send(200, n) : send(404, { error: 'no' });
      }
      if (req.method === 'DELETE') {
        const i = notes.findIndex((x) => x.id === id && x.user_id === me.id);
        if (i < 0) return send(404, { error: 'no' });
        notes.splice(i, 1);
        res.writeHead(204); return res.end();
      }
    }

    // ── admin
    if (p === '/api/admin/users/export' && req.method === 'GET') {
      const me = auth(req);
      if (!me) return send(401, { error: 'No autenticado' }); // falta requireAdmin (vuln)
      return send(200, users);
    }
    if (p === '/api/admin/users' && req.method === 'GET') {
      const me = auth(req);
      if (!me) return send(401, { error: 'No autenticado' });
      if (me.role !== 'admin') return send(403, { error: 'Solo admin' });
      return send(200, users.map(pub));
    }

    // ── web (HTML)
    if (p === '/login' && req.method === 'POST') {
      const params = new URLSearchParams(bodyRaw);
      const user = users.find((x) => x.email === params.get('email'));
      if (!user || user.password_hash !== hash(params.get('password') ?? '')) { res.writeHead(401); return res.end('bad'); }
      // cookie SIN HttpOnly (vuln)
      res.writeHead(302, { location: '/', 'set-cookie': `token=${signToken({ sub: user.id, email: user.email, role: user.role })}; Path=/; SameSite=Lax` });
      return res.end();
    }
    const webNote = /^\/notes\/(\d+)$/.exec(p);
    if (webNote && req.method === 'GET') {
      const me = auth(req);
      if (!me) { res.writeHead(302, { location: '/login' }); return res.end(); }
      const n = notes.find((x) => x.id === Number(webNote[1]));
      if (!n) { res.writeHead(404); return res.end('no'); }
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><html><body><h1>${n.title}</h1><div class="note">${n.body}</div></body></html>`); // XSS: sin escapar
    }

    // redirect fuera de scope (para test de scope guard)
    if (p === '/redir-external') { res.writeHead(302, { location: 'https://evil.example/' }); return res.end(); }
    if (p === '/') { res.writeHead(302, { location: '/login' }); return res.end(); }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    users,
    notes,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

function readBody(req: any): Promise<string> {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c: Buffer) => (s += c));
    req.on('end', () => resolve(s));
  });
}
