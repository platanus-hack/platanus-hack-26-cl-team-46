/**
 * Analizador de deploy/CICD sospechoso. Revisa los workflows del repo buscando
 * caminos de envenenamiento del pipeline (permisos de más, pull_request_target,
 * inyección de expresiones, exposición de secrets), con archivo/línea. Es
 * análisis read-only sobre el repo; no toca registries de terceros.
 */
import { scanRepo } from '../../discovery/scan.ts';

export interface CicdFinding {
  kind: 'excessive-permissions' | 'pr-target' | 'expression-injection' | 'secret-exposure';
  detail: string;
  ref: { file: string; line: number; commit: string };
}

export async function analyzeCicd(repoPath: string, commit = 'working-tree'): Promise<CicdFinding[]> {
  const files = (await scanRepo(repoPath)).filter((f) => /\.github\/workflows\/.*\.ya?ml$/.test(f.rel));
  const out: CicdFinding[] = [];
  for (const f of files) {
    f.lines.forEach((line, i) => {
      const ref = { file: f.rel, line: i + 1, commit };
      if (/permissions:\s*write-all/.test(line) || /\bcontents:\s*write/.test(line) || /\bid-token:\s*write/.test(line)) {
        out.push({ kind: 'excessive-permissions', detail: 'Workflow con permisos de escritura amplios (riesgo si se compromete).', ref });
      }
      if (/pull_request_target/.test(line)) {
        out.push({ kind: 'pr-target', detail: 'pull_request_target corre con secrets; peligroso si hace checkout del código del PR no confiable.', ref });
      }
      if (/\$\{\{\s*github\.event\./.test(line)) {
        out.push({ kind: 'expression-injection', detail: 'Interpolación de github.event.* (controlable por un atacante) en el workflow: inyección de expresión/script.', ref });
      }
      if (/echo[^#]*\$\{\{\s*secrets\./i.test(line) || /run:[^#]*secrets\.[A-Z]/.test(line)) {
        out.push({ kind: 'secret-exposure', detail: 'Secret potencialmente expuesto/impreso en un paso run.', ref });
      }
    });
  }
  return out;
}
