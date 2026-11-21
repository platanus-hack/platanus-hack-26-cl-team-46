/**
 * Adapter de semgrep (SAST) — fuente externa APROBADA (provenance). Corre la
 * imagen oficial pinneada en Docker, read-only sobre el repo, y parsea los
 * hallazgos. No necesita target vivo. Si la fuente no está aprobada, no corre.
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

export async function runSemgrep(repoPath: string, opts: { config?: string } = {}): Promise<ExternalFinding[]> {
  const prov = requireApproved('semgrep'); // lanza si no aprobado
  const image = `semgrep/semgrep:${prov.pinned ?? 'latest'}`;
  const config = opts.config ?? 'p/security-audit';
  const abs = path.resolve(repoPath);
  const out = await run('docker', [
    'run', '--rm', '-v', `${abs}:/src:ro`, image,
    'semgrep', '--config', config, '--json', '--quiet', '/src',
  ]);
  let data: any;
  try {
    data = JSON.parse(out);
  } catch {
    return [];
  }
  return (data.results ?? []).map((r: any) => ({
    tool: 'semgrep',
    kind: r.check_id ?? 'semgrep',
    detail: r.extra?.message ?? '',
    ref: `${r.path}:${r.start?.line ?? ''}`,
  }));
}
