import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { NotifyChannel } from './simulation.types.js';

/**
 * Herramientas de monitoreo/alertas que la simulación puede imitar. Solo se
 * activan si el repo tiene evidencia de que están configuradas: una dependencia
 * de su SDK o la llamada de inicialización en el código. Es determinista a
 * propósito: el developer no las elige y ningún LLM las puede inventar.
 */
export type DetectedTool = Extract<
  NotifyChannel,
  'sentry' | 'posthog' | 'datadog' | 'slack' | 'github'
>;

interface Rule {
  tool: DetectedTool;
  /** Nombres de paquete en manifests de dependencias (npm, pip, gem, go, composer). */
  deps: RegExp;
  /** Inicialización o uso del SDK en el código fuente. */
  code: RegExp;
}

const RULES: Rule[] = [
  {
    tool: 'sentry',
    deps: /@sentry\/|\bsentry[-_]sdk\b|\bsentry-(?:ruby|rails|laravel|symfony)\b|getsentry\/sentry-go|"sentry\/sentry/i,
    code: /\bSentry\.init\s*\(|\bsentry_sdk\.init\s*\(|browser\.sentry-cdn\.com|\bsentry\.Init\s*\(/,
  },
  {
    tool: 'posthog',
    deps: /\bposthog(?:-node|-js|-python|-ruby|-go|-php)?\b|@posthog\//i,
    code: /\bposthog\.init\s*\(|\bnew\s+PostHog\s*\(|\bPosthog\s*\(|i\.posthog\.com/,
  },
  {
    tool: 'datadog',
    deps: /\bdd-trace\b|@datadog\/|\bddtrace\b|\bdatadog(?:-api-client)?\b|DataDog\/dd-trace-go/i,
    code: /require\(\s*['"]dd-trace['"]\s*\)|from\s+['"]dd-trace['"]|\bDD_API_KEY\b|datadoghq\.com/,
  },
  {
    tool: 'slack',
    deps: /@slack\/|\bslack[-_]sdk\b|\bslack-notifier\b|\bslack-ruby-client\b/i,
    code: /hooks\.slack\.com\/services|\bnew\s+WebClient\s*\(|\bIncomingWebhook\s*\(/,
  },
];

/** Manifests de dependencias, por nombre de archivo. Los lockfiles se ignoran (traen dependencias transitivas). */
const DEP_FILES = new Set([
  'package.json',
  'requirements.txt',
  'requirements-prod.txt',
  'pyproject.toml',
  'Pipfile',
  'setup.py',
  'Gemfile',
  'go.mod',
  'composer.json',
]);

const CODE_EXT = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.py',
  '.rb',
  '.go',
  '.php',
  '.html',
  '.ejs',
  '.hbs',
  '.vue',
  '.svelte',
]);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  'vendor',
  'venv',
  '.venv',
  '__pycache__',
  'coverage',
  'test',
  'tests',
  '__tests__',
]);

const ORDER: DetectedTool[] = [
  'sentry',
  'posthog',
  'datadog',
  'slack',
  'github',
];
const MAX_FILES = 5000;
const MAX_BYTES = 512 * 1024;

/** Escanea el código del repo y devuelve las herramientas con evidencia de setup. */
export async function detectTools(root: string): Promise<DetectedTool[]> {
  const found = new Set<DetectedTool>();
  let seen = 0;

  // dependabot es la única señal confiable de que el repo recibe alertas de GitHub
  // (el mirror no trae .github/workflows).
  for (const f of ['dependabot.yml', 'dependabot.yaml']) {
    if (await exists(path.join(root, '.github', f))) found.add('github');
  }

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (seen >= MAX_FILES) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(full);
        continue;
      }
      if (!e.isFile()) continue;
      const isDep =
        DEP_FILES.has(e.name) || /^requirements.*\.txt$/.test(e.name);
      const isCode =
        CODE_EXT.has(path.extname(e.name)) && !/\.(test|spec)\./.test(e.name);
      if (!isDep && !isCode) continue;
      seen++;
      let text = await readSmall(full);
      if (!text) continue;
      if (e.name === 'package.json') text = npmDependencyNames(text);
      for (const rule of RULES) {
        if (found.has(rule.tool)) continue;
        if ((isDep && rule.deps.test(text)) || (isCode && rule.code.test(text)))
          found.add(rule.tool);
      }
    }
  };
  await walk(root);

  return ORDER.filter((t) => found.has(t));
}

/** En package.json solo cuentan los nombres de dependencias (no la descripción ni los scripts). */
function npmDependencyNames(json: string): string {
  try {
    const pkg = JSON.parse(json) as Record<
      string,
      Record<string, string> | undefined
    >;
    return ['dependencies', 'devDependencies', 'optionalDependencies']
      .flatMap((k) => Object.keys(pkg[k] ?? {}))
      .join('\n');
  } catch {
    return '';
  }
}

async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readSmall(p: string): Promise<string | undefined> {
  try {
    const s = await stat(p);
    if (s.size > MAX_BYTES) return undefined;
    return await readFile(p, 'utf8');
  } catch {
    return undefined;
  }
}
