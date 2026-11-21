import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RecordingClient, ScopeError, redactBody, sanitizeText } from '../src/http.ts';
import { randomIdentity } from '../src/evasion.ts';
import { makeRng, shuffle } from '../src/rng.ts';
import { startFixture } from './fixture.ts';

test('sanitizeText enmascara JWT, bcrypt, email y teléfono', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.abc_123-XYZ';
  assert.equal(sanitizeText(jwt), '<jwt>');
  assert.equal(sanitizeText('$2a$10$' + 'a'.repeat(53)), '<bcrypt>');
  assert.equal(sanitizeText('contacto martin.soto@example.com'), 'contacto m***@example.com');
  assert.equal(sanitizeText('tel +56 9 5550 3344 fin'), 'tel <phone> fin');
});

test('redactBody redacta campos sensibles en JSON y form-urlencoded', () => {
  const j = redactBody({ password: 'x', name: 'y' }) as any;
  assert.equal(j.password, '<redacted>');
  assert.equal(j.name, 'y');
  const f = redactBody('email=a%40b.com&password=secret', 'application/x-www-form-urlencoded') as string;
  assert.match(f, /password=<redacted>/);
  assert.match(f, /email=a%40b\.com/);
});

test('PRNG seeded es reproducible', () => {
  const a = makeRng('s');
  const b = makeRng('s');
  const seqA = [a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  assert.deepEqual(randomIdentity(makeRng('x')), randomIdentity(makeRng('x')));
  assert.deepEqual(shuffle(makeRng('y'), [1, 2, 3, 4, 5]), shuffle(makeRng('y'), [1, 2, 3, 4, 5]));
  // Semillas distintas → secuencias distintas (casi seguro).
  assert.notDeepEqual(makeRng('s')(), makeRng('t')());
});

test('scope guard: no sigue redirects fuera de scope', async () => {
  const fx = await startFixture();
  try {
    const c = new RecordingClient(fx.url, { ip: '1.1.1.1', userAgent: 't' });
    const res = await c.get('/redir-external');
    assert.equal(res.status, 302);
    assert.equal(new URL(res.finalUrl).origin, new URL(fx.url).origin); // NO saltó a evil.example
  } finally {
    await fx.close();
  }
});

test('scope guard: aborta un target fuera de scope', async () => {
  const fx = await startFixture();
  try {
    const c = new RecordingClient(fx.url, { ip: '1.1.1.1', userAgent: 't' });
    await assert.rejects(() => c.request({ path: 'https://evil.example/' }), ScopeError);
  } finally {
    await fx.close();
  }
});
