import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderClient } from './render.client.js';

const client = () =>
  new RenderClient({
    get: (k: string) => (k === 'RENDER_API_KEY' ? 'rnd_test' : undefined),
  } as never);

describe('RenderClient.ownerId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('no cachea un fallo: el siguiente llamado reintenta', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('caído', { status: 500 }))
      .mockResolvedValueOnce(
        Response.json([
          { cursor: 'c', owner: { id: 'tea-1', name: 'Equipo' } },
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);
    const render = client();

    await expect(render.ownerId()).rejects.toThrow(/500/);
    await expect(render.ownerId()).resolves.toBe('tea-1');
    // Ya resuelto, se cachea.
    await expect(render.ownerId()).resolves.toBe('tea-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('manda un timeout en cada llamada a la API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]));
    vi.stubGlobal('fetch', fetchMock);
    await client().latestDeploy('srv-1');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
