/**
 * Rutas de más frameworks (NestJS, FastAPI, Next.js) y prefijos de montaje.
 * Complementa routes.ts (Express/Flask) para que el plugin genérico encuentre la
 * superficie de cualquier app, no solo de las víctimas con plugin propio.
 */
import type { RouteDef, ScannedFile } from './types.ts';

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const HTTP_DECORATORS = /@(Get|Post|Put|Patch|Delete|All)\(\s*(?:(['"`])([^'"`]*)\2)?\s*\)/;
const CONTROLLER_RE = /@Controller\(\s*(?:(['"`])([^'"`]*)\1|\{[^}]*path\s*:\s*(['"`])([^'"`]*)\3[^}]*\})?\s*\)/;

function join(...parts: string[]): string {
  const p = parts
    .map((s) => s.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return `/${p}`;
}

function colonParams(p: string): string[] {
  return [...p.matchAll(/:(\w+)/g)].map((m) => m[1]);
}

function nestAuth(lines: string[], from: number, to: number): string | undefined {
  const block = lines.slice(Math.max(0, from), to + 1).join(' ');
  if (/@Public\(\)/.test(block)) return 'none';
  if (/Roles\([^)]*admin|AdminGuard|@Admin\(\)/i.test(block)) return 'admin';
  if (/@UseGuards\(|AuthGuard|JwtGuard|@Auth\(\)/.test(block)) return 'user';
  return undefined;
}

/** NestJS: @Controller('notes') + @Get(':id') → GET /notes/:id (sin el prefijo global). */
export function extractNestRoutes(files: ScannedFile[], commit: string): RouteDef[] {
  const routes: RouteDef[] = [];
  for (const f of files) {
    if (!CODE_RE.test(f.rel) || !f.lines.some((l) => l.includes('@Controller('))) continue;
    let base = '';
    let classAuth: string | undefined;
    let classLine = 0;
    f.lines.forEach((line, i) => {
      const c = CONTROLLER_RE.exec(line);
      if (c) {
        base = c[2] ?? c[4] ?? '';
        classLine = i;
        classAuth = nestAuth(f.lines, i - 4, i);
        return;
      }
      const m = HTTP_DECORATORS.exec(line);
      if (!m) return;
      const method = m[1] === 'All' ? 'ALL' : m[1].toUpperCase();
      const p = join(base, m[3] ?? '');
      // Guards del método (decoradores contiguos) y de la clase.
      let start = i;
      while (start > classLine + 1 && /^\s*@/.test(f.lines[start - 1] ?? '')) start--;
      let end = i;
      while (end + 1 < f.lines.length && /^\s*@/.test(f.lines[end + 1] ?? '')) end++;
      const auth = nestAuth(f.lines, start, end) ?? classAuth;
      routes.push({ method, path: p, ref: { file: f.rel, line: i + 1, commit }, auth, params: colonParams(p), source: 'nest' });
    });
  }
  return routes;
}

const FASTAPI_RE = /@([A-Za-z_]\w*)\.(get|post|put|patch|delete)\(\s*(['"])([^'"]*)\3/;
const ROUTER_PREFIX_RE = /([A-Za-z_]\w*)\s*=\s*APIRouter\([^)]*prefix\s*=\s*(['"])([^'"]*)\2/;

/** FastAPI: @app.get('/items/{id}') y @router.get con APIRouter(prefix=...). */
export function extractFastapiRoutes(files: ScannedFile[], commit: string): RouteDef[] {
  const routes: RouteDef[] = [];
  for (const f of files) {
    if (!f.rel.endsWith('.py')) continue;
    const prefixes: Record<string, string> = {};
    for (const l of f.lines) {
      const r = ROUTER_PREFIX_RE.exec(l);
      if (r) prefixes[r[1]] = r[3];
    }
    f.lines.forEach((line, i) => {
      const m = FASTAPI_RE.exec(line);
      if (!m) return;
      const p = join(prefixes[m[1]] ?? '', m[4]);
      const sig = [line, f.lines[i + 1] ?? '', f.lines[i + 2] ?? ''].join(' ');
      const auth = /Depends\([^)]*(admin)/i.test(sig) ? 'admin' : /Depends\([^)]*(user|auth|token|login)/i.test(sig) ? 'user' : undefined;
      routes.push({
        method: m[2].toUpperCase(),
        path: p,
        ref: { file: f.rel, line: i + 1, commit },
        auth,
        params: [...p.matchAll(/\{(\w+)\}/g)].map((x) => x[1]),
        source: 'fastapi',
      });
    });
  }
  return routes;
}

/** Next.js: app/api/**\/route.ts (export GET/POST…) y pages/api/**. */
export function extractNextRoutes(files: ScannedFile[], commit: string): RouteDef[] {
  const routes: RouteDef[] = [];
  for (const f of files) {
    const rel = f.rel.replace(/\\/g, '/');
    const app = /(?:^|\/)app\/(api\/.*?)\/route\.(ts|js|tsx|jsx)$/.exec(rel);
    const pages = /(?:^|\/)pages\/(api\/.*?)\.(ts|js|tsx|jsx)$/.exec(rel);
    const seg = app?.[1] ?? pages?.[1];
    if (!seg) continue;
    const p = `/${seg.replace(/\/index$/, '')}`
      .replace(/\[\.\.\.(\w+)\]/g, ':$1')
      .replace(/\[(\w+)\]/g, ':$1')
      .replace(/\/\([^)]+\)/g, '');
    if (app) {
      f.lines.forEach((line, i) => {
        const m = /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/.exec(line);
        if (m) routes.push({ method: m[1], path: p, ref: { file: f.rel, line: i + 1, commit }, params: colonParams(p), source: 'next' });
      });
    } else {
      routes.push({ method: 'GET', path: p, ref: { file: f.rel, line: 1, commit }, params: colonParams(p), source: 'next' });
      routes.push({ method: 'POST', path: p, ref: { file: f.rel, line: 1, commit }, params: colonParams(p), source: 'next' });
    }
  }
  return routes;
}

/**
 * Prefijos de montaje: setGlobalPrefix('api') de Nest, app.use('/api/x', router)
 * de Express, Blueprint(url_prefix=) de Flask e include_router(prefix=) de FastAPI.
 * El plugin genérico los prueba en vivo para resolver la ruta real.
 */
export function extractMountPrefixes(files: ScannedFile[]): string[] {
  const out = new Set<string>();
  const res = [
    /setGlobalPrefix\(\s*(['"`])([^'"`]+)\1/,
    /\.use\(\s*(['"`])(\/[^'"`]*)\1\s*,/,
    /url_prefix\s*=\s*(['"])([^'"]+)\1/,
    /include_router\([^)]*prefix\s*=\s*(['"])([^'"]+)\1/,
  ];
  for (const f of files) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(f.rel)) continue;
    for (const line of f.lines) {
      for (const re of res) {
        const m = re.exec(line);
        if (m && !m[2].includes('*') && m[2].length < 60) out.add(join(m[2]));
      }
    }
  }
  out.delete('/');
  return [...out];
}
