import type { RepoModel } from '../discovery/types.ts';

/** auto: el plugin propio si el repo es una víctima conocida; si no, el genérico. */
export function detectPlugin(repo: RepoModel | undefined): 'apuntes' | 'tasks' | 'generic' {
  if (!repo) return 'generic';
  const paths = [...repo.routes.map((r) => r.path), ...(repo.prefixes ?? [])].join(' ');
  const name = repo.manifests.packageJson?.name ?? '';
  if (/apuntes/i.test(name) || (/\/api\/notes/.test(paths) && /\/api\/auth/.test(paths))) return 'apuntes';
  if (/^tasks?$/i.test(name) || (/\/tasks\/:\w+/.test(paths) && /\/go\b/.test(paths))) return 'tasks';
  return 'generic';
}
