/**
 * App desconocida para el plugin genérico: una API estilo NestJS con prefijo
 * global /api/v1, login por username, JWT en access_token y un frontend SPA que
 * responde 200 HTML a cualquier ruta. Dos modos:
 *  - vulnerable: tiene las 11 vulnerabilidades del catálogo genérico.
 *  - hardened: la misma app bien hecha; el motor no debe confirmar nada.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

export interface GenericFixture { url: string; close: () => Promise<void>; }

export async function startGenericFixture(opts: { hardened?: boolean } = {}): Promise<GenericFixture> {
  const hard = !!opts.hardened;
  const SECRET = hard ? randomBytes(32).toString('hex') : 'changeme';
  const users = [
    { id: 1, username: 'ana', email: 'ana@shop.cl', password: 'qwerty123', role: 'user' },
    { id: 2, username: 'beto', email: 'beto@shop.cl', password: 'B3to-largo-y-unico!', role: 'user' },
    { id: 3, username: 'root', email: 'admin@shop.cl', password: 'R00t-muy-largo-y-unico!', role: 'admin' },
  ];
  const orders = [
    { id: 1, customerId: 2, total: 19990 },
    { id: 2, customerId: 1, total: 4990 },
    { id: 3, customerId: 3, total: 99990 },
  ];
  const fails = new Map<string, number>();

  const sign = (p: Record<string, unknown>) => {
    const h = b64({ alg: 'HS256', typ: 'JWT' });
    const b = b64(p);
    return `${h}.${b}.${createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`;
  };
  const verify = (t: string) => {
    const [h, b, s] = t.split('.');
    if (!h || !b || s === undefined) return null;
    const head = JSON.parse(Buffer.from(h, 'base64url').toString());
    if (head.alg !== 'HS256') return null;
    if (createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url') !== s) return null;
    return JSON.parse(Buffer.from(b, 'base64url').toString());
  };
  const current = (req: IncomingMessage) => {
    const h = req.headers.authorization;
    const claims = h?.startsWith('Bearer ') ? verify(h.slice(7)) : null;
    const u = claims ? users.find((x) => x.id === claims.sub) : undefined;
    return u ? { ...u, role: claims.role ?? u.role } : null;
  };
  const read = (req: IncomingMessage): Promise<string> => new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(s)); });

  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url!, 'http://x');
    const p = u.pathname;
    const origin = req.headers.origin;
    const cors: Record<string, string> = hard
      ? { 'access-control-allow-origin': 'https://shop.example' }
      : origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } : {};
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify(body));
    };
    const html = () => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><body><div id="root"></div></body></html>');
    };

    if (p === '/.env' && !hard) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(`DATABASE_URL=postgres://localhost:5432/shop\nJWT_SECRET=${SECRET}\nPORT=3000\n`);
    }
    if (p === '/api-json') {
      return send(200, { openapi: '3.0.0', paths: { '/api/v1/products': { get: {} }, '/api/v1/auth/signin': { post: {} }, '/api/v1/customers': { get: {} }, '/api/v1/orders/{id}': { get: { security: [{ bearer: [] }] } } } });
    }
    if (!p.startsWith('/api/v1/')) return req.method === 'GET' ? html() : send(404, { message: `Cannot ${req.method} ${p}`, error: 'Not Found', statusCode: 404 });

    const route = p.slice('/api/v1'.length);
    let body: Record<string, any> = {};
    if (req.method !== 'GET') {
      const raw = await read(req);
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        return hard
          ? send(400, { message: 'Bad Request', statusCode: 400 })
          : send(400, { message: (e as Error).message, stack: `${(e as Error).stack}\n    at parseBody (/app/src/main.ts:42:17)` });
      }
    }

    if (route === '/auth/signin' && req.method === 'POST') {
      const user = users.find((x) => x.username === body.username);
      const key = String(body.username);
      if (hard && (fails.get(key) ?? 0) >= 5) return send(429, { message: 'Too Many Requests' });
      if (!user || user.password !== body.password) {
        fails.set(key, (fails.get(key) ?? 0) + 1);
        if (hard) return send(401, { message: 'Invalid credentials' });
        return user ? send(401, { message: 'Wrong password' }) : send(404, { message: 'User not found' });
      }
      return send(200, { access_token: sign({ sub: user.id, username: user.username, role: user.role }) });
    }
    if (route === '/auth/signup' && req.method === 'POST') {
      if (!body.username || !body.password) return send(400, { message: 'username y password son obligatorios' });
      const nu = { id: users.length + 1, username: String(body.username), email: String(body.email ?? ''), password: String(body.password), role: hard ? 'user' : String(body.role ?? 'user') };
      users.push(nu);
      return send(201, { id: nu.id, username: nu.username });
    }
    if (route === '/auth/profile' && req.method === 'GET') {
      const me = current(req);
      return me ? send(200, { id: me.id, username: me.username, email: me.email, role: me.role }) : send(401, { message: 'Unauthorized' });
    }
    if (route === '/customers' && req.method === 'GET') {
      if (hard && !current(req)) return send(401, { message: 'Unauthorized' });
      return send(200, users.map((x) => ({ id: x.id, username: x.username, email: x.email })));
    }
    const order = /^\/orders\/(\d+)$/.exec(route);
    if (order && req.method === 'GET') {
      const me = current(req);
      if (!me) return send(401, { message: 'Unauthorized' });
      const o = orders.find((x) => x.id === Number(order[1]));
      if (!o || (hard && o.customerId !== me.id)) return send(404, { message: 'Order not found' });
      return send(200, o);
    }
    if (route === '/admin/stats' && req.method === 'GET') {
      const me = current(req);
      if (!me) return send(401, { message: 'Unauthorized' });
      if (hard && me.role !== 'admin') return send(403, { message: 'Forbidden' });
      return send(200, { users: users.length, revenue: 124970, orders: orders.length });
    }
    if (route === '/products' && req.method === 'GET') {
      const search = u.searchParams.get('search') ?? '';
      if (!hard && search.includes("'")) return send(500, { message: `QueryFailedError: syntax error at or near "${search}"` });
      return send(200, [{ id: 1, name: 'Polera' }]);
    }
    return send(404, { message: `Cannot ${req.method} ${p}`, error: 'Not Found', statusCode: 404 });
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  return { url: `http://127.0.0.1:${addr.port}`, close: () => new Promise((r) => server.close(() => r())) };
}
