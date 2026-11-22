/**
 * Genera ProbeSpecs ejecutables a partir de los ángulos del LLM + el RepoModel.
 * Es el stand-in determinista (mock-B): el provider real los produciría por
 * salida estructurada (provider.adapt). Todo ProbeSpec pasa por el gate antes de
 * ejecutarse (probe-spec.ts), así B "genera módulos ejecutables" sin ejecución libre.
 */
import type { ProposedAngle } from '../providers/types.ts';
import type { RepoModel, RouteDef } from '../discovery/types.ts';
import type { ProbeSpec } from './probe-spec.ts';

export function generateProbes(angles: ProposedAngle[], repo: RepoModel): ProbeSpec[] {
  const getNoParam = repo.routes.filter((r) => r.method === 'GET' && !(r.params ?? []).length);
  const needsAuth = (r: RouteDef) => r.auth !== 'none' && !!r.auth;
  const specs: ProbeSpec[] = [];
  const seen = new Set<string>();

  for (const a of angles) {
    const cls = a.vuln_id;
    if (!cls || seen.has(cls)) continue;

    if (cls === 'sql-injection') {
      const r = getNoParam[0];
      if (!r) continue;
      seen.add(cls);
      specs.push({ id: 'gen-sqli', vuln_class: 'sql-injection', method: 'GET', path: r.path, query: { q: "'" }, needs_auth: needsAuth(r),
        success: { status_gte: 500, body_matches: 'code|syntax|error|unterminated|position' }, note: 'error-based, generado desde ángulo LLM' });
    } else if (cls === 'stored-xss' || cls === 'reflected-xss') {
      const r = getNoParam.find((x) => /echo|search|notes|items|q/.test(x.path)) ?? getNoParam[0];
      if (!r) continue;
      seen.add(cls);
      specs.push({ id: 'gen-xss', vuln_class: 'reflected-xss', method: 'GET', path: r.path, query: { q: '<svg/onload=alert(1)>xssgen' }, needs_auth: needsAuth(r),
        success: { reflects_query: 'q' }, note: 'reflected, generado desde ángulo LLM' });
    } else if (cls === 'admin-endpoint-no-authz' || cls === 'broken-access-control') {
      const r = repo.routes.find((x) => x.method === 'GET' && /\/admin/.test(x.path) && !(x.params ?? []).length);
      if (!r) continue;
      seen.add(cls);
      specs.push({ id: 'gen-authz', vuln_class: 'admin-endpoint-no-authz', method: 'GET', path: r.path, needs_auth: true,
        success: { status_eq: 200 }, note: 'authz, generado desde ángulo LLM (usuario de baja privilegia)' });
    }
  }
  return specs;
}
