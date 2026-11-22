import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkFrame,
  embeddableFromHeaders,
  isPrivateIp,
} from './frame-check.js';

const ORIGIN = 'https://mayday.rip';
const h = (init: Record<string, string>) => new Headers(init);

describe('embeddableFromHeaders', () => {
  it('sin protecciones se puede embeber', () => {
    expect(embeddableFromHeaders(h({}), ORIGIN)).toBe(true);
  });

  it('X-Frame-Options bloquea', () => {
    expect(
      embeddableFromHeaders(h({ 'x-frame-options': 'SAMEORIGIN' }), ORIGIN),
    ).toBe(false);
    expect(
      embeddableFromHeaders(h({ 'x-frame-options': 'DENY' }), ORIGIN),
    ).toBe(false);
  });

  it('frame-ancestors según los orígenes permitidos', () => {
    const csp = (v: string) =>
      h({
        'content-security-policy': `default-src 'self'; frame-ancestors ${v}`,
      });
    expect(embeddableFromHeaders(csp("'none'"), ORIGIN)).toBe(false);
    expect(embeddableFromHeaders(csp("'self'"), ORIGIN)).toBe(false);
    expect(embeddableFromHeaders(csp('*'), ORIGIN)).toBe(true);
    expect(embeddableFromHeaders(csp('https:'), ORIGIN)).toBe(true);
    expect(embeddableFromHeaders(csp('https://mayday.rip'), ORIGIN)).toBe(true);
    expect(embeddableFromHeaders(csp('https://*.rip'), ORIGIN)).toBe(true);
    expect(embeddableFromHeaders(csp('https://otro.com'), ORIGIN)).toBe(false);
  });

  it('un CSP sin frame-ancestors no bloquea', () => {
    expect(
      embeddableFromHeaders(
        h({ 'content-security-policy': "script-src 'self'" }),
        ORIGIN,
      ),
    ).toBe(true);
  });
});

describe('isPrivateIp', () => {
  it('rechaza loopback, privadas, link-local (metadata) y mapeadas', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '0.0.0.0',
    ])
      expect(isPrivateIp(ip), ip).toBe(true);
  });
  it('deja pasar IPs públicas', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
      expect(isPrivateIp(ip), ip).toBe(false);
  });
});

describe('checkFrame', () => {
  let server: Server;
  let base: string;
  beforeAll(() => {
    server = createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: '/blocked' });
        return res.end();
      }
      if (req.url === '/blocked') res.setHeader('x-frame-options', 'DENY');
      if (req.url === '/api-404') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('Not Found');
      }
      if (req.url === '/html-404') {
        res.writeHead(404, { 'content-type': 'text/html' });
        return res.end('<h1>404</h1>');
      }
      res.end('ok');
    }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it('no consulta hosts privados ni puertos raros (SSRF)', async () => {
    expect(await checkFrame(`${base}/`, ORIGIN)).toEqual({
      embeddable: false,
      reason: 'private',
    });
    expect(
      await checkFrame('http://169.254.169.254/latest/meta-data', ORIGIN),
    ).toEqual({ embeddable: false, reason: 'private' });
    expect(await checkFrame('http://localhost/', ORIGIN)).toEqual({
      embeddable: false,
      reason: 'private',
    });
  });

  it('rechaza esquemas que no son http(s)', async () => {
    expect(await checkFrame('file:///etc/passwd', ORIGIN)).toEqual({
      embeddable: false,
      reason: 'invalid',
    });
    expect(await checkFrame('no es url', ORIGIN)).toEqual({
      embeddable: false,
      reason: 'invalid',
    });
  });

  it('sigue redirects y lee los headers del destino', async () => {
    const opts = { allowPrivate: true };
    expect(await checkFrame(`${base}/`, ORIGIN, opts)).toEqual({
      embeddable: true,
      page: true,
      status: 200,
    });
    expect(await checkFrame(`${base}/redirect`, ORIGIN, opts)).toEqual({
      embeddable: false,
      reason: 'blocked',
    });
  });

  it('marca sin página un error que no es HTML (backend solo API)', async () => {
    const opts = { allowPrivate: true };
    expect(await checkFrame(`${base}/api-404`, ORIGIN, opts)).toEqual({
      embeddable: true,
      page: false,
      status: 404,
    });
    expect(await checkFrame(`${base}/html-404`, ORIGIN, opts)).toEqual({
      embeddable: true,
      page: true,
      status: 404,
    });
  });
});
