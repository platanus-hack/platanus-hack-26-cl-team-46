import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverRepo, correlate } from '../src/discovery/index.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const nodeRepo = path.join(here, 'fixtures/repo-node');
const flaskRepo = path.join(here, 'fixtures/repo-flask');

test('discovery (Node/Express): stack, rutas, señales, env y OpenAPI', async () => {
  const repo = await discoverRepo(nodeRepo, { commit: 'abc123' });

  // Stack inferido del package.json.
  assert.ok(repo.stack.some((s) => s.framework === 'express' && s.db === 'postgres' && s.language === 'TypeScript'));

  // Rutas Express con FileRef.
  const idorRoute = repo.routes.find((r) => r.source === 'express' && r.path === '/api/notes/:id');
  assert.ok(idorRoute, 'no encontró GET /api/notes/:id');
  assert.equal(idorRoute!.method, 'GET');
  assert.deepEqual(idorRoute!.params, ['id']);
  assert.match(idorRoute!.ref.file, /notes\.ts$/);
  assert.ok(idorRoute!.ref.line! > 0);

  // Ruta OpenAPI.
  assert.ok(repo.routes.some((r) => r.source === 'openapi' && r.path === '/api/notes/{id}'));

  // Señales con archivo/línea.
  assert.ok(repo.signals.some((s) => s.kind === 'raw-sql' && /notes\.ts$/.test(s.ref.file)));
  assert.ok(repo.signals.some((s) => s.kind === 'unescaped-render' && /note\.ejs$/.test(s.ref.file)));
  assert.ok(repo.signals.some((s) => s.kind === 'weak-jwt'));
  assert.ok(repo.signals.some((s) => s.kind === 'missing-authz' && /admin/.test(s.detail)));

  // Env vars.
  assert.ok(repo.manifests.env.some((e) => e.name === 'JWT_SECRET'));
  assert.ok(repo.manifests.openapi);

  // Correlación hallazgo dinámico → archivo/línea.
  const sqli = correlate('sql-injection', repo);
  assert.ok(sqli && /notes\.ts$/.test(sqli.file) && sqli.line! > 0, 'SQLi no correlacionó a archivo/línea');
  const idor = correlate('idor', repo);
  assert.ok(idor && /notes\.ts$/.test(idor.file), 'IDOR no correlacionó a la ruta');
  assert.ok(correlate('admin-endpoint-no-authz', repo), 'admin-no-authz no correlacionó');
  assert.ok(correlate('stored-xss', repo), 'XSS no correlacionó');
});

test('discovery (Python/Flask): stack y rutas', async () => {
  const repo = await discoverRepo(flaskRepo, { commit: 'def456' });
  assert.ok(repo.stack.some((s) => s.language === 'Python' && s.framework === 'flask' && s.db === 'postgres'));
  assert.ok(repo.routes.some((r) => r.source === 'flask' && r.path === '/api/items/<id>'));
  assert.ok(repo.routes.some((r) => r.source === 'flask' && r.path === '/login' && r.method === 'POST'));
  assert.ok(repo.signals.some((s) => s.kind === 'raw-sql' && /app\.py$/.test(s.ref.file)));
  assert.ok(correlate('weak-password-no-rate-limit', repo), 'login no correlacionó');
});

// Monorepo como hack-26: la app desplegada vive en una subcarpeta (root_dir del manifest)
// y al lado hay código del propio motor, fixtures vulnerables y un HMAC con template string.
test('discovery: en un monorepo correlaciona solo con la app desplegada', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(path.join(tmpdir(), 'mono-'));
  const put = async (rel: string, body: string) => {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), body);
  };
  await put('.sandbox/manifest.json', JSON.stringify({ runtime: 'docker', root_dir: 'victim-app' }));
  await put(
    'victim-app/src/models/notes.ts',
    "export async function list(q) {\n  let sql = `SELECT * FROM notes WHERE user_id = 1`;\n  sql += ` AND (title ILIKE '%${q}%')`;\n}\n",
  );
  await put('victim-app/test/fixtures/evil.ts', "db.query(`SELECT * FROM users WHERE id = ${id}`);\n");
  await put('engine/src/signals.ts', "if (/<%-\\s/.test(line)) push('unescaped-render');\ndb.query(`SELECT * FROM t WHERE a = ${x}`);\n");
  await put('backend/src/token.ts', "createHmac('sha256', s).update(`agent:${id}`).digest('base64url');\n");

  const repo = await discoverRepo(root);
  const files = new Set(repo.signals.map((s) => s.ref.file));
  assert.ok([...files].every((f) => f.startsWith('victim-app/src/')), `señales fuera de la app: ${[...files].join(', ')}`);
  assert.equal(correlate('sql-injection', repo)?.file, path.join('victim-app', 'src', 'models', 'notes.ts'));
  assert.ok(repo.notes.some((n) => n.includes('victim-app')));
});

test('discovery: un .update(`…${x}`) de un HMAC no es SQL', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(path.join(tmpdir(), 'hmac-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src/token.ts'), "createHmac('sha256', s).update(`agent:${id}`).digest('base64url');\nqb.where(`a = ${b}`);\n");
  const repo = await discoverRepo(root);
  assert.equal(repo.signals.filter((s) => s.kind === 'raw-sql').length, 0);
});

test('discovery: chequeo de rol en el handler y <%- include %> no son hallazgos', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const root = await mkdtemp(path.join(tmpdir(), 'inline-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'views'), { recursive: true });
  await writeFile(
    path.join(root, 'src/web.ts'),
    "web.get('/admin', requireLogin, async (req, res) => {\n  if (req.user!.role !== 'admin') {\n    return res.status(403).end();\n  }\n});\nadmin.get('/api/admin/users/export', requireAuth, async (req, res) => {\n  res.json(await all());\n});\n",
  );
  await writeFile(path.join(root, 'views/admin.ejs'), "<%- include('header') %>\n<div><%- note.body %></div>\n");
  const repo = await discoverRepo(root);
  assert.equal(correlate('admin-endpoint-no-authz', repo)?.line, 6);
  assert.equal(correlate('stored-xss', repo)?.line, 2);
});
