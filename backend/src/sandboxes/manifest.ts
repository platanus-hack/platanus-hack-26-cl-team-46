import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/**
 * Convención `.sandbox/manifest.json` en la raíz del repo a desplegar.
 * Le dice al deployer cómo levantar la app. Si no existe, se infiere lo
 * que se pueda (Dockerfile o package.json).
 */
/**
 * Ruta relativa a la app: empieza con una sola `/`, sin barra invertida ni espacios. Así
 * nunca es una URL absoluta ni protocol-relative (`//otro-host`), que haría que
 * el backend le pegara a cualquier host (SSRF).
 */
const HEALTHCHECK_PATH = /^\/(?![/\\])[^\s\\]*$/;

export const manifestSchema = z.object({
  runtime: z.enum(['docker', 'node']).default('docker'),
  healthcheck_path: z
    .string()
    .regex(
      HEALTHCHECK_PATH,
      'debe ser una ruta de la app que empiece con "/" (p. ej. /health)',
    )
    .default('/health'),
  needs_postgres: z.boolean().default(false),
  /** Nombre de la variable donde se inyecta la URL de Postgres. */
  database_url_env: z.string().default('DATABASE_URL'),
  root_dir: z.string().optional(),
  dockerfile_path: z.string().optional(),
  build_command: z.string().optional(),
  start_command: z.string().optional(),
  env: z
    .record(
      z.string(),
      z.union([
        z.object({ value: z.string() }),
        z.object({ generate: z.literal(true) }),
      ]),
    )
    .default({}),
  seed_users: z
    .array(
      z
        .object({
          email: z.string(),
          password: z.string(),
          role: z.string().optional(),
        })
        .loose(),
    )
    .default([]),
});

export type SandboxManifest = z.infer<typeof manifestSchema>;

/**
 * URL del healthcheck dentro de la app, o null si `healthPath` apunta a otro
 * origen (manifests guardados antes de validar la ruta).
 */
export function healthcheckUrl(
  appUrl: string,
  healthPath: string | undefined,
): string | null {
  const { origin } = new URL(appUrl);
  // Vacío (manifests viejos) = la raíz, como antes.
  const path = healthPath || '/';
  if (!HEALTHCHECK_PATH.test(path)) return null;
  const target = new URL(path, origin);
  return target.origin === origin ? target.toString() : null;
}

export class ManifestError extends Error {}

export async function loadManifest(
  repoDir: string,
): Promise<{ manifest: SandboxManifest; source: 'file' | 'inferred' }> {
  const file = path.join(repoDir, '.sandbox', 'manifest.json');
  if (existsSync(file)) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, 'utf8'));
    } catch (err) {
      throw new ManifestError(
        `.sandbox/manifest.json no es JSON válido: ${(err as Error).message}`,
      );
    }
    const parsed = manifestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ManifestError(
        `.sandbox/manifest.json inválido: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    return { manifest: parsed.data, source: 'file' };
  }
  return { manifest: await inferManifest(repoDir), source: 'inferred' };
}

/** Inferencia básica para repos sin manifest. El deploy genérico de verdad es bonus. */
async function inferManifest(repoDir: string): Promise<SandboxManifest> {
  if (existsSync(path.join(repoDir, 'Dockerfile'))) {
    return manifestSchema.parse({ runtime: 'docker', healthcheck_path: '/' });
  }
  const pkgFile = path.join(repoDir, 'package.json');
  if (existsSync(pkgFile)) {
    const pkg = JSON.parse(await readFile(pkgFile, 'utf8')) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};
    const needsPostgres =
      'pg' in deps || 'postgres' in deps || '@prisma/client' in deps;
    const hasBuild = Boolean(pkg.scripts?.build);
    return manifestSchema.parse({
      runtime: 'node',
      healthcheck_path: '/',
      needs_postgres: needsPostgres,
      build_command: hasBuild ? 'npm install && npm run build' : 'npm install',
      start_command: 'npm start',
    });
  }
  throw new ManifestError(
    'No se pudo inferir cómo desplegar el repo: no tiene .sandbox/manifest.json, Dockerfile ni package.json',
  );
}
