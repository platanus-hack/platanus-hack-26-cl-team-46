/** Señales de vulnerabilidad por patrón (grep/AST ligero), con archivo/línea. */
import type { ScannedFile, SignalDef } from './types.ts';

// Palabra clave SQL como texto de la sentencia, no como método (hmac.update(`…${x}`), qb.where(…)).
const SQL_KEYWORDS = /(?<![.\w$])(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|FROM|WHERE|ILIKE|LIKE)\b(?!\s*\()/i;

function push(sigs: SignalDef[], kind: SignalDef['kind'], detail: string, file: string, line: number, commit: string) {
  sigs.push({ kind, detail, ref: { file, line: line + 1, commit } });
}

export function extractSignals(files: ScannedFile[], commit: string): SignalDef[] {
  const sigs: SignalDef[] = [];
  for (const f of files) {
    const isCode = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/.test(f.rel);
    const isView = /\.(ejs|html)$/.test(f.rel) || f.rel.endsWith('.py') || /\.(ts|js)x?$/.test(f.rel);
    f.lines.forEach((line, i) => {
      // SQL cruda: interpolación dentro de una sentencia SQL.
      if (SQL_KEYWORDS.test(line) && (/\$\{[^}]+\}/.test(line) || /f["'][^"']*\{[^}]+\}/.test(line) || /["'`]\s*\+\s*\w/.test(line))) {
        push(sigs, 'raw-sql', 'Interpolación de input en una sentencia SQL (posible SQLi).', f.rel, i, commit);
      }
      // Render sin escapar.
      if (/<%-(?!\s*include\b)/.test(line) || /dangerouslySetInnerHTML/.test(line) || /render_template_string/.test(line) || /\|\s*safe\b/.test(line)) {
        push(sigs, 'unescaped-render', 'Contenido renderizado sin escapar (posible XSS).', f.rel, i, commit);
      }
      // Secreto hardcodeado (excepto .example).
      if (!/\.example$/.test(f.rel) && /\b(SECRET|API_KEY|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN)\b\s*[:=]\s*['"][^'"]{6,}['"]/i.test(line) && !/process\.env|os\.environ|getenv/i.test(line)) {
        push(sigs, 'hardcoded-secret', 'Posible secreto embebido en el código.', f.rel, i, commit);
      }
      // JWT de vida larga / HS256.
      if (/expiresIn\s*:\s*['"]?\d+\s*d/i.test(line) || /JWT_EXPIRES?_IN/.test(line)) {
        push(sigs, 'weak-jwt', 'JWT con expiración larga (si se roba, persiste).', f.rel, i, commit);
      }
      // Mass assignment: update con el body completo / lista con role.
      if (/updateUser\([^)]*req\.body|set\(\*\*request|\.update\(req\.body|USER_COLUMNS[\s\S]*role/i.test(line)) {
        push(sigs, 'mass-assignment', 'Actualización con campos controlados por el usuario (posible mass assignment).', f.rel, i, commit);
      }
      // Errores verbosos: devolver stack/detail al cliente.
      if (/res\.(json|send)\([^)]*(stack|err\.detail|error\.stack)/i.test(line) || /\b(detail|hint|position)\b[\s\S]*err/.test(line)) {
        push(sigs, 'verbose-errors', 'Posible fuga de detalle de errores al cliente.', f.rel, i, commit);
      }
      void isCode; void isView;
    });
  }
  return sigs;
}
