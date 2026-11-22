/**
 * CLI del camino dual A+B. Corre las sondas genéricas (A) y los ángulos del LLM
 * (B) en paralelo sobre el mismo target+repo, y produce la matriz de cobertura
 * (comparación + completitud). Sirve para apps arbitrarias (A deriva del repo).
 *
 *   node src/cli/dual.ts --url <app> --repo <ruta> [--weak-email .. --weak-pass ..] [--providers] [--seed s]
 *
 * B usa el MockProvider ($0, offline) por defecto; con --providers y las keys,
 * usa la cascada LLM (Sonnet 4.5 → DeepSeek → GLM).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCascadeFromEnv } from '../providers/cascade.ts';
import { MockProvider } from '../providers/mock.ts';
import { discoverRepo } from '../discovery/index.ts';
import { runDualPath } from '../dual/index.ts';
import type { TargetConfig } from '../core/types.ts';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  if (flag('help') || process.argv.includes('-h')) {
    console.log('Uso: node src/cli/dual.ts --url <app> --repo <ruta> [--weak-email .. --weak-pass ..] [--providers] [--seed s]');
    return;
  }
  const url = arg('url');
  const repoPath = arg('repo');
  if (!url || !repoPath) {
    console.error('❌ Faltan --url y --repo (el camino genérico A deriva del RepoModel).');
    process.exit(2);
  }
  const weakEmail = arg('weak-email');
  const weakPass = arg('weak-pass');
  const seed = arg('seed', 'dual');
  const parsed = new URL(url);

  const target: TargetConfig = {
    url: url.replace(/\/$/, ''),
    seed_users: weakEmail && weakPass ? [{ email: weakEmail, password: weakPass, role: 'user' }] : [],
    weak_login: weakEmail && weakPass ? { email: weakEmail, password: weakPass } : undefined,
  };

  console.log(`\n🔀 Dual A+B → ${target.url}  (scope: ${parsed.origin})\n`);
  const repo = await discoverRepo(path.resolve(repoPath), { commit: arg('commit') });
  console.log(`▶ discovery: ${repo.routes.length} rutas, ${repo.signals.length} señales`);

  // B: cascada si se pide y hay keys; si no, mock offline.
  const cascade = flag('providers') ? buildCascadeFromEnv(process.env) : undefined;
  const provider = cascade ?? new MockProvider();

  const dual = await runDualPath(target, repo, { provider, seed, log: (m) => console.log(m) });

  const outDir = path.resolve(import.meta.dirname, '../../out', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'dual.json'), JSON.stringify(dual, null, 2));

  console.log('\n──── Cobertura (A genérico ∥ B LLM) ────');
  console.log('clase                         A   B   estado');
  for (const e of dual.coverage.entries) {
    console.log(`${e.vuln_class.padEnd(28)}  ${e.generic_confirmed ? '✓' : '·'}   ${e.llm_proposed ? '✓' : '·'}   ${e.status}`);
  }
  const m = dual.coverage.metrics;
  console.log(`\nacuerdo ${m.agreement} · solo-A ${m.generic_only} · solo-B ${m.llm_only} · unión ${dual.coverage.unified.length}`);
  console.log(`\n📁 ${outDir}\n`);
}

main().catch((e) => {
  console.error('\n❌ Error:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
