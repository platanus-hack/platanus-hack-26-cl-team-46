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
