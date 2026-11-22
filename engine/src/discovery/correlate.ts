/** Correlaciona un hallazgo dinámico (vuln_id/ángulo) con archivo/línea del repo. */
import type { FileRef, RepoModel } from './types.ts';

export function correlate(angle: string, repo: RepoModel): FileRef | undefined {
  const sig = (k: string) => repo.signals.find((s) => s.kind === k)?.ref;
  const route = (pred: (r: RepoModel['routes'][number]) => boolean) => repo.routes.find(pred)?.ref;

  switch (angle) {
    case 'sql-injection':
      return sig('raw-sql');
    case 'stored-xss':
      return sig('unescaped-render');
    case 'admin-endpoint-no-authz':
      return sig('missing-authz') ?? route((r) => /\/admin/.test(r.path));
    case 'jwt-not-invalidated-on-password-change':
      return sig('weak-jwt') ?? repo.manifests.env.find((e) => /JWT/i.test(e.name))?.ref;
    case 'mass-assignment':
      return sig('mass-assignment') ?? route((r) => r.method === 'PATCH' && /users?\/me|profile/.test(r.path));
    case 'verbose-errors':
      return sig('verbose-errors');
    case 'idor':
      return route((r) => (r.params?.length ?? 0) > 0 && /note|user|item|order|doc/i.test(r.path) && r.auth !== 'admin');
    case 'weak-password-no-rate-limit':
      return route((r) => /login|auth/i.test(r.path) && r.method === 'POST');
    default:
      return undefined;
  }
}

/** Correlación para un conjunto de vuln_ids. */
export function correlateAll(repo: RepoModel, vulnIds: string[]): Record<string, FileRef | undefined> {
  const out: Record<string, FileRef | undefined> = {};
  for (const id of vulnIds) out[id] = correlate(id, repo);
  return out;
}
