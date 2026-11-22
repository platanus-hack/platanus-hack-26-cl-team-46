/**
 * Camino A: suite de ataques GENÉRICOS, app-agnósticos, derivados del RepoModel
 * (rutas + señales del discovery) y confirmados con tráfico real. Generalizan a
 * cualquier app que exponga esas superficies (no están atados a Apuntes).
 */
import { decodeJwt, RecordingClient } from '../core/http.ts';
import { randomIdentity } from '../core/evasion.ts';
import { makeRng, realClock } from '../core/rng.ts';
import type { RepoModel, RouteDef } from '../discovery/types.ts';
import type { TargetConfig } from '../core/types.ts';
import type { GenericFinding } from './types.ts';

const OWNER_KEYS = ['user_id', 'owner', 'owner_id', 'userId', 'ownerId', 'account_id'];
const ID_PARAM = /^(id|.*_id|.*Id)$/;
const REDIRECT_PARAMS = ['to', 'url', 'next', 'redirect', 'return', 'returnUrl', 'dest'];
const SQL_PARAMS = ['q', 'search', 'query', 'filter', 's', 'term', 'name'];
const SQL_ERR = /syntax|unterminated|unclosed|SQLITE_|near "|pg_|mysql|ORA-|SQL|\b42\d{3}\b/i;

export async function runGenericSuite(
  target: TargetConfig,
  repo: RepoModel,
  opts: { seed?: string; log?: (m: string) => void } = {},
): Promise<GenericFinding[]> {
  const log = opts.log ?? (() => {});
  const rng = makeRng(`${opts.seed ?? 'dual'}:generic`);
  const http = new RecordingClient(target.url, randomIdentity(rng), { rng, clock: realClock });
  const out: GenericFinding[] = [];

  // Sesión de baja privilegia (si hay credencial conocida).
  let token: string | undefined;
  let myId: unknown;
  if (target.weak_login) {
    const loginPath = findLogin(repo.routes) ?? '/api/auth/login';
    const res = await http.post(loginPath, { email: target.weak_login.email, password: target.weak_login.password });
    token = (res.json as any)?.token;
    const p = token ? decodeJwt(token) : null;
    myId = p?.sub ?? p?.id ?? (res.json as any)?.user?.id;
  }

  await idor();
  await sqli();
  await rateLimit();
  await missingAuthz();
  await openRedirect();
  return out;

  // ---- IDOR: rutas con param de id bajo auth → ¿una identidad ve dueños distintos?
  async function idor() {
    if (!token) return;
    const routes = repo.routes.filter((r) => r.method === 'GET' && (r.params ?? []).some((p) => ID_PARAM.test(p)) && r.auth !== 'admin');
    for (const r of routes) {
      const owners = new Set<unknown>();
      let seen = 0;
      for (let id = 1; id <= 10; id++) {
        const path = fillParam(r.path, id);
        const res = await http.get(path, { token });
        if (res.status !== 200 || !res.json || typeof res.json !== 'object') continue;
        seen++;
        const ownerKey = OWNER_KEYS.find((k) => k in (res.json as any));
        if (ownerKey) owners.add((res.json as any)[ownerKey]);
      }
      const confirmed = owners.size > 1; // una identidad accede a recursos de >1 dueño
      if (confirmed || seen > 0) {
        out.push({ vuln_class: 'idor', confirmed, where: refOf(r), source: 'generic',
          evidence: confirmed ? `${r.method} ${r.path}: una identidad vio ${owners.size} dueños distintos (${[...owners].join(',')})` : `${r.path}: sin acceso cruzado detectado` });
        if (confirmed) { log(`  [A] idor confirmado en ${r.path}`); break; }
      }
    }
  }

  // ---- SQLi error-based: parámetros de query + comilla → error de SQL reflejado.
  async function sqli() {
    const sig = repo.signals.find((s) => s.kind === 'raw-sql');
    const getRoutes = repo.routes.filter((r) => r.method === 'GET' && !(r.params ?? []).length);
    for (const r of getRoutes.slice(0, 8)) {
      for (const param of SQL_PARAMS) {
        const res = await http.get(`${r.path}?${param}=${encodeURIComponent("'")}`, token ? { token } : {});
        const errored = res.status >= 500 || SQL_ERR.test(res.text);
        if (errored) {
          out.push({ vuln_class: 'sql-injection', confirmed: true, where: sig ? refSig(sig) : `${r.path}?${param}`, source: 'generic',
            evidence: `${r.path}?${param}=' → HTTP ${res.status} con error SQL reflejado (inyectable)` });
          log(`  [A] sql-injection confirmado en ${r.path}?${param}`);
          return;
        }
      }
    }
  }

  // ---- Fuerza bruta: login sin rate limit (ráfaga sin 429).
  async function rateLimit() {
    const loginPath = findLogin(repo.routes);
    if (!loginPath) return;
    let blocked = false;
    for (let i = 0; i < 10; i++) {
      const res = await http.post(loginPath, { email: `nobody${i}@x.com`, password: `wrong${i}` });
      if (res.status === 429) { blocked = true; break; }
    }
    out.push({ vuln_class: 'weak-password-no-rate-limit', confirmed: !blocked, where: `POST ${loginPath}`, source: 'generic',
      evidence: blocked ? 'el login aplicó rate limit (429)' : '10 intentos fallidos sin una sola respuesta 429 (sin rate limit)' });
    if (!blocked) log(`  [A] sin rate limit en ${loginPath}`);
  }

  // ---- Missing authz: ruta /admin alcanzable por un usuario de baja privilegia.
  async function missingAuthz() {
    if (!token) return;
    const admin = repo.routes.filter((r) => r.method === 'GET' && /\/admin/.test(r.path) && (r.params ?? []).length === 0);
    for (const r of admin) {
      const res = await http.get(r.path, { token });
      if (res.status === 200) {
        out.push({ vuln_class: 'admin-endpoint-no-authz', confirmed: true, where: refOf(r), source: 'generic',
          evidence: `${r.path} respondió 200 a un usuario de baja privilegia (falta requireAdmin)` });
        log(`  [A] missing-authz en ${r.path}`);
        break;
      }
    }
  }

  // ---- Open redirect: ruta con param de redirección → URL externa.
  async function openRedirect() {
    const evil = 'https://evil.example/x';
    const routes = repo.routes.filter((r) => r.method === 'GET');
    for (const r of routes) {
      for (const param of REDIRECT_PARAMS) {
        const res = await http.get(`${r.path}?${param}=${encodeURIComponent(evil)}`, { noRedirect: true, ...(token ? { token } : {}) });
        if (res.status >= 300 && res.status < 400 && res.headers['location'] === evil) {
          out.push({ vuln_class: 'open-redirect', confirmed: true, where: refOf(r), source: 'generic',
            evidence: `${r.path}?${param}= redirige a ${evil}` });
          log(`  [A] open-redirect en ${r.path}`);
          return;
        }
      }
    }
  }
}

function findLogin(routes: RouteDef[]): string | undefined {
  return routes.find((r) => r.method === 'POST' && /(log|sign)[-_]?in|\/auth\/login|\/sessions?$|\/login$/.test(r.path))?.path;
}
function fillParam(path: string, id: number): string {
  return path.replace(/:[A-Za-z_]\w*|\{[A-Za-z_]\w*\}|<[A-Za-z_]\w*>/, String(id));
}
function refOf(r: RouteDef): string {
  return r.ref.line ? `${r.ref.file}:${r.ref.line}` : r.ref.file;
}
function refSig(s: { ref: { file: string; line?: number } }): string {
  return s.ref.line ? `${s.ref.file}:${s.ref.line}` : s.ref.file;
}
