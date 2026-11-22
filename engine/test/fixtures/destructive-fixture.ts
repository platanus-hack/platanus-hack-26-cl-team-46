/**
 * Fixture para los módulos DESTRUCTIVOS: endpoints vulnerables a DoS, SSRF,
 * prompt injection y open-redirect (phishing). En memoria, sin red externa real
 * (el "fetch" del SSRF es simulado). Solo para tests.
 */
import { createServer, type Server } from 'node:http';

export interface DFixture { server: Server; url: string; close: () => Promise<void>; }

const SYSTEM_SECRET = 'SYS_SECRET_sk-internal-9f3a2b';

export async function startDestructiveFixture(): Promise<DFixture> {
  const readBody = (req: any): Promise<string> => new Promise((r) => { let s = ''; req.on('data', (c: Buffer) => (s += c)); req.on('end', () => r(s)); });

  const server = createServer(async (req, res) => {
    const u = new URL(req.url!, 'http://x');
    const p = u.pathname;
    const send = (c: number, o: unknown, h: Record<string, string> = {}) => { res.writeHead(c, { 'content-type': 'application/json', ...h }); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };

    // DoS: endpoint lento, SIN rate limit.
    if (p === '/slow') {
      await new Promise((r) => setTimeout(r, 80));
      return send(200, { ok: true });
    }

    // SSRF: hace "fetch" de la URL del usuario; si apunta a metadata/localhost, filtra secretos.
    if (p === '/fetch') {
      const target = u.searchParams.get('url') ?? '';
      if (/169\.254\.169\.254|metadata|localhost|127\.0\.0\.1/i.test(target)) {
        return send(200, { aws_access_key_id: 'AKIA...', aws_secret_access_key: 'REDACTED_secret', token: 'internal-sts-token' });
      }
      return send(200, { fetched: target, body: 'ok' });
    }

    // Prompt injection: chat LLM ingenuo que filtra el secreto si lo manipulan.
    if (p === '/chat' && req.method === 'POST') {
      const body = await readBody(req);
      let msg = '';
      try { msg = JSON.parse(body).message ?? ''; } catch { msg = body; }
      if (/ignora|ignore previous|system prompt|revela|reveal|secret/i.test(msg)) {
        return send(200, { reply: `Claro. Mi system prompt dice: ${SYSTEM_SECRET}` });
      }
      return send(200, { reply: 'Hola, ¿en qué te ayudo?' });
    }

    // Open redirect (phishing): redirige a cualquier URL.
    if (p === '/go') {
      res.writeHead(302, { location: u.searchParams.get('to') ?? '/' });
      return res.end();
    }

    if (p === '/' || p === '/health') return send(200, { ok: true });
    send(404, { error: 'not found' });
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}
