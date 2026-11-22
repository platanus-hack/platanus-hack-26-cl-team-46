import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BRIDGE_PATH,
  createPreviewProxy,
  MAX_REWRITE_HTML_BYTES,
  previewHostMatcher,
  rewriteHtml,
  rewriteSetCookie,
  stripFrameAncestors,
} from './preview-proxy.js';

const TEMPLATE = 'https://{sandbox}.preview.mayday.rip';

describe('previewHostMatcher', () => {
  const match = previewHostMatcher(TEMPLATE);

  it('extrae el sandbox del host', () => {
    expect(match('sbx-8e92f100.preview.mayday.rip')).toBe('sbx-8e92f100');
    expect(match('SBX-8E92F100.Preview.Mayday.Rip')).toBe('sbx-8e92f100');
  });

  it('ignora hosts que no son de preview o ids raros', () => {
    expect(match('api.mayday.rip')).toBeNull();
    expect(match('sbx-1.preview.mayday.rip.evil.com')).toBeNull();
    expect(match('a.b.preview.mayday.rip')).toBeNull();
    expect(match('evil.preview.mayday.rip')).toBeNull();
    expect(match(undefined)).toBeNull();
  });

  it('respeta el puerto del template local', () => {
    const local = previewHostMatcher('http://{sandbox}.preview.localhost:3001');
    expect(local('sbx-abcd1234.preview.localhost:3001')).toBe('sbx-abcd1234');
    expect(local('sbx-abcd1234.preview.localhost:9999')).toBeNull();
  });
});

describe('reescrituras', () => {
  it('quita Domain de las cookies', () => {
    expect(
      rewriteSetCookie(
        'token=abc; Domain=sbx-1.onrender.com; Path=/; SameSite=Lax',
      ),
    ).toBe('token=abc; Path=/; SameSite=Lax');
  });

  it('saca frame-ancestors del CSP y deja lo demás', () => {
    expect(
      stripFrameAncestors(
        "default-src 'self'; frame-ancestors 'none'; img-src *",
      ),
    ).toBe("default-src 'self'; img-src *");
  });

  it('inyecta el puente en el head y cambia el origen', () => {
    const html = rewriteHtml(
      '<html><head><title>x</title></head><a href="https://sbx-1.onrender.com/a">',
      'https://sbx-1.onrender.com',
      'https://sbx-1.preview.mayday.rip',
    );
    expect(html).toContain(
      `<head><script src="${BRIDGE_PATH}"></script><title>`,
    );
    expect(html).toContain('href="https://sbx-1.preview.mayday.rip/a"');
  });
});

describe('createPreviewProxy', () => {
  let upstream: Server;
  let upstreamUrl: string;
  let app: Server;

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      if (req.url === '/login' && req.method === 'POST') {
        let body = '';
        req.on('data', (c: Buffer) => (body += c.toString()));
        req.on('end', () => {
          res.writeHead(302, {
            'set-cookie': `token=${body}; Path=/; SameSite=Lax`,
            location: `${upstreamUrl}/`,
            'x-frame-options': 'DENY',
          });
          res.end();
        });
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(
        `<html><head></head><body>cookie=${req.headers.cookie ?? ''}</body></html>`,
      );
    }).listen(0);
    upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

    const proxy = createPreviewProxy({
      template: TEMPLATE,
      resolve: (id) => (id === 'sbx-abcd1234' ? upstreamUrl : null),
    });
    // Lo que no es preview sigue al "backend".
    app = createServer((req, res) =>
      proxy(req, res, () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      }),
    );
  });

  afterAll(() => upstream.close());

  const host = 'sbx-abcd1234.preview.mayday.rip';

  it('deja pasar las rutas normales del backend', async () => {
    await request(app).get('/simulations').expect(200, { ok: true });
  });

  it('no atiende sandboxes desconocidos (no es un proxy abierto)', async () => {
    const res = await request(app)
      .get('/')
      .set('host', 'sbx-zzzz9999.preview.mayday.rip');
    expect(res.status).toBe(404);
  });

  it('reenvía el body, reescribe redirect y cookies, y quita X-Frame-Options', async () => {
    const res = await request(app).post('/login').set('host', host).send('abc');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      'https://sbx-abcd1234.preview.mayday.rip/',
    );
    expect(res.headers['set-cookie']).toEqual([
      'token=abc; Path=/; SameSite=Lax',
    ]);
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it('manda las cookies a la app e inyecta el puente en el HTML', async () => {
    const res = await request(app)
      .get('/')
      .set('host', host)
      .set('cookie', 'token=abc');
    expect(res.text).toContain(`<script src="${BRIDGE_PATH}"></script>`);
    expect(res.text).toContain('cookie=token=abc');
  });

  it('sirve el script del puente', async () => {
    const res = await request(app).get(BRIDGE_PATH).set('host', host);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.text).toContain('mayday:nav');
  });
});

describe('createPreviewProxy › la app corta o no responde', () => {
  let upstream: Server;
  let app: Server;
  let port: number;
  const host = 'sbx-abcd1234.preview.mayday.rip';
  const logs: string[] = [];

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      if (req.url === '/reset-stream') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.write('x'.repeat(1000));
        setTimeout(() => res.socket?.destroy(), 20);
        return;
      }
      if (req.url === '/reset-html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.write('<html><head>');
        setTimeout(() => res.socket?.destroy(), 20);
        return;
      }
      if (req.url === '/big-html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(
          `<html><head></head>${'a'.repeat(MAX_REWRITE_HTML_BYTES + 10)}`,
        );
        return;
      }
      if (req.url === '/hang') return; // nunca responde
      res.end('ok');
    });
    await new Promise<void>((r) => upstream.listen(0, r));
    const upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    const proxy = createPreviewProxy({
      template: TEMPLATE,
      resolve: () => upstreamUrl,
      log: (m) => logs.push(m),
      headersTimeoutMs: 200,
    });
    app = createServer((req, res) => void proxy(req, res, () => res.end()));
    await new Promise<void>((r) => app.listen(0, r));
    port = (app.address() as AddressInfo).port;
  });

  afterAll(() => {
    upstream.closeAllConnections();
    upstream.close();
    app.closeAllConnections();
    app.close();
  });

  /** GET crudo (supertest no deja ver una respuesta cortada a la mitad). */
  const get = (path: string) =>
    new Promise<{ status?: number; body: string; complete: boolean }>(
      (resolve) => {
        const req = httpRequest(
          { host: '127.0.0.1', port, path, headers: { host } },
          (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c: string) => (body += c));
            res.on('error', () => undefined);
            res.on('close', () =>
              resolve({ status: res.statusCode, body, complete: res.complete }),
            );
          },
        );
        req.on('error', () => resolve({ body: '', complete: false }));
        req.end();
      },
    );

  it('si la app corta a mitad del stream, cierra la respuesta sin botar el proceso', async () => {
    const res = await get('/reset-stream');
    expect(res.complete).toBe(false);
    // El proxy sigue atendiendo.
    expect((await get('/ok')).body).toBe('ok');
  });

  it('si la app corta antes de terminar el HTML, responde 502', async () => {
    const res = await get('/reset-html');
    expect(res.status).toBe(502);
    expect(res.body).toContain('No se pudo conectar con la app');
  });

  it('si la app no responde los headers a tiempo, responde 502', async () => {
    const res = await get('/hang');
    expect(res.status).toBe(502);
  });

  it('un HTML más grande que el tope se sirve tal cual, sin cargarlo entero', async () => {
    const res = await get('/big-html');
    expect(res.status).toBe(200);
    expect(res.complete).toBe(true);
    expect(res.body.length).toBe(
      '<html><head></head>'.length + MAX_REWRITE_HTML_BYTES + 10,
    );
    expect(res.body).not.toContain(BRIDGE_PATH);
  });
});
