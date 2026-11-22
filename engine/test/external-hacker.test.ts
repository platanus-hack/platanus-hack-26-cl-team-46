import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { runAsHacker } from '../src/contract/external-hacker.ts';
import { apuntesPlugin } from '../src/plugins/apuntes/index.ts';
import { startFixture } from './fixture.ts';

const JWT = 'jwt-not-invalidated-on-password-change';

/** Backend mock del contrato hacker externo. */
function mockBackend(victimUrl: string) {
  const posted: Array<Record<string, unknown>> = [];
  const batches: any[][] = [
    [{ type: 'control.next', vuln_id: JWT }],
    [{ type: 'control.verify', vuln_id: JWT }],
    [{ type: 'control.finish' }],
  ];
  const server: Server = createServer(async (req, res) => {
    const u = new URL(req.url!, 'http://x');
    const send = (o: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'GET' && u.pathname === '/sim/s1') {
      return send({ you: 'hacker', sim_id: 's1', status: 'running', app: { deployed_url: victimUrl, seed_users: [{ email: 'martin.soto@example.com', password: 'qwerty123', role: 'user' }] } });
    }
    if (req.method === 'GET' && u.pathname === '/sim/s1/inbox') {
      return send({ events: batches.shift() ?? [] });
    }
    if (req.method === 'POST' && u.pathname === '/sim/s1/events') {
      let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { posted.push(JSON.parse(b)); } catch {} res.writeHead(201); res.end('{}'); });
      return;
    }
    res.writeHead(404); res.end();
  });
  return { server, posted };
}

test('hacker externo: plan → next → verify (foothold persistido) → finish', async () => {
  const victim = await startFixture();
  const mb = mockBackend(victim.url);
  await new Promise<void>((r) => mb.server.listen(0, '127.0.0.1', r));
  const port = (mb.server.address() as any).port;
  try {
    const result = await runAsHacker({
      simId: 's1',
      token: 'tok',
      backendUrl: `http://127.0.0.1:${port}`,
      plugin: apuntesPlugin,
      seed: 'h',
      profile: 'noisy',
      pollMs: 10,
    });

    const types = mb.posted.map((e) => e.type);
    assert.ok(types.includes('attack.plan'), 'no publicó attack.plan');
    assert.ok(types.includes('attack.success'), 'no publicó attack.success');
    assert.ok(types.includes('attack.done'), 'no publicó attack.done');
    assert.ok(types.includes('attack.verify'), 'no publicó attack.verify');
    assert.deepEqual(result.attacked, [JWT]);

    // El plan trae los campos de enseñanza.
    const plan = mb.posted.find((e) => e.type === 'attack.plan')! as any;
    const f = plan.raw.findings.find((x: any) => x.vuln_id === JWT);
    assert.ok(f.real_case && f.correct_fix, 'el plan no trae real_case/correct_fix');

    // El verify: vuln sigue explotable y el foothold robado sigue activo (no hubo parche).
    const verify = mb.posted.find((e) => e.type === 'attack.verify')! as any;
    assert.equal(verify.raw.still_exploitable, true);
    assert.equal(verify.raw.attacker_active, true, 'el token robado debería seguir vivo sin parche');
    assert.ok(verify.raw.footholds.length >= 1);
  } finally {
    await new Promise<void>((r) => mb.server.close(() => r()));
    await victim.close();
  }
});
