/**
 * CLI del motor de hacking.
 *
 * SEGURIDAD: no hay target ni credenciales por defecto. `--url` es obligatorio y
 * `--help` no tiene efectos secundarios (no dispara ningún request). El cliente
 * HTTP aplica scope guard: solo se ataca el host de `--url`.
 *
 * Uso:
 *   node engine/src/run.ts --url https://sbx-xxxx.onrender.com [opciones]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { diagnose } from '../core/diagnose.ts';
import { buildAttackPlan } from '../core/events.ts';
import { recon } from '../core/recon.ts';
import { renderGuide } from '../core/report.ts';
import { buildScenarioPack } from '../core/scenario.ts';
import type { TargetConfig } from '../core/types.ts';
import { apuntesPlugin } from '../plugins/apuntes/index.ts';

// Plugin activo. En el futuro se seleccionará según el repo del EngagementSpec.
const plugin = apuntesPlugin;

const HELP = `Motor de hacking — diagnóstico real contra una app controlada y autorizada.

Uso:
  node src/run.ts --url <https://host> [opciones]

Obligatorio:
  --url <url>            Target autorizado. SOLO se ataca este host (scope guard).

Opciones:
  --profile <p>         noisy | normal | fast | stealth        (default: fast)
  --seed <s>            Semilla para reproducibilidad            (default: "default")
  --read-only           Correr solo módulos no mutantes (no crea/modifica estado)
  --only <ids>          CSV de vuln_id a correr (p. ej. idor,sql-injection)
  --weak-email <email>  Credencial conocida para fuerza bruta / sesión de baja privilegia
  --weak-pass <pass>    (ambos juntos; sin default, específico de la app)
  --commit <sha>        Commit del target, para versionar el escenario
  --no-recon            Saltar la fase de reconocimiento
  --out <dir>           Carpeta de salida                        (default: engine/out)
  --help, -h            Mostrar esta ayuda (sin efectos secundarios)

Ejemplo (app víctima Apuntes):
  node src/run.ts --url https://sbx-xxxx.onrender.com \\
    --weak-email martin.soto@example.com --weak-pass qwerty123 --seed demo-1
`;

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  // --help NO dispara nada.
  if (flag('help') || process.argv.includes('-h')) {
    console.log(HELP);
    return;
  }

  const url = arg('url');
  if (!url) {
    console.error('❌ Falta --url (obligatorio). No hay target por defecto.\n');
    console.error(HELP);
    process.exit(2);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('protocolo');
  } catch {
    console.error(`❌ --url inválida: ${url}`);
    process.exit(2);
  }

  const weakEmail = arg('weak-email');
  const weakPass = arg('weak-pass');
  const only = arg('only')?.split(',').map((s) => s.trim());
  const profile = (arg('profile', 'fast') ?? 'fast') as 'noisy' | 'normal' | 'fast' | 'stealth';
  const seed = arg('seed', 'default')!;
  const readOnly = flag('read-only');
  const outRoot = arg('out', path.resolve(import.meta.dirname, '../../out'))!;

  const target: TargetConfig = {
    url: url.replace(/\/$/, ''),
    commit: arg('commit'),
    seed_users: weakEmail && weakPass ? [{ email: weakEmail, password: weakPass, role: 'user' }] : [],
    weak_login: weakEmail && weakPass ? { email: weakEmail, password: weakPass } : undefined,
  };

  console.log(`\n🎯 Motor de hacking → ${target.url}  (scope: ${parsed.origin})`);
  console.log(`   solo se ataca este host autorizado · perfil ${profile} · seed ${seed}${readOnly ? ' · read-only' : ''}\n`);

  const reconReport = flag('no-recon') ? undefined : await recon(target, plugin.reconCandidates, { seed, log: (m) => console.log(m) });
  const diag = await diagnose(target, plugin, { only, profile, seed, readOnly, log: (m) => console.log(m) });

  const scenarios = buildScenarioPack(diag, plugin);
  const plan = buildAttackPlan(diag, plugin, reconReport);
  const guide = renderGuide(diag, plugin, scenarios, reconReport);

  const ts = diag.started_at.replace(/[:.]/g, '-');
  const outDir = path.join(outRoot, ts);
  await mkdir(path.join(outDir, 'scenarios'), { recursive: true });

  await writeFile(path.join(outDir, 'diagnosis.json'), JSON.stringify({ ...diag, telemetry: undefined }, null, 2));
  await writeFile(path.join(outDir, 'telemetry.json'), JSON.stringify(diag.telemetry, null, 2));
  if (reconReport) await writeFile(path.join(outDir, 'recon.json'), JSON.stringify(reconReport, null, 2));
  await writeFile(path.join(outDir, 'attack-plan.json'), JSON.stringify(plan, null, 2));
  await writeFile(path.join(outDir, 'GUIA-DEL-HACKEO.md'), guide);
  for (const sc of scenarios) {
    await writeFile(path.join(outDir, 'scenarios', `${sc.vuln_id}.json`), JSON.stringify(sc, null, 2));
  }

  const latest = path.join(outRoot, 'latest');
  await mkdir(path.join(latest, 'scenarios'), { recursive: true });
  await writeFile(path.join(latest, 'GUIA-DEL-HACKEO.md'), guide);
  await writeFile(path.join(latest, 'attack-plan.json'), JSON.stringify(plan, null, 2));
  if (reconReport) await writeFile(path.join(latest, 'recon.json'), JSON.stringify(reconReport, null, 2));
  for (const sc of scenarios) {
    await writeFile(path.join(latest, 'scenarios', `${sc.vuln_id}.json`), JSON.stringify(sc, null, 2));
  }

  console.log('\n────────────────────────────────────────');
  console.log(`✅ ${diag.summary.confirmed}/${diag.summary.total} vulnerabilidades confirmadas  (perfil: ${diag.profile}, seed: ${diag.seed}, ${(diag.duration_ms / 1000).toFixed(1)}s)`);
  console.log(`   bloqueadas: ${diag.summary.blocked} · errores: ${diag.summary.errored} · requests: ${diag.summary.requests}`);
  console.log(`   atacante activo al cierre: ${diag.summary.attacker_active ? 'sí' : 'no'}`);
  if (diag.residue.length) console.log(`   ⚠ residuo sin limpiar (${diag.residue.length}): ${diag.residue.join('; ')}`);
  console.log(`   escenarios generados: ${scenarios.length}`);
  console.log(`\n📁 ${outDir}\n`);
}

main().catch((e) => {
  console.error('\n❌ Error:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
