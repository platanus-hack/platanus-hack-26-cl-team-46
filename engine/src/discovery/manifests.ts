/** Lee manifests (package.json, requirements, Docker, CI, .env) e infiere el stack. */
import type { FileRef, RepoModel, ScannedFile } from './types.ts';

export interface ManifestResult {
  manifests: RepoModel['manifests'];
  stack: RepoModel['stack'];
  notes: string[];
}

const NODE_DB: Record<string, string> = { pg: 'postgres', 'better-sqlite3': 'sqlite', sqlite3: 'sqlite', mysql: 'mysql', mysql2: 'mysql', mongodb: 'mongodb', mongoose: 'mongodb' };
const NODE_FW: Record<string, string> = { express: 'express', fastify: 'fastify', koa: 'koa', '@nestjs/core': 'nestjs', next: 'next' };
const PY_FW = ['flask', 'django', 'fastapi'];
const PY_DB: Record<string, string> = { psycopg2: 'postgres', 'psycopg2-binary': 'postgres', pymysql: 'mysql', sqlalchemy: 'sql', pymongo: 'mongodb' };

export function readManifests(files: ScannedFile[], commit: string): ManifestResult {
  const notes: string[] = [];
  const dockerfiles: FileRef[] = [];
  const ci: FileRef[] = [];
  const env: Array<{ name: string; ref: FileRef }> = [];
  let compose: FileRef | undefined;
  let openapi: FileRef | undefined;
  let packageJson: RepoModel['manifests']['packageJson'];
  const stack: RepoModel['stack'] = [];

  const hasTs = files.some((f) => /\.tsx?$/.test(f.rel));
  const hasPy = files.some((f) => f.rel.endsWith('.py'));

  for (const f of files) {
    const base = f.rel.split('/').pop() ?? f.rel;
    if (base === 'package.json' && !f.rel.includes('node_modules')) {
      try {
        const pkg = JSON.parse(f.lines.join('\n'));
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<string, string>;
        const depNames = Object.keys(deps);
        if (!packageJson) packageJson = { name: pkg.name, dependencies: depNames };
        const framework = depNames.map((d) => NODE_FW[d]).find(Boolean);
        const db = depNames.map((d) => NODE_DB[d]).find(Boolean);
        stack.push({ language: hasTs || depNames.includes('typescript') ? 'TypeScript' : 'JavaScript', framework, db });
      } catch {
        notes.push(`package.json no parseable: ${f.rel}`);
      }
    }
    if (base === 'requirements.txt' || base === 'pyproject.toml' || base === 'Pipfile') {
      const text = f.lines.join('\n').toLowerCase();
      const framework = PY_FW.find((fw) => text.includes(fw));
      const db = Object.keys(PY_DB).map((d) => (text.includes(d) ? PY_DB[d] : '')).find(Boolean) || (text.includes('sqlite') ? 'sqlite' : undefined);
      stack.push({ language: 'Python', framework, db });
    }
    if (base === 'Dockerfile' || base.startsWith('Dockerfile')) dockerfiles.push({ file: f.rel, commit });
    if (/^docker-compose\.ya?ml$/.test(base) || /^compose\.ya?ml$/.test(base)) compose = { file: f.rel, commit };
    if (f.rel.includes('.github/workflows/')) ci.push({ file: f.rel, commit });
    if (base === '.env' || base.startsWith('.env')) {
      f.lines.forEach((line, i) => {
        const m = /^\s*([A-Z][A-Z0-9_]+)\s*=/.exec(line);
        if (m) env.push({ name: m[1], ref: { file: f.rel, line: i + 1, commit } });
      });
    }
    if (!openapi && (/openapi|swagger/i.test(base) || /["']?openapi["']?\s*:/.test(f.lines[0] ?? '') || f.lines.slice(0, 5).some((l) => /["']?openapi["']?\s*:\s*["']3/.test(l) || /^swagger\s*:/.test(l)))) {
      if (/\.(json|ya?ml)$/.test(base)) openapi = { file: f.rel, commit };
    }
  }

  if (hasPy && !stack.some((s) => s.language === 'Python')) stack.push({ language: 'Python' });
  if (stack.length === 0) notes.push('no se detectó stack (sin package.json/requirements)');

  return { manifests: { packageJson, dockerfiles, compose, ci, env, openapi }, stack, notes };
}
