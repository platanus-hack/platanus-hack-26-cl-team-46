/**
 * Plugin genérico: ataca cualquier app web sin un plugin escrito para ella.
 * La superficie sale del repo (discovery) y de la app en vivo; los ataques
 * confirman con evidencia real del tráfico. Se arma por corrida (estado propio).
 */
import type { CandidateRoute, EnginePlugin } from '../../core/types.ts';
import { scanRepo } from '../../discovery/scan.ts';
import type { RepoModel } from '../../discovery/types.ts';
import { buildAttacks } from './attacks.ts';
import { CATALOG, STORYLINES } from './catalog.ts';
import { GenericState } from './surface.ts';

const SECRET_LINE = /\b([A-Z0-9_]*(?:JWT|SECRET|TOKEN_KEY|SIGNING_KEY)[A-Z0-9_]*)\s*[:=]\s*['"]?([^'"\s#]{3,})['"]?/;
const SECRET_CODE = /(?:secret|secretOrKey|jwtSecret)\s*:\s*['"`]([^'"`]{3,})['"`]/;

/** Secretos candidatos escritos en el repo (.env.example, config, módulos de auth). */
export async function readRepoSecrets(root: string): Promise<string[]> {
  const out = new Set<string>();
  for (const f of await scanRepo(root)) {
    if (!/(^|\/)\.env|\.(ts|js|py|json|ya?ml|toml|cfg)$/.test(f.rel) || /node_modules|test|spec/.test(f.rel)) continue;
    for (const line of f.lines) {
      const m = SECRET_LINE.exec(line) ?? SECRET_CODE.exec(line);
      const v = m?.[2] ?? m?.[1];
      if (v && !/process\.env|os\.environ|getenv|\$\{/.test(line) && v.length <= 128) out.add(v);
    }
  }
  return [...out];
}

export interface GenericPlugin extends EnginePlugin {
  state: GenericState;
}

export function buildGenericPlugin(input: { repo?: RepoModel; repoSecrets?: string[] } = {}): GenericPlugin {
  const state = new GenericState({ repo: input.repo, repoSecrets: input.repoSecrets ?? [] });
  const fromRepo: CandidateRoute[] = (input.repo?.routes ?? [])
    .filter((r) => r.method === 'GET' && !r.path.includes('*'))
    .slice(0, 30)
    .map((r) => ({
      path: r.path.replace(/:(\w+)|\{(\w+)\}/g, '1'),
      sensitive: r.auth === 'user' || r.auth === 'admin',
      adminOnly: r.auth === 'admin' || /\/admin\b/.test(r.path),
    }));
  return {
    id: 'generic',
    scenarioNamespace: 'generic',
    catalog: CATALOG,
    attacks: buildAttacks(state),
    reconCandidates: [{ path: '/' }, ...fromRepo],
    storylines: STORYLINES,
    refFor: (vulnId) => state.refs.get(vulnId),
    state,
  };
}
