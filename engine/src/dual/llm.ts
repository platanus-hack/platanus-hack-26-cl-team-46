/** Camino B: ángulos propuestos por el LLM a partir del RepoModel + recon. */
import type { AnalysisProvider, ProposedAngle } from '../providers/types.ts';
import type { RepoModel } from '../discovery/types.ts';

export async function runLlmAngles(
  provider: AnalysisProvider,
  input: { repo: RepoModel; recon?: unknown; scopeOrigins: string[] },
): Promise<ProposedAngle[]> {
  const slim = {
    stack: input.repo.stack,
    routes: input.repo.routes.map((r) => ({ method: r.method, path: r.path, auth: r.auth, source: r.source })),
    signals: input.repo.signals.map((s) => ({ kind: s.kind, ref: `${s.ref.file}:${s.ref.line ?? ''}` })),
  };
  try {
    return await provider.analyze({ repo: slim, recon: input.recon, scopeOrigins: input.scopeOrigins });
  } catch {
    return [];
  }
}
