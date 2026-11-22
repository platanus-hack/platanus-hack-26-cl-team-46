/**
 * Discovery del repositorio (requisito A): corre los adapters sobre el código y
 * los manifests y produce un RepoModel normalizado, con FileRef (archivo/línea/
 * commit) para correlacionar hallazgos dinámicos con el código.
 */
import { readManifests } from './manifests.ts';
import { extractOpenapiRoutes } from './openapi.ts';
import { extractExpressRoutes, extractFlaskRoutes } from './routes.ts';
import { extractFastapiRoutes, extractMountPrefixes, extractNestRoutes, extractNextRoutes } from './frameworks.ts';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { scanRepo } from './scan.ts';
import { extractSignals } from './signals.ts';
import type { RepoModel } from './types.ts';

export { correlate, correlateAll } from './correlate.ts';
export type { RepoModel, FileRef, RouteDef, SignalDef } from './types.ts';

/**
 * Carpeta de la app desplegada dentro del repo (root_dir del `.sandbox/manifest.json`
 * que deja el servicio de deploy). En un monorepo, solo esa carpeta corre en el
 * sandbox: correlacionar con el resto del repo atribuía hallazgos a código ajeno.
 */
export function appDirOf(root: string): string | undefined {
  const file = path.join(root, '.sandbox', 'manifest.json');
  if (!existsSync(file)) return undefined;
  try {
    const dir = (JSON.parse(readFileSync(file, 'utf8')) as { root_dir?: unknown }).root_dir;
    if (typeof dir !== 'string') return undefined;
    const clean = path.normalize(dir).replace(/^(\.\/)+|\/+$/g, '');
    if (!clean || clean === '.' || clean.startsWith('..') || path.isAbsolute(clean)) return undefined;
    return existsSync(path.join(root, clean)) ? clean : undefined;
  } catch {
    return undefined;
  }
}

export async function discoverRepo(
  root: string,
  opts: { commit?: string; appDir?: string } = {},
): Promise<RepoModel> {
  const commit = opts.commit ?? 'working-tree';
  const appDir = opts.appDir ?? appDirOf(root);
  const files = await scanRepo(root, { subdir: appDir });
  const { manifests, stack, notes } = readManifests(files, commit);
  if (appDir) notes.push(`Discovery acotado a ${appDir}/ (la app desplegada del monorepo).`);

  const routes = [
    ...extractExpressRoutes(files, commit),
    ...extractFlaskRoutes(files, commit),
    ...extractOpenapiRoutes(files, manifests.openapi, commit),
    ...extractNestRoutes(files, commit),
    ...extractFastapiRoutes(files, commit),
    ...extractNextRoutes(files, commit),
  ];
  const prefixes = extractMountPrefixes(files);

  const signals = extractSignals(files, commit);

  // Señal derivada: rutas admin sin autorización admin inferida.
  for (const r of routes) {
    if (/\/admin\b/.test(r.path) && r.auth !== 'admin' && r.method !== 'USE') {
      signals.push({ kind: 'missing-authz', detail: `Ruta admin sin requireAdmin inferido: ${r.method} ${r.path}`, ref: r.ref });
    }
  }

  if (manifests.openapi && /\.ya?ml$/.test(manifests.openapi.file)) {
    notes.push('OpenAPI YAML detectado pero no parseado (sin dependencia YAML); se usan rutas del código.');
  }
  if (files.length === 0) notes.push('el repo no tiene archivos legibles (¿ruta correcta?)');

  return { schemaVersion: '1', root, commit, stack, routes, signals, prefixes, manifests, notes };
}
