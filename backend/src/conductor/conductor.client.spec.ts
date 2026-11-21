import { describe, expect, it } from 'vitest';
import { agentEnv } from './conductor.client.js';

describe('agentEnv', () => {
  it('tapa las credenciales globales y conserva las variables del agente', () => {
    expect(
      agentEnv(['RENDER_API_KEY', 'SANDBOX_ID'], {
        SANDBOX_ID: 'sbx-1',
        DEPLOYER_TOKEN: 't',
      }),
    ).toEqual({ RENDER_API_KEY: '', SANDBOX_ID: 'sbx-1', DEPLOYER_TOKEN: 't' });
  });
});
