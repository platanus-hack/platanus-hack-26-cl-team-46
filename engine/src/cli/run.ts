/**
 * CLI del motor de hacking.
 *
 * SEGURIDAD: no hay target ni credenciales por defecto. `--url` es obligatorio y
 * `--help` no tiene efectos secundarios (no dispara ningún request). El cliente
 * HTTP aplica scope guard: solo se ataca el host de `--url`.
 *
 * Uso:
 *   node engine/src/cli/run.ts --url https://sbx-xxxx.onrender.com [opciones]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { diagnose } from '../core/diagnose.ts';
import { buildDiagnoses, type CodeRef } from '../core/diagnosis.ts';
import { buildAttackPlan, toTimelineEvents } from '../core/events.ts';
import { CostLedger } from '../core/ledger.ts';
import { appDirOf, correlate, discoverRepo, type RepoModel } from '../discovery/index.ts';
import { buildCascadeFromEnv } from '../providers/cascade.ts';
import { runSemgrep } from '../providers/semgrep.ts';
import { recon } from '../core/recon.ts';
import { renderGuide } from '../core/report.ts';
import { buildScenarioPack } from '../core/scenario.ts';
import type { TargetConfig } from '../core/types.ts';
import { apuntesPlugin } from '../plugins/apuntes/index.ts';
import { tasksPlugin } from '../plugins/tasks/index.ts';
import { analyzeCicd, destructivePlugin } from '../plugins/destructive/index.ts';
import { buildGenericPlugin, readRepoSecrets } from '../plugins/generic/index.ts';
import { detectPlugin } from '../plugins/detect.ts';
import type { EnginePlugin } from '../core/types.ts';

const PLUGINS: Record<string, typeof apuntesPlugin> = {
  apuntes: apuntesPlugin,
  tasks: tasksPlugin,
  destructive: destructivePlugin,
};


const HELP = `Motor de hacking — diagnóstico real contra una app controlada y autorizada.

Uso:
  node src/cli/run.ts --url <https://host> [opciones]

Obligatorio:
  --url <url>            Target autorizado. SOLO se ataca este host (scope guard).

Opciones:
  --plugin <p>          auto | generic | apuntes | tasks | destructive (default: apuntes)
                        auto = plugin propio si el repo es una víctima conocida; si no, generic (cualquier app)
  --destructive         Habilita módulos que GENERAN DAÑO (DoS, SSRF, etc.). Solo contenedor desechable.
  --profile <p>         noisy | normal | fast | stealth        (default: fast)
  --seed <s>            Semilla para reproducibilidad            (default: "default")
  --budget <usd>        Tope de costo LLM por corrida             (default: 5)
  --read-only           Correr solo módulos no mutantes (no crea/modifica estado)
  --only <ids>          CSV de vuln_id a correr (p. ej. idor,sql-injection)
  --weak-email <email>  Credencial conocida para fuerza bruta / sesión de baja privilegia
  --weak-pass <pass>    (ambos juntos; sin default, específico de la app)
  --repo <path>         Ruta al repo del target: discovery estática + correlación archivo/línea
  --repo-model <path>   Reusa un RepoModel ya calculado (JSON) y SALTA el discovery
                        estático. Ideal para re-verificar una vuln (--only) sin re-descubrir.
  --commit <sha>        Commit del target, para versionar el escenario y los FileRef
  --no-recon            Saltar la fase de reconocimiento
  --semgrep             Correr semgrep (SAST) sobre --repo; requiere el binario o Docker
  --providers           Correr el provider LLM (requiere ANTHROPIC_API_KEY y --repo); cuesta $
  --out <dir>           Carpeta de salida                        (default: engine/out)
  --help, -h            Mostrar esta ayuda (sin efectos secundarios)

Ejemplo (app víctima Apuntes):
  node src/cli/run.ts --url https://sbx-xxxx.onrender.com \\
    --weak-email martin.soto@example.com --weak-pass qwerty123 --seed demo-1
`;

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Carga un RepoModel serializado (--repo-model) para saltar el discovery estático. */
async function loadRepoModel(file: string): Promise<RepoModel> {
  let model: RepoModel;
  try {
    model = JSON.parse(await readFile(file, 'utf8')) as RepoModel;
  } catch (e) {
    throw new Error(`--repo-model no se pudo leer (${file}): ${e instanceof Error ? e.message : e}`);
  }
  if (!model || !Array.isArray(model.routes) || !Array.isArray(model.signals)) {
    throw new Error(`--repo-model inválido (${file}): se esperaba un RepoModel con routes[] y signals[]`);
  }
  return model;
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
  const budgetUsd = Number(arg('budget', '5'));
  const readOnly = flag('read-only');
  const destructive = flag('destructive');
  const pluginArg = arg('plugin', 'apuntes')!;
  const outRoot = arg('out', path.resolve(import.meta.dirname, '../../out'))!;

  const target: TargetConfig = {
    url: url.replace(/\/$/, ''),
    commit: arg('commit'),
    seed_users: weakEmail && weakPass ? [{ email: weakEmail, password: weakPass, role: 'user' }] : [],
    weak_login: weakEmail && weakPass ? { email: weakEmail, password: weakPass } : undefined,
  };

  console.log(`\n🎯 Motor de hacking → ${target.url}  (scope: ${parsed.origin}) · plugin ${pluginArg}`);
  console.log(`   solo se ataca este host autorizado · perfil ${profile} · seed ${seed}${readOnly ? ' · read-only' : ''}`);
  if (destructive) {
    console.log('   ⚠️  MODO DESTRUCTIVO: genera daño real. Solo contra un contenedor desechable autorizado (no producción, no infra compartida sin permiso).');
  }
  console.log('');

  // Fase discovery (A): el repo participa. Correlaciona hallazgos con archivo/línea.
  // --repo-model reusa un RepoModel ya calculado (p. ej. de la primera pasada) y
  // SALTA el discovery estático pesado: así una re-verificación (--only) ataca una
  // sola vuln sin re-clonar ni re-escanear todo el repo.
  const repoPath = arg('repo');
  const repoModelPath = arg('repo-model');
  let repoModel: RepoModel | undefined;
  let discoveryMs = 0;
  if (repoModelPath) {
    const t = Date.now();
    repoModel = await loadRepoModel(path.resolve(repoModelPath));
    discoveryMs = Date.now() - t;
    console.log(`▶ discovery: RepoModel reusado (${repoModel.routes.length} rutas, ${repoModel.signals.length} señales) · sin re-escanear`);
  } else if (repoPath) {
    const t = Date.now();
    repoModel = await discoverRepo(path.resolve(repoPath), { commit: arg('commit') });
    discoveryMs = Date.now() - t;
    console.log(`▶ discovery: ${repoModel.routes.length} rutas, ${repoModel.signals.length} señales, stack ${repoModel.stack.map((s) => s.framework ?? s.language).join('/')}`);
  }

  const pluginName = pluginArg === 'auto' ? detectPlugin(repoModel) : pluginArg;
  const plugin: EnginePlugin =
    pluginName === 'generic'
      ? buildGenericPlugin({ repo: repoModel, repoSecrets: repoPath ? await readRepoSecrets(path.resolve(repoPath)) : [] })
      : PLUGINS[pluginName] ?? apuntesPlugin;
  if (pluginArg === 'auto' || pluginName === 'generic') console.log(`▶ plugin: ${plugin.id}${pluginArg === 'auto' ? ' (auto)' : ''}`);

  const reconReport = flag('no-recon') ? undefined : await recon(target, plugin.reconCandidates, { seed, log: (m) => console.log(m) });
  const diag = await diagnose(target, plugin, { only, profile, seed, readOnly, destructive, log: (m) => console.log(m) });

  // Análisis de deploy/CICD del repo (read-only).
  let cicd;
  if (repoPath) {
    cicd = await analyzeCicd(path.resolve(repoPath), arg('commit'));
    if (cicd.length) console.log(`▶ cicd: ${cicd.length} hallazgo(s) en workflows (${[...new Set(cicd.map((c) => c.kind))].join(', ')})`);
  }

  // SAST con semgrep (fuente externa aprobada). Binario horneado en Modal/Render.
  let semgrep;
  if (flag('semgrep')) {
    if (!repoPath) {
      console.log('⚠ --semgrep requiere --repo: se omite.');
    } else {
      try {
        semgrep = await runSemgrep(path.resolve(repoPath), { subdir: appDirOf(path.resolve(repoPath)) });
        console.log(`▶ semgrep: ${semgrep.length} hallazgo(s)`);
      } catch (e) {
        console.log(`⚠ semgrep falló: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  const scenarios = buildScenarioPack(diag, plugin);
  const plan = buildAttackPlan(diag, plugin, reconReport);
  // El backend lo usa para re-verificar con el mismo catálogo.
  (plan.raw as Record<string, unknown>).plugin = plugin.id;
  const guide = renderGuide(diag, plugin, scenarios, reconReport);

  // Correlación repo ↔ hallazgo (A/I): archivo/línea derivado del código real.
  let correlated = 0;
  const refs: Record<string, CodeRef | undefined> = {};
  if (repoModel || plugin.refFor) {
    for (const r of diag.results) {
      const ref = plugin.refFor?.(r.vuln_id) ?? (repoModel ? correlate(r.vuln_id, repoModel) : undefined);
      if (ref) refs[r.vuln_id] = ref;
    }
    const findings = (plan.raw as any).findings as Array<Record<string, unknown>>;
    for (const f of findings) {
      const ref = refs[String(f.vuln_id)];
      if (ref) {
        f.repo_ref = ref;
        if (f.confirmed) correlated++;
      }
    }
  }

  // Diagnóstico estructurado (I): veredicto/confianza/causa raíz/remediación/re-verify.
  const diagnoses = buildDiagnoses(diag, plugin, refs);
  const avgConf = diagnoses.filter((d) => d.verdict === 'confirmed').reduce((s, d, _i, arr) => s + d.confidence / arr.length, 0);

  // Cost ledger: cómputo local ($0) + LLM si --providers.
  const ledger = new CostLedger();
  if (repoModel) ledger.recordLocal('discovery', 'repo-scan', { wallMs: discoveryMs });
  if (reconReport) ledger.recordLocal('recon', 'http+recon', { requests: reconReport.requests, wallMs: reconReport.duration_ms });
  ledger.recordLocal('exploit', 'http-attacks', { requests: diag.summary.requests, wallMs: diag.duration_ms });

  // Provider LLM (C): propone ángulos a partir del RepoModel (metadata, no el código).
  let llmAngles: unknown;
  if (flag('providers')) {
    const cascade = buildCascadeFromEnv(process.env, (m, u) => ledger.recordLlm('analysis', m, u));
    if (!cascade) {
      console.log('⚠ --providers pedido pero no hay keys (ANTHROPIC_API_KEY / DEEPSEEK_API_KEY / GLM_API_KEY): se omite el análisis LLM.');
    } else if (!repoModel) {
      console.log('⚠ --providers requiere --repo (el análisis LLM parte del RepoModel).');
    } else {
      const slim = {
        stack: repoModel.stack,
        routes: repoModel.routes.map((r) => ({ method: r.method, path: r.path, auth: r.auth, source: r.source })),
        signals: repoModel.signals.map((s) => ({ kind: s.kind, ref: `${s.ref.file}:${s.ref.line ?? ''}` })),
      };
      try {
        const angles = await cascade.analyze({ repo: slim, recon: reconReport?.findings, scopeOrigins: [parsed.origin] });
        llmAngles = angles;
        console.log(`▶ providers: ${angles.length} ángulo(s) (cascada: ${cascade.attempts.map((a) => `${a.provider}${a.ok ? '✓' : '✗'}`).join('→')}, costo $${ledger.byPhase().analysis?.toFixed(5) ?? '0'})`);
      } catch (e) {
        console.log(`⚠ toda la cascada de providers falló: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  const ledgerSnap = ledger.snapshot();
  const overBudget = ledger.overBudget(budgetUsd);
  if (overBudget) console.log(`⛔ presupuesto $${budgetUsd} excedido ($${ledgerSnap.grandTotalUsd.toFixed(4)}).`);

  const ts = diag.started_at.replace(/[:.]/g, '-');
  const outDir = path.join(outRoot, ts);
  await mkdir(path.join(outDir, 'scenarios'), { recursive: true });

  await writeFile(path.join(outDir, 'diagnosis.json'), JSON.stringify({ ...diag, telemetry: undefined }, null, 2));
  await writeFile(path.join(outDir, 'telemetry.json'), JSON.stringify(diag.telemetry, null, 2));
  if (reconReport) await writeFile(path.join(outDir, 'recon.json'), JSON.stringify(reconReport, null, 2));
  await writeFile(path.join(outDir, 'attack-plan.json'), JSON.stringify(plan, null, 2));
  await writeFile(path.join(outDir, 'cost-ledger.json'), JSON.stringify(ledgerSnap, null, 2));
  await writeFile(path.join(outDir, 'diagnoses.json'), JSON.stringify(diagnoses, null, 2));
  if (repoModel) await writeFile(path.join(outDir, 'repo-model.json'), JSON.stringify(repoModel, null, 2));
  if (cicd && cicd.length) await writeFile(path.join(outDir, 'cicd.json'), JSON.stringify(cicd, null, 2));
  if (semgrep) await writeFile(path.join(outDir, 'semgrep.json'), JSON.stringify(semgrep, null, 2));
  if (llmAngles) await writeFile(path.join(outDir, 'llm-angles.json'), JSON.stringify(llmAngles, null, 2));
  // Pasos reales por vuln, en el contrato attack.* del backend: el simulador los repite con reloj humano.
  const replay = Object.fromEntries(diag.results.map((r) => [r.vuln_id, toTimelineEvents(r, plugin)]));
  await writeFile(path.join(outDir, 'replay.json'), JSON.stringify(replay, null, 2));
  await writeFile(path.join(outDir, 'GUIA-DEL-HACKEO.md'), guide);
  for (const sc of scenarios) {
    await writeFile(path.join(outDir, 'scenarios', `${sc.vuln_id}.json`), JSON.stringify(sc, null, 2));
  }

  const latest = path.join(outRoot, 'latest');
  await mkdir(path.join(latest, 'scenarios'), { recursive: true });
  await writeFile(path.join(latest, 'GUIA-DEL-HACKEO.md'), guide);
  await writeFile(path.join(latest, 'attack-plan.json'), JSON.stringify(plan, null, 2));
  await writeFile(path.join(latest, 'diagnoses.json'), JSON.stringify(diagnoses, null, 2));
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
  if (repoModel) console.log(`   correlación repo: ${correlated}/${diag.summary.confirmed} hallazgos confirmados con archivo/línea`);
  console.log(`   diagnósticos: ${diagnoses.length} (confianza promedio confirmadas: ${(avgConf || 0).toFixed(2)})`);
  console.log(`   costo: $${ledgerSnap.grandTotalUsd.toFixed(4)} (LLM $0 — sin providers aún) · presupuesto $${budgetUsd}${overBudget ? ' ⚠ EXCEDIDO' : ''}`);
  console.log(`\n📁 ${outDir}\n`);
}

main().catch((e) => {
  console.error('\n❌ Error:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
