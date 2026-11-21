import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadManifest, ManifestError } from './manifest.js';

describe('loadManifest', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'manifest-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lee .sandbox/manifest.json y aplica defaults', async () => {
    await mkdir(path.join(dir, '.sandbox'));
    await writeFile(
      path.join(dir, '.sandbox', 'manifest.json'),
      JSON.stringify({
        needs_postgres: true,
        env: { JWT_SECRET: { generate: true }, NODE_ENV: { value: 'production' } },
        seed_users: [{ email: 'a@b.cl', password: 'x', role: 'admin' }],
      }),
    );
    const { manifest, source } = await loadManifest(dir);
    expect(source).toBe('file');
    expect(manifest.runtime).toBe('docker');
    expect(manifest.healthcheck_path).toBe('/health');
    expect(manifest.database_url_env).toBe('DATABASE_URL');
    expect(manifest.env.JWT_SECRET).toEqual({ generate: true });
    expect(manifest.seed_users[0].role).toBe('admin');
  });

  it('rechaza un manifest inválido con un mensaje útil', async () => {
    await mkdir(path.join(dir, '.sandbox'));
    await writeFile(path.join(dir, '.sandbox', 'manifest.json'), JSON.stringify({ runtime: 'cobol' }));
    await expect(loadManifest(dir)).rejects.toThrow(ManifestError);
  });

  it('infiere docker si hay Dockerfile', async () => {
    await writeFile(path.join(dir, 'Dockerfile'), 'FROM node:22');
    const { manifest, source } = await loadManifest(dir);
    expect(source).toBe('inferred');
    expect(manifest.runtime).toBe('docker');
  });

  it('infiere node + postgres desde package.json', async () => {
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { build: 'tsc', start: 'node dist' }, dependencies: { pg: '^8' } }),
    );
    const { manifest } = await loadManifest(dir);
    expect(manifest.runtime).toBe('node');
    expect(manifest.needs_postgres).toBe(true);
    expect(manifest.build_command).toBe('npm install && npm run build');
  });

  it('falla si no sabe cómo desplegar', async () => {
    await expect(loadManifest(dir)).rejects.toThrow(/No se pudo inferir/);
  });
});
