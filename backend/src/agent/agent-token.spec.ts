import { signAgentToken, verifyAgentToken } from './agent-token.js';

describe('agent token', () => {
  const secret = 'un-secreto-suficientemente-largo';

  it('valida el token de su propio sandbox', () => {
    expect(verifyAgentToken(secret, signAgentToken(secret, 'sbx-1'), 'sbx-1')).toBe(true);
  });

  it('no sirve para otro sandbox', () => {
    expect(verifyAgentToken(secret, signAgentToken(secret, 'sbx-1'), 'sbx-2')).toBe(false);
  });

  it('no sirve con otro secreto ni manipulado', () => {
    const t = signAgentToken(secret, 'sbx-1');
    expect(verifyAgentToken('otro-secreto-largo-1234', t, 'sbx-1')).toBe(false);
    expect(verifyAgentToken(secret, t.slice(0, -1) + 'x', 'sbx-1')).toBe(false);
    expect(verifyAgentToken(secret, 'basura', 'sbx-1')).toBe(false);
  });
});
