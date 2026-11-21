/**
 * Provider mock, determinista y gratis ($0). Deriva "ángulos" de las señales del
 * RepoModel sin LLM. Sirve para tests y como fallback sin costo. El provider real
 * (anthropic.ts) tiene la misma interfaz y se enchufa cuando Sebastián lo habilita.
 */
import type { AnalysisProvider, GeneratedArtifact, ProposedAngle, ProviderInput } from './types.ts';

export class MockProvider implements AnalysisProvider {
  readonly id = 'mock';
  readonly free = true;

  async analyze(input: ProviderInput): Promise<ProposedAngle[]> {
    const repo = input.repo as { signals?: Array<{ kind: string; detail: string; ref?: { file: string; line?: number } }> } | undefined;
    const angles: ProposedAngle[] = [];
    for (const s of repo?.signals ?? []) {
      const map: Record<string, string> = {
        'raw-sql': 'sql-injection',
        'unescaped-render': 'stored-xss',
        'missing-authz': 'admin-endpoint-no-authz',
        'weak-jwt': 'jwt-not-invalidated-on-password-change',
        'mass-assignment': 'mass-assignment',
        'verbose-errors': 'verbose-errors',
      };
      angles.push({
        vuln_id: map[s.kind],
        title: `Ángulo desde señal ${s.kind}`,
        rationale: s.detail,
        where: s.ref ? `${s.ref.file}:${s.ref.line ?? '?'}` : undefined,
        confidence: 0.6,
      });
    }
    return angles;
  }

  async adapt(_input: ProviderInput, baseModuleId: string): Promise<GeneratedArtifact> {
    return {
      kind: 'attack-module',
      id: `mock-${baseModuleId}`,
      code: `// módulo generado (mock) para ${baseModuleId}\nexport const run = async () => ({ confirmed: false });`,
      spec: { baseModuleId },
      provenance: { provider: 'mock', createdAt: new Date().toISOString() },
    };
  }
}
