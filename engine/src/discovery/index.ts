/**
 * Discovery del repositorio (requisito A): corre los adapters sobre el código y
 * los manifests y produce un RepoModel normalizado, con FileRef (archivo/línea/
 * commit) para correlacionar hallazgos dinámicos con el código.
 */
import { readManifests } from './manifests.ts';
import { extractOpenapiRoutes } from './openapi.ts';
import { extractExpressRoutes, extractFlaskRoutes } from './routes.ts';
import { scanRepo } from './scan.ts';
import { extractSignals } from './signals.ts';
import type { RepoModel } from './types.ts';

export { correlate, correlateAll } from './correlate.ts';
export type { RepoModel, FileRef, RouteDef, SignalDef } from './types.ts';

export async function discoverRepo(root: string, opts: { commit?: string } = {}): Promise<RepoModel> {
  const commit = opts.commit ?? 'working-tree';
  const files = await scanRepo(root);
  const { manifests, stack, notes } = readManifests(files, commit);

  const routes = [
    ...extractExpressRoutes(files, commit),
    ...extractFlaskRoutes(files, commit),
    ...extractOpenapiRoutes(files, manifests.openapi, commit),
  ];

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

  return { schemaVersion: '1', root, commit, stack, routes, signals, manifests, notes };
}
