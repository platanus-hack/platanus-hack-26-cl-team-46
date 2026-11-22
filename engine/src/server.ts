/**
 * Servidor HTTP mínimo del motor, para correr en SU PROPIO contenedor (separado
 * de la app diagnosticada). Lo usa Render (fallback, ver Dockerfile y render.yaml).
 * En Modal (primario) el motor corre vía modal_app.py, no con este servidor.
 * Recibe un EngagementSpec y corre el estudio.
 *
 * POST /run  { url, repo?, plugin?, profile?, seed?, destructive?, weak_login? }
 * GET  /health
 *
 * No persiste estado (devuelve el resultado en la respuesta).
 */
import { createServer } from 'node:http';
import { diagnose } from './core/diagnose.ts';
import { buildDiagnoses } from './core/diagnosis.ts';
import { recon } from './core/recon.ts';
import { buildScenarioPack } from './core/scenario.ts';
import { apuntesPlugin } from './plugins/apuntes/index.ts';
import { tasksPlugin } from './plugins/tasks/index.ts';
import { destructivePlugin } from './plugins/destructive/index.ts';
import type { TargetConfig } from './core/types.ts';

const PLUGINS: Record<string, typeof apuntesPlugin> = { apuntes: apuntesPlugin, tasks: tasksPlugin, destructive: destructivePlugin };
const PORT = Number(process.env.PORT) || 8080;

const server = createServer(async (req, res) => {
  const send = (c: number, o: unknown) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
  if (req.method !== 'POST' || req.url !== '/run') return send(404, { error: 'not found' });

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    try {
      const spec = JSON.parse(body || '{}');
      if (!spec.url) return send(400, { error: 'falta url' });
      const plugin = PLUGINS[spec.plugin ?? 'apuntes'] ?? apuntesPlugin;
      const target: TargetConfig = {
        url: String(spec.url).replace(/\/$/, ''),
        commit: spec.commit,
        seed_users: spec.weak_login ? [{ ...spec.weak_login, role: 'user' }] : [],
        weak_login: spec.weak_login,
        dos_path: spec.dos_path, ssrf_path: spec.ssrf_path, chat_path: spec.chat_path, redirect_path: spec.redirect_path,
      };
      const reconReport = spec.no_recon ? undefined : await recon(target, plugin.reconCandidates, { seed: spec.seed });
      const diag = await diagnose(target, plugin, { profile: spec.profile ?? 'fast', seed: spec.seed, destructive: !!spec.destructive });
      send(200, {
        summary: diag.summary,
        schedule: diag.schedule,
        recon: reconReport?.surface_summary,
        scenarios: buildScenarioPack(diag, plugin).map((s) => s.scenario_id),
        diagnoses: buildDiagnoses(diag, plugin),
        residue: diag.residue,
      });
    } catch (e) {
      send(500, { error: e instanceof Error ? e.message : String(e) });
    }
  });
});

server.listen(PORT, () => console.log(`motor escuchando en :${PORT}`));
