/**
 * Gate de ejecución para artefactos generados (requisito C). Sin excepción, un
 * artefacto generado debe pasar: (1) schema, (2) scope guard estático (no URLs
 * fuera de scope, no I/O arbitrario), (3) sandbox/tests. Si no pasa, NO se
 * ejecuta. El checkpoint de supervisión con Sebastián es adicional al gate.
 */
import type { GeneratedArtifact } from './types.ts';

export interface GateResult {
  ok: boolean;
  checks: Array<{ name: string; pass: boolean; detail?: string }>;
}

// APIs peligrosas que un módulo de ataque NO debería tocar (ejecución libre).
const DANGEROUS = [
  /\bchild_process\b/, /\brequire\(\s*['"]fs['"]/, /\bimport\s+.*['"]node:fs['"]/,
  /\beval\s*\(/, /\bFunction\s*\(/, /\bprocess\.env\b/, /\bexeca?\b/, /\bspawn\b/,
  /\bwriteFile|unlink|rmdir|rm\b/,
];

function schemaCheck(a: GeneratedArtifact): { pass: boolean; detail?: string } {
  if (!a.id || !a.kind) return { pass: false, detail: 'falta id/kind' };
  if (a.kind === 'attack-module' && !a.code) return { pass: false, detail: 'attack-module sin code' };
  if (!a.provenance?.createdAt) return { pass: false, detail: 'sin provenance' };
  return { pass: true };
}

/** Scope estático: las URLs en el código deben estar dentro del scope autorizado. */
function scopeCheck(code: string, scopeOrigins: string[]): { pass: boolean; detail?: string } {
  const urls = [...code.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0]);
  for (const u of urls) {
    let origin: string;
    try {
      origin = new URL(u).origin;
    } catch {
      continue;
    }
    if (!scopeOrigins.includes(origin)) return { pass: false, detail: `URL fuera de scope: ${u}` };
  }
  return { pass: true };
}

function dangerCheck(code: string): { pass: boolean; detail?: string } {
  for (const re of DANGEROUS) if (re.test(code)) return { pass: false, detail: `uso peligroso: ${re}` };
  return { pass: true };
}

/**
 * Valida un artefacto. `sandbox` es el hook que corre sus tests contra un
 * fixture (inyectado por el caller); si no se provee, el check queda pendiente
 * y el gate NO aprueba la ejecución.
 */
export async function gateArtifact(
  a: GeneratedArtifact,
  scopeOrigins: string[],
  sandbox?: (a: GeneratedArtifact) => Promise<boolean>,
): Promise<GateResult> {
  const checks: GateResult['checks'] = [];
  const s = schemaCheck(a);
  checks.push({ name: 'schema', pass: s.pass, detail: s.detail });

  const code = a.code ?? '';
  const sc = scopeCheck(code, scopeOrigins);
  checks.push({ name: 'scope', pass: sc.pass, detail: sc.detail });
  const dc = dangerCheck(code);
  checks.push({ name: 'no-dangerous-io', pass: dc.pass, detail: dc.detail });

  let sandboxPass = false;
  if (sandbox) {
    try {
      sandboxPass = await sandbox(a);
    } catch (e) {
      sandboxPass = false;
    }
    checks.push({ name: 'sandbox-tests', pass: sandboxPass });
  } else {
    checks.push({ name: 'sandbox-tests', pass: false, detail: 'sin sandbox: ejecución NO aprobada' });
  }

  return { ok: checks.every((c) => c.pass), checks };
}
