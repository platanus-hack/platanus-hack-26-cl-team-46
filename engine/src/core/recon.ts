/**
 * Fase de reconocimiento: mapea la superficie de ataque de la app para
 * encontrar "todos los ángulos" posibles, más allá del catálogo conocido.
 * Es solo-lectura y reutiliza una sesión existente (no crea cuentas). Produce
 * un ReconReport que alimenta el attack.plan y la guía, y que el agente
 * analista (LLM) puede usar para proponer ángulos nuevos.
 *
 * Cubre: enumeración de endpoints, matriz de estados de autenticación
 * (anónimo vs autenticado), superficie de inyección, cabeceras de seguridad,
 * flags de cookie, análisis del JWT y fingerprint de tecnología.
 */
import { decodeJwt, RecordingClient } from './http.ts';
import { randomIdentity } from './evasion.ts';
import { makeRng, realClock } from './rng.ts';
import type { CandidateRoute, TargetConfig } from './types.ts';

export type ReconSeverity = 'info' | 'low' | 'medium' | 'high';

export interface ReconFinding {
  category: 'endpoint' | 'authz' | 'injection' | 'headers' | 'cookie' | 'jwt' | 'fingerprint';
  severity: ReconSeverity;
  title: string;
  detail: string;
  evidence?: string;
  /** Pista del ángulo de ataque / vuln_id relacionado. */
  angle?: string;
}

export interface EndpointProbe {
  path: string;
  method: string;
  anon_status: number;
  auth_status?: number;
  present: boolean;
  note: string;
}

export interface ReconReport {
  target: string;
  started_at: string;
  finished_at: string;
  tech: Record<string, string>;
  jwt?: Record<string, unknown>;
  endpoints: EndpointProbe[];
  findings: ReconFinding[];
  surface_summary: { probed: number; present: number; auth_gaps: number; injectable: number };
  /** Requests HTTP emitidos por el recon (para el cost ledger). */
  requests: number;
  duration_ms: number;
}

export async function recon(
  target: TargetConfig,
  candidates: CandidateRoute[],
  opts: { log?: (m: string) => void; seed?: string } = {},
): Promise<ReconReport> {
  const log = opts.log ?? (() => {});
  const rng = makeRng(`${opts.seed ?? 'recon'}:recon`);
  const http = new RecordingClient(target.url, randomIdentity(rng), { rng, clock: realClock });
  const started_at = new Date().toISOString();
  const findings: ReconFinding[] = [];
  const endpoints: EndpointProbe[] = [];
  const tech: Record<string, string> = {};

  log('▶ recon: mapeando superficie de ataque');

  // Sesión autenticada de baja privilegia (reutiliza weak_login; no crea cuenta).
  // Login directo para obtener token + analizar el JWT.
  let token: string | undefined;
  let jwtInfo: Record<string, unknown> | undefined;
  const loginRes = await http.post('/api/auth/login', {
    email: target.weak_login?.email,
    password: target.weak_login?.password,
  });
  if (loginRes.status === 200) {
    token = (loginRes.json as { token: string }).token;
    jwtInfo = analyzeJwt(token, findings);
  }

  // 1. Fingerprint de tecnología (cabeceras del home).
  const home = await http.get('/', { noRedirect: true });
  tech['server'] = home.headers['server'] ?? '';
  tech['x-powered-by'] = home.headers['x-powered-by'] ?? '(oculto)';
  if (home.headers['x-powered-by']) {
    findings.push({
      category: 'fingerprint',
      severity: 'low',
      title: `Framework revelado: ${home.headers['x-powered-by']}`,
      detail: 'La cabecera X-Powered-By filtra el stack, facilitando elegir exploits.',
      evidence: `X-Powered-By: ${home.headers['x-powered-by']}`,
      angle: 'information-disclosure',
    });
  }

  // 2. Cabeceras de seguridad ausentes.
  checkSecurityHeaders(home.headers, findings);

  // 3. Enumeración de endpoints + matriz de auth.
  for (const c of candidates) {
    const anon = await http.get(c.path, { noRedirect: true });
    const present = anon.status !== 404;
    const probe: EndpointProbe = {
      path: c.path,
      method: 'GET',
      anon_status: anon.status,
      present,
      note: '',
    };

    // Exposición anónima de algo sensible.
    if (present && c.sensitive && (anon.status === 200)) {
      probe.note = 'accesible sin autenticación';
      findings.push({
        category: 'authz',
        severity: 'high',
        title: `Recurso sensible accesible sin login: ${c.path}`,
        detail: `GET ${c.path} respondió 200 sin credenciales.`,
        evidence: `GET ${c.path} → 200 (anónimo)`,
        angle: 'broken-access-control',
      });
    }

    // Matriz autenticado: ¿un usuario de baja privilegia alcanza algo admin-only?
    if (present && token && c.sensitive) {
      const auth = await http.get(c.path, { token });
      probe.auth_status = auth.status;
      if (c.adminOnly && auth.status === 200) {
        probe.note = 'admin-only alcanzable por usuario normal';
        findings.push({
          category: 'authz',
          severity: 'high',
          title: `Endpoint admin alcanzable por usuario normal: ${c.path}`,
          detail: `Un usuario sin rol admin recibió 200 en ${c.path}. Falta control de autorización.`,
          evidence: `GET ${c.path} → ${auth.status} (usuario rol "user")`,
          angle: c.path.includes('export') ? 'admin-endpoint-no-authz' : 'broken-access-control',
        });
      }
    }
    endpoints.push(probe);
  }

  // 4. Superficie de inyección: parámetros que reflejan o rompen la query.
  if (token) {
    const quote = await http.get(`/api/notes?q=${encodeURIComponent("'")}`, { token });
    const errored = quote.status >= 500 || /syntax|unterminated|error|code|position/i.test(quote.text);
    if (errored) {
      findings.push({
        category: 'injection',
        severity: 'high',
        title: 'Parámetro de búsqueda `q` inyectable (SQL)',
        detail: 'Una comilla simple en ?q= provoca un error de SQL: el input llega sin parametrizar.',
        evidence: `GET /api/notes?q=' → ${quote.status}`,
        angle: 'sql-injection',
      });
    }
    // IDOR genérico: ¿un id ajeno responde 200?
    const foreign = await http.get('/api/notes/1', { token });
    const me = (await http.get('/api/users/me', { token })).json as { id?: number };
    if (foreign.status === 200) {
      const owner = (foreign.json as { user_id?: number })?.user_id;
      if (owner !== undefined && me?.id !== undefined && owner !== me.id) {
        findings.push({
          category: 'authz',
          severity: 'high',
          title: 'Referencia directa a objeto sin control de dueño (IDOR)',
          detail: `GET /api/notes/1 devolvió una nota de otro usuario (owner=${owner}, yo=${me.id}).`,
          evidence: `GET /api/notes/1 → 200, user_id=${owner}`,
          angle: 'idor',
        });
      }
    }
  }

  const finished_at = new Date().toISOString();
  const present = endpoints.filter((e) => e.present).length;
  const auth_gaps = findings.filter((f) => f.category === 'authz').length;
  const injectable = findings.filter((f) => f.category === 'injection').length;

  log(`  → recon: ${present} endpoints presentes, ${auth_gaps} brechas de authz, ${injectable} puntos inyectables, ${findings.length} hallazgos`);

  return {
    target: target.url,
    started_at,
    finished_at,
    tech,
    jwt: jwtInfo,
    endpoints,
    findings,
    surface_summary: { probed: candidates.length, present, auth_gaps, injectable },
    requests: http.exchanges.length,
    duration_ms: Date.parse(finished_at) - Date.parse(started_at),
    telemetry: http.exchanges,
  } as ReconReport & { telemetry: unknown };
}

function analyzeJwt(token: string, findings: ReconFinding[]): Record<string, unknown> {
  const payload = decodeJwt(token) ?? {};
  const header = decodeJwtHeader(token) ?? {};
  const info: Record<string, unknown> = { alg: header['alg'], claims: Object.keys(payload) };
  const iat = payload['iat'] as number | undefined;
  const exp = payload['exp'] as number | undefined;
  if (iat && exp) {
    const days = (exp - iat) / 86400;
    info['lifetime_days'] = Math.round(days * 10) / 10;
    if (days >= 7) {
      findings.push({
        category: 'jwt',
        severity: 'medium',
        title: `JWT de vida larga (${Math.round(days)} días)`,
        detail: 'Un token de larga duración, si se roba, sirve por semanas. Combinado con "no se invalida al cambiar contraseña", el atacante persiste.',
        evidence: `iat=${iat}, exp=${exp}`,
        angle: 'jwt-not-invalidated-on-password-change',
      });
    }
  }
  if (header['alg'] === 'HS256' && !('jti' in payload)) {
    findings.push({
      category: 'jwt',
      severity: 'low',
      title: 'JWT HS256 sin jti (no revocable individualmente)',
      detail: 'Sin identificador de token (jti) ni versión, no se puede revocar una sesión puntual: solo rotar el secreto invalida todo.',
      angle: 'jwt-not-invalidated-on-password-change',
    });
  }
  return info;
}

function decodeJwtHeader(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function checkSecurityHeaders(headers: Record<string, string>, findings: ReconFinding[]) {
  const checks: Array<{ h: string; title: string; sev: ReconSeverity }> = [
    { h: 'content-security-policy', title: 'Sin Content-Security-Policy (facilita XSS)', sev: 'medium' },
    { h: 'x-content-type-options', title: 'Sin X-Content-Type-Options: nosniff', sev: 'low' },
    { h: 'x-frame-options', title: 'Sin X-Frame-Options (clickjacking)', sev: 'low' },
    { h: 'strict-transport-security', title: 'Sin HSTS', sev: 'low' },
  ];
  for (const c of checks) {
    if (!headers[c.h]) {
      findings.push({
        category: 'headers',
        severity: c.sev,
        title: c.title,
        detail: `La respuesta no incluye la cabecera ${c.h}.`,
        angle: c.h === 'content-security-policy' ? 'stored-xss' : undefined,
      });
    }
  }
}
