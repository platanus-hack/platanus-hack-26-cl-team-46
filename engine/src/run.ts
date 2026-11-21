/**
 * CLI del motor de hacking.
 *
 * Uso:
 *   node engine/src/run.ts --url https://sbx-xxxx.onrender.com \
 *        [--weak-email a@b.com --weak-pass pass] [--only idor,sql-injection] \
 *        [--out engine/out]
 *
 * Solo ataca el --url indicado (target autorizado). Escribe:
 *   out/<ts>/diagnosis.json      diagnóstico completo con evidencia
 *   out/<ts>/attack-plan.json    plan en el contrato del backend
 *   out/<ts>/telemetry.json      toda la telemetría HTTP capturada
 *   out/<ts>/scenarios/*.json    escenarios preconfigurados (uno por vuln)
 *   out/<ts>/GUIA-DEL-HACKEO.md  guía enseñable paso a paso
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { diagnose } from './diagnose.ts';
import { buildAttackPlan } from './events.ts';
import { recon } from './recon.ts';
import { renderGuide } from './report.ts';
import { buildScenarioPack } from './scenario.ts';
import type { TargetConfig } from './types.ts';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const url = arg('url', process.env.TARGET_URL ?? 'https://sbx-8e92f100.onrender.com');
  if (!url) throw new Error('falta --url o TARGET_URL');

  // Credencial débil conocida para la demo de fuerza bruta (de docs/victim/ANSWER_KEY.md).
  const weakEmail = arg('weak-email', 'martin.soto@example.com');
  const weakPass = arg('weak-pass', 'qwerty123');

  const only = arg('only')?.split(',').map((s) => s.trim());
  const profile = arg('profile', 'fast') as 'noisy' | 'normal' | 'fast' | 'stealth';
  const outRoot = arg('out', path.resolve(import.meta.dirname, '../out'));

  const target: TargetConfig = {
    url: url.replace(/\/$/, ''),
    commit: arg('commit'),
    seed_users: [{ email: weakEmail!, password: weakPass!, role: 'user' }],
    weak_login: weakEmail && weakPass ? { email: weakEmail, password: weakPass } : undefined,
  };

  console.log(`\n🎯 Motor de hacking → ${target.url}`);
  console.log(`   (solo se ataca este target autorizado)\n`);

  // Fase 1: recon (superficie de ataque). Se puede saltar con --no-recon.
  const reconReport = process.argv.includes('--no-recon') ? undefined : await recon(target, { log: (m) => console.log(m) });

  // Fase 2: explotación real.
  const diag = await diagnose(target, { only, profile, log: (m) => console.log(m) });

  const scenarios = buildScenarioPack(diag);
  const plan = buildAttackPlan(diag, reconReport);
  const guide = renderGuide(diag, scenarios, reconReport);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(outRoot!, ts);
  await mkdir(path.join(outDir, 'scenarios'), { recursive: true });

  await writeFile(path.join(outDir, 'diagnosis.json'), JSON.stringify({ ...diag, telemetry: undefined }, null, 2));
  await writeFile(path.join(outDir, 'telemetry.json'), JSON.stringify(diag.telemetry, null, 2));
  if (reconReport) await writeFile(path.join(outDir, 'recon.json'), JSON.stringify(reconReport, null, 2));
  await writeFile(path.join(outDir, 'attack-plan.json'), JSON.stringify(plan, null, 2));
  await writeFile(path.join(outDir, 'GUIA-DEL-HACKEO.md'), guide);
  for (const sc of scenarios) {
    await writeFile(path.join(outDir, 'scenarios', `${sc.vuln_id}.json`), JSON.stringify(sc, null, 2));
  }

  // Copia "latest" para el consumo del simulador.
  const latest = path.join(outRoot!, 'latest');
  await mkdir(path.join(latest, 'scenarios'), { recursive: true });
  await writeFile(path.join(latest, 'GUIA-DEL-HACKEO.md'), guide);
  await writeFile(path.join(latest, 'attack-plan.json'), JSON.stringify(plan, null, 2));
  for (const sc of scenarios) {
    await writeFile(path.join(latest, 'scenarios', `${sc.vuln_id}.json`), JSON.stringify(sc, null, 2));
  }

  console.log('\n────────────────────────────────────────');
  console.log(`✅ ${diag.summary.confirmed}/${diag.summary.total} vulnerabilidades confirmadas  (perfil: ${diag.profile}, ${(diag.duration_ms / 1000).toFixed(1)}s)`);
  console.log(`   bloqueadas: ${diag.summary.blocked} · errores: ${diag.summary.errored}`);
  console.log(`   atacante activo al cierre: ${diag.summary.attacker_active ? 'sí' : 'no'}`);
  console.log(`   requests capturados: ${diag.summary.requests}`);
  console.log(`   escenarios generados: ${scenarios.length}`);
  console.log(`\n📁 ${outDir}`);
  console.log(`📄 ${path.join(outDir, 'GUIA-DEL-HACKEO.md')}\n`);
}

main().catch((e) => {
  console.error('\n❌ Error:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
