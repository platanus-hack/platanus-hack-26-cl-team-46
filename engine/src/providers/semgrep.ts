/**
 * Adapter de semgrep (SAST) — fuente externa APROBADA (provenance). Corre semgrep
 * sobre el repo y parsea los hallazgos. No necesita target vivo.
 *
 * Dos modos (auto-detectados), para funcionar en local Y en los contenedores de
 * deploy (Modal/Render), que NO tienen Docker-in-Docker:
 *  - binario: si `semgrep` está en el PATH (horneado en la imagen) → lo corre directo.
 *  - docker:  si no, usa la imagen oficial pinneada vía `docker run` (dev local).
 *
 * child_process aquí es código de primera mano y confiable (el gate de I/O
 * peligroso aplica a artefactos GENERADOS por el LLM, no a este adapter).
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { requireApproved } from './provenance.ts';
import type { ExternalFinding } from './external.ts';

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return reject(err);
      resolve(stdout);
    });
  });
}

async function hasBinary(cmd: string): Promise<boolean> {
  try {
    await run('sh', ['-lc', `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
}

export async function runSemgrep(repoPath: string, opts: { config?: string } = {}): Promise<ExternalFinding[]> {
  const prov = requireApproved('semgrep'); // lanza si no aprobado
  // 'auto' usa el set recomendado del registry (requiere red). p/security-audit
  // resultó demasiado estrecho (0 reglas útiles) en la validación.
  const config = opts.config ?? 'auto';
  const abs = path.resolve(repoPath);

  let out: string;
  let scanRoot: string;
  if (await hasBinary('semgrep')) {
    // Binario horneado en la imagen (Modal/Render) o instalado local.
    scanRoot = abs;
    out = await run('semgrep', ['--config', config, '--json', '--quiet', abs]);
  } else {
    // Fallback: imagen oficial pinneada vía Docker (dev local con daemon).
    scanRoot = '/src';
    const image = `semgrep/semgrep:${prov.pinned ?? 'latest'}`;
    out = await run('docker', ['run', '--rm', '-v', `${abs}:/src:ro`, image, 'semgrep', '--config', config, '--json', '--quiet', '/src']);
  }

  let data: any;
  try {
    data = JSON.parse(out);
  } catch {
    return [];
  }
  const prefix = scanRoot.replace(/\/?$/, '/');
  return (data.results ?? []).map((r: any) => ({
    tool: 'semgrep',
    kind: r.check_id ?? 'semgrep',
    detail: r.extra?.message ?? '',
    ref: `${String(r.path).replace(prefix, '')}:${r.start?.line ?? ''}`,
  }));
}
