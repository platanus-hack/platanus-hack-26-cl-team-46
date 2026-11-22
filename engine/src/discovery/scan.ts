/**
 * Recorre el repo y lee archivos de texto relevantes (sin node_modules/.git).
 *
 * Se saltan tests y fixtures: suelen traer código vulnerable a propósito (o las
 * reglas de detección) y correlacionaban hallazgos con archivos que no corren.
 * Con `subdir` se recorre solo esa carpeta (la app desplegada en un monorepo),
 * pero las rutas quedan relativas a la raíz del repo.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ScannedFile } from './types.ts';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '__pycache__', 'venv', '.venv',
  'test', 'tests', '__tests__', 'spec', '__mocks__', 'fixtures', '__fixtures__', 'e2e',
]);
/** foo.test.ts, foo.spec.js, test_foo.py, foo_test.py */
const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(^test_.*\.py$)|(_test\.py$)/;
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.ejs', '.html', '.json', '.yml', '.yaml', '.env', '.example', '.sql', '.txt', '.toml', '.cfg',
]);
const MAX_BYTES = 512 * 1024;

export async function scanRepo(root: string, opts: { subdir?: string } = {}): Promise<ScannedFile[]> {
  const out: ScannedFile[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.env' && e.name !== '.github' && !e.name.startsWith('.env')) {
        // permitimos .env*, .github; saltamos otros ocultos
        if (e.isDirectory() && e.name !== '.github') continue;
      }
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(path.join(dir, e.name));
        continue;
      }
      if (TEST_FILE.test(e.name)) continue;
      const ext = path.extname(e.name).toLowerCase();
      const isEnv = e.name === '.env' || e.name.startsWith('.env');
      const isDockerfile = e.name === 'Dockerfile' || e.name.startsWith('Dockerfile');
      if (!TEXT_EXT.has(ext) && !isEnv && !isDockerfile) continue;
      const abs = path.join(dir, e.name);
      try {
        const buf = await readFile(abs);
        if (buf.byteLength > MAX_BYTES) continue;
        out.push({ rel: path.relative(root, abs), lines: buf.toString('utf8').split('\n') });
      } catch {
        /* ignore */
      }
    }
  }
  await walk(opts.subdir ? path.join(root, opts.subdir) : root);
  return out;
}
