import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RepoFile } from './tasks.js';

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  '.turbo',
  '.cache',
]);
const SKIP_FILES =
  /(\.lock|lock\.json|\.min\.(js|css)|\.map|\.(png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|pdf|zip|gz|mp4|mp3|wasm))$/i;

/** Archivos que más explican una app, en orden de prioridad. */
const PRIORITY: RegExp[] = [
  /^(package\.json|requirements\.txt|pyproject\.toml|Gemfile|go\.mod|composer\.json|Cargo\.toml)$/,
  /^readme(\.\w+)?$/i,
  /(^|\/)\.sandbox\/manifest\.json$/,
  /(^|\/)(seed|seeds|fixtures)[^/]*\.\w+$|\/seed[^/]*\//i,
  /(^|\/)(server|app|main|index)\.(ts|js|mjs|py|rb|go)$/,
  /(^|\/)(routes?|controllers?|api|handlers?|views?)\//i,
  /(^|\/)(models?|schema|db|migrations?)[/.]/i,
  /(^|\/)(middleware|auth)[^/]*[/.]/i,
];

const MAX_TREE = 300;
const MAX_FILE_CHARS = 6_000;
const MAX_TOTAL_CHARS = 60_000;

/**
 * Lee del código del sandbox lo justo para describir la app: el árbol de
 * archivos y el contenido de los más informativos (manifiestos, README,
 * entrypoints, rutas, modelos, seeds), con un tope total de caracteres.
 */
export async function collectRepoFiles(
  root: string,
): Promise<{ tree: string[]; files: RepoFile[] }> {
  const all: string[] = [];
  async function walk(dir: string) {
    if (all.length > 5_000) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = path.relative(root, path.join(dir, entry.name));
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(path.join(dir, entry.name));
      } else if (entry.isFile() && !SKIP_FILES.test(entry.name)) {
        all.push(rel.split(path.sep).join('/'));
      }
    }
  }
  await walk(root);
  all.sort();

  const ranked = all
    .map((p) => {
      const i = PRIORITY.findIndex((re) => re.test(p));
      return {
        p,
        rank: i === -1 ? PRIORITY.length : i,
        depth: p.split('/').length,
      };
    })
    .filter((x) => x.rank < PRIORITY.length)
    .sort(
      (a, b) => a.rank - b.rank || a.depth - b.depth || a.p.localeCompare(b.p),
    );

  const files: RepoFile[] = [];
  let total = 0;
  for (const { p } of ranked) {
    if (total >= MAX_TOTAL_CHARS) break;
    const full = path.join(root, p);
    if ((await stat(full)).size > 200_000) continue;
    let content = await readFile(full, 'utf8');
    if (content.includes('\u0000')) continue; // binario
    if (content.length > MAX_FILE_CHARS)
      content = `${content.slice(0, MAX_FILE_CHARS)}\n…(truncado)`;
    content = content.slice(0, MAX_TOTAL_CHARS - total);
    total += content.length;
    files.push({ path: p, content });
  }
  return { tree: all.slice(0, MAX_TREE), files };
}
