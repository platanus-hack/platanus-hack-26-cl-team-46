import {
  REDACTED,
  redactDeep,
  redactSecrets,
  secretValues,
} from './redact-secrets.js';

const ENV: Record<string, unknown> = {
  CONDUCTOR_API_KEY: 'cdr_live_1234567890abcdef',
  ANTHROPIC_API_KEY: 'sk-ant-api03-XYZXYZXYZXYZ',
  SESSION_SECRET: 'short', // menos de 8: no se tapa
  PORT: 3001,
  OPENAI_API_KEY: undefined,
};

describe('redacción de secretos', () => {
  const secrets = secretValues((k) => ENV[k]);

  it('solo toma variables sensibles con valor de 8 o más caracteres', () => {
    expect(secrets).toEqual([
      'cdr_live_1234567890abcdef',
      'sk-ant-api03-XYZXYZXYZXYZ',
    ]);
  });

  it('tapa cada aparición del valor literal', () => {
    const text =
      'Tu key es cdr_live_1234567890abcdef y otra vez cdr_live_1234567890abcdef; short queda';
    expect(redactSecrets(text, secrets)).toBe(
      `Tu key es ${REDACTED} y otra vez ${REDACTED}; short queda`,
    );
  });

  it('recorre el raw de un evento', () => {
    expect(
      redactDeep(
        {
          note: 'export ANTHROPIC_API_KEY=sk-ant-api03-XYZXYZXYZXYZ',
          list: ['ok', 'cdr_live_1234567890abcdef'],
          n: 3,
          flag: true,
        },
        secrets,
      ),
    ).toEqual({
      note: `export ANTHROPIC_API_KEY=${REDACTED}`,
      list: ['ok', REDACTED],
      n: 3,
      flag: true,
    });
  });

  it('el valor más largo se tapa primero aunque contenga a otro', () => {
    const s = secretValues(
      (k) =>
        ({
          GITHUB_TOKEN: 'ghp_abcdefgh',
          GITHUB_HACK26_ORG_TOKEN: 'ghp_abcdefgh_extra',
        })[k],
    );
    expect(redactSecrets('x ghp_abcdefgh_extra y', s)).toBe(`x ${REDACTED} y`);
  });
});
