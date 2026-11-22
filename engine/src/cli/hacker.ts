/**
 * CLI del hacker externo: conecta el motor al simulador por el contrato
 * `hacker: "external"`. Lo arranca la orquestación tras crear la simulación con
 * `hacker:'external'` (que devuelve hacker_token).
 *
 *   node src/cli/hacker.ts --sim <sim_id> --token <hacker_token> \
 *     --backend https://api.mayday.rip [--plugin apuntes] [--profile fast] [--seed s] [--destructive]
 */
import { runAsHacker } from '../contract/external-hacker.ts';
import { apuntesPlugin } from '../plugins/apuntes/index.ts';
import { tasksPlugin } from '../plugins/tasks/index.ts';
import { destructivePlugin } from '../plugins/destructive/index.ts';

const PLUGINS: Record<string, typeof apuntesPlugin> = { apuntes: apuntesPlugin, tasks: tasksPlugin, destructive: destructivePlugin };

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  if (flag('help') || process.argv.includes('-h')) {
    console.log('Uso: node src/cli/hacker.ts --sim <id> --token <hacker_token> --backend <url> [--plugin apuntes] [--profile fast] [--seed s] [--destructive]');
    return;
  }
  const simId = arg('sim');
  const token = arg('token') ?? process.env.HACKER_TOKEN;
  const backendUrl = arg('backend') ?? process.env.PUBLIC_BACKEND_URL;
  if (!simId || !token || !backendUrl) {
    console.error('❌ Faltan --sim, --token y --backend (o HACKER_TOKEN / PUBLIC_BACKEND_URL).');
    process.exit(2);
  }
  const plugin = PLUGINS[arg('plugin', 'apuntes')!] ?? apuntesPlugin;

  console.log(`\n🕵️  Hacker externo → sim ${simId} @ ${backendUrl} · plugin ${plugin.id}\n`);
  const res = await runAsHacker({
    simId,
    token,
    backendUrl,
    plugin,
    seed: arg('seed', 'default'),
    profile: (arg('profile', 'fast') ?? 'fast') as any,
    destructive: flag('destructive'),
    log: (m) => console.log(m),
  });
  console.log(`\n✅ Fin. Vulns atacadas: ${res.attacked.join(', ') || '—'} · eventos publicados: ${res.events_posted}\n`);
}

main().catch((e) => {
  console.error('\n❌ Error:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
