import { describe, expect, it } from 'vitest';
import {
  agentEnv,
  ConductorClient,
  ConductorError,
  isWorkspaceGone,
} from './conductor.client.js';

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

describe('ConductorClient: errores', () => {
  const config = {
    get: (k: string) =>
      (
        ({
          CONDUCTOR_API_URL: 'https://api.test',
          CONDUCTOR_API_KEY: 'key-de-prueba',
        }) as Record<string, unknown>
      )[k],
  };
  const client = () => new ConductorClient(config as never);

  afterEach(() => vi.unstubAllGlobals());

  it('un workspace archivado llega tipado, sin el texto del proveedor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"error":"Workspace is archived"}', { status: 409 }),
      ),
    );
    const err = (await client()
      .sendMessage('ses-1', 'hola')
      .catch((e: unknown) => e)) as ConductorError;
    expect(err).toBeInstanceOf(ConductorError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('workspace_gone');
    expect(err.message).toBe(
      'El servicio de agentes respondió con un error (HTTP 409)',
    );
    expect(isWorkspaceGone(err)).toBe(true);
  });

  it('otros errores no se confunden con un workspace caído', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    const err = await client()
      .sessionStatus('ses-1')
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 500, code: undefined });
    expect(isWorkspaceGone(err)).toBe(false);
    expect(isWorkspaceGone(new Error('Workspace is archived'))).toBe(false);
  });

  it('cada llamada lleva un tope de tiempo y el timeout llega tipado', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw Object.assign(new Error('The operation timed out.'), {
        name: 'TimeoutError',
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const err = await client()
      .sessionStatus('ses-1')
      .catch((e: unknown) => e);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(err).toMatchObject({
      code: 'timeout',
      message: 'El servicio de agentes no respondió a tiempo',
    });
  });
});
