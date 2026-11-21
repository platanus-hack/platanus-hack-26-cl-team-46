/** Extrae rutas de un spec OpenAPI/Swagger JSON (YAML queda como nota). */
import type { FileRef, RouteDef, ScannedFile } from './types.ts';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

export function extractOpenapiRoutes(files: ScannedFile[], openapiRef: FileRef | undefined, commit: string): RouteDef[] {
  if (!openapiRef || !openapiRef.file.endsWith('.json')) return [];
  const f = files.find((x) => x.rel === openapiRef.file);
  if (!f) return [];
  let spec: any;
  try {
    spec = JSON.parse(f.lines.join('\n'));
  } catch {
    return [];
  }
  const routes: RouteDef[] = [];
  const globalSecurity = spec.security;
  for (const [p, ops] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(ops as Record<string, any>)) {
      if (!METHODS.includes(method)) continue;
      const security = op?.security ?? globalSecurity;
      routes.push({
        method: method.toUpperCase(),
        path: p,
        ref: { file: openapiRef.file, commit },
        auth: Array.isArray(security) && security.length ? 'user' : 'none',
        params: [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
        source: 'openapi',
      });
    }
  }
  return routes;
}
