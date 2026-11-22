/** Extrae rutas de código Express (JS/TS) y Flask (Python). */
import type { RouteDef, ScannedFile } from './types.ts';

const EXPRESS_RE = /\b(?:app|router|[A-Za-z_]\w*[Rr]outer|[A-Za-z_]\w*)\.(get|post|put|patch|delete|all)\s*\(\s*(['"`])([^'"`]+)\2/;
const FLASK_RE = /@[A-Za-z_][\w.]*\.route\s*\(\s*(['"])([^'"]+)\1(?:[^)]*methods\s*=\s*\[([^\]]*)\])?/;

function expressParams(p: string): string[] {
  return [...p.matchAll(/:(\w+)/g)].map((m) => m[1]);
}
function braceParams(p: string): string[] {
  return [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

function inferAuth(line: string): string | undefined {
  if (/requireAdmin|is_admin|admin_required/i.test(line)) return 'admin';
  if (/requireAuth|requireLogin|login_required|@jwt_required|authenticate/i.test(line)) return 'user';
  return undefined;
}

/** Chequeo de rol dentro del handler, al comienzo (`if (req.user.role !== 'admin') return 403`). */
function inlineAdminCheck(lines: string[]): 'admin' | undefined {
  return lines.some((l) => /\brole\s*[!=]==?\s*['"]admin['"]|\bisAdmin\b/.test(l)) ? 'admin' : undefined;
}

export function extractExpressRoutes(files: ScannedFile[], commit: string): RouteDef[] {
  const routes: RouteDef[] = [];
  for (const f of files) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f.rel)) continue;
    f.lines.forEach((line, i) => {
      const m = EXPRESS_RE.exec(line);
      if (!m) return;
      const method = m[1].toUpperCase();
      const p = m[3];
      if (!p.startsWith('/')) return;
      routes.push({
        method,
        path: p,
        ref: { file: f.rel, line: i + 1, commit },
        // El chequeo de rol en el handler manda: requireLogin + `role !== 'admin'` es una ruta de admin.
        auth: inlineAdminCheck(f.lines.slice(i + 1, i + 5)) ?? inferAuth(line),
        params: expressParams(p),
        source: 'express',
      });
    });
  }
  return routes;
}

export function extractFlaskRoutes(files: ScannedFile[], commit: string): RouteDef[] {
  const routes: RouteDef[] = [];
  for (const f of files) {
    if (!f.rel.endsWith('.py')) continue;
    f.lines.forEach((line, i) => {
      const m = FLASK_RE.exec(line);
      if (!m) return;
      const p = m[2];
      if (!p.startsWith('/')) return;
      const methods = m[3]
        ? m[3].split(',').map((s) => s.replace(/['"\s]/g, '').toUpperCase()).filter(Boolean)
        : ['GET'];
      // Auth: decorador en la línea anterior o la siguiente función.
      const nearby = [f.lines[i - 1] ?? '', f.lines[i + 1] ?? '', line].join(' ');
      for (const method of methods) {
        routes.push({
          method,
          path: p,
          ref: { file: f.rel, line: i + 1, commit },
          auth: inferAuth(nearby),
          params: braceParams(p),
          source: 'flask',
        });
      }
    });
  }
  return routes;
}
