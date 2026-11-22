/**
 * Segundo target de prueba ("Tasks"), distinto de Apuntes: otra forma de API.
 * Vulns solapadas (IDOR, SQLi) + una no solapada (open redirect). Demuestra que
 * el core generaliza a otra app con solo un plugin nuevo. Fixture en memoria.
 */
import { createHmac, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';

const SECRET = 'tasks-secret';
const b64 = (s: string) => Buffer.from(s).toString('base64url');
function sign(p: Record<string, unknown>): string {
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const b = b64(JSON.stringify({ iat: now, exp: now + 3600, ...p }));
  return `${h}.${b}.${createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`;
}
function verify(t: string): any {
  const [h, b, s] = t.split('.');
  if (!h || !b || !s || createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url') !== s) return null;
  try { return JSON.parse(Buffer.from(b, 'base64url').toString('utf8')); } catch { return null; }
}
const hash = (pw: string) => '$2b$10$' + createHash('sha256').update(pw).digest('hex').slice(0, 53);

export interface TasksFixture { server: Server; url: string; close: () => Promise<void>; }

export async function startTasksFixture(): Promise<TasksFixture> {
  const users = [
    { id: 1, email: 'alice@x.com', password_hash: hash('alicepw'), role: 'user' },
    { id: 2, email: 'bob@x.com', password_hash: hash('bobpw'), role: 'user' },
  ];
  const tasks = [
    { id: 1, owner: 1, title: 'alice-1', body: 'secreto de alice' },
    { id: 2, owner: 1, title: 'alice-2', body: 'otra de alice' },
    { id: 3, owner: 2, title: 'bob-1', body: 'secreto de bob' },
    { id: 4, owner: 2, title: 'bob-2', body: 'otra de bob' },
  ];
  let nextUser = 3;

  function auth(req: any) {
    const h = req.headers['authorization'];
    const t = h?.startsWith('Bearer ') ? h.slice(7) : null;
    const p = t ? verify(t) : null;
    return p ? users.find((u) => u.id === p.sub) ?? null : null;
  }
  const readBody = (req: any): Promise<string> => new Promise((r) => { let s = ''; req.on('data', (c: Buffer) => (s += c)); req.on('end', () => r(s)); });

  const server = createServer(async (req, res) => {
    const u = new URL(req.url!, 'http://x');
    const p = u.pathname;
    const send = (c: number, o: unknown, hdr: Record<string, string> = {}) => { res.writeHead(c, { 'content-type': 'application/json', ...hdr }); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
    const json = async () => { try { return JSON.parse(await readBody(req)); } catch { return {}; } };

    if (p === '/register' && req.method === 'POST') {
      const { email, password } = await json();
      if (!email || !password) return send(400, { error: 'faltan campos' });
      if (users.find((x) => x.email === email)) return send(409, { error: 'existe' });
      const nu = { id: nextUser++, email, password_hash: hash(password), role: 'user' };
      users.push(nu);
      return send(201, { token: sign({ sub: nu.id, email }), user: { id: nu.id, role: 'user' } });
    }
    if (p === '/login' && req.method === 'POST') {
      const { email, password } = await json();
      const user = users.find((x) => x.email === email);
      if (!user || user.password_hash !== hash(String(password ?? ''))) return send(401, { error: 'credenciales' });
      return send(200, { token: sign({ sub: user.id, email: user.email }), user: { id: user.id, role: user.role } });
    }
    if (p === '/me' && req.method === 'GET') {
      const me = auth(req);
      return me ? send(200, { id: me.id, email: me.email, role: me.role }) : send(401, { error: 'no auth' });
    }
    if (p === '/tasks' && req.method === 'GET') {
      const me = auth(req);
      if (!me) return send(401, { error: 'no auth' });
      const q = u.searchParams.get('search');
      if (q && /union\s+select/i.test(q) && /from users/i.test(q)) {
        return send(200, users.map((x) => ({ id: x.id, owner: x.id, title: x.email, body: x.password_hash })));
      }
      return send(200, tasks.filter((t) => t.owner === me.id));
    }
    const tid = /^\/tasks\/(\d+)$/.exec(p);
    if (tid && req.method === 'GET') {
      const me = auth(req);
      if (!me) return send(401, { error: 'no auth' });
      const t = tasks.find((x) => x.id === Number(tid[1])); // IDOR: sin filtro de dueño
      return t ? send(200, t) : send(404, { error: 'no' });
    }
    if (p === '/go' && req.method === 'GET') {
      // Open redirect: redirige a cualquier URL sin validar.
      const to = u.searchParams.get('to') ?? '/';
      res.writeHead(302, { location: to });
      return res.end();
    }
    send(404, { error: 'not found' });
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}
