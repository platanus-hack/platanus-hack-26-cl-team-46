/** RepoModel mínimo para los tests: las rutas que el discovery sacaría del código. */
import type { RepoModel } from '../src/discovery/types.ts';

export function repoModel(routes: Array<[method: string, path: string]>, commit = 't'): RepoModel {
  return {
    schemaVersion: '1', root: '.', commit, stack: [],
    routes: routes.map(([method, path], i) => ({
      method, path,
      params: [...path.matchAll(/:(\w+)/g)].map((m) => m[1]),
      ref: { file: 'src/app.js', line: i + 1, commit },
      source: 'express',
    })),
    signals: [], manifests: { dockerfiles: [], ci: [], env: [] }, notes: [],
  } as RepoModel;
}
