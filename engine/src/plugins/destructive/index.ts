/**
 * Plugin del MODO DESTRUCTIVO: ataques que generan daño real (DoS, SSRF→secrets,
 * prompt-injection, phishing). Solo corren con --destructive y contra un
 * contenedor desechable autorizado. El deploy/CICD se analiza aparte (analyzeCicd).
 */
import type { CandidateRoute, EnginePlugin, StorylineBeat } from '../../core/types.ts';
import { ATTACKS } from './attacks.ts';
import { CATALOG } from './catalog.ts';

export { analyzeCicd, type CicdFinding } from './cicd.ts';

const CANDIDATES: CandidateRoute[] = [
  { path: '/' }, { path: '/health' }, { path: '/slow', sensitive: true },
  { path: '/fetch', sensitive: true }, { path: '/chat', sensitive: true }, { path: '/go', sensitive: true },
];

const STORYLINES: Record<string, StorylineBeat[]> = {
  dos: [{ phase: 'impact', fact: 'Ráfaga de peticiones a un endpoint sin límite.', channel: 'datadog', symptom: 'Pico de CPU/latencia y timeouts; el servicio se cae.' }],
  'ssrf-secrets': [{ phase: 'impact', fact: 'El servidor fue forzado a leer el metadata endpoint.', channel: 'sentry', symptom: 'Peticiones salientes a 169.254.169.254 y uso de credenciales desde una IP nueva.' }],
  'cicd-poisoning': [{ phase: 'persistence', fact: 'Un artefacto envenenado se desplegó con confianza.', channel: 'github', symptom: 'Un deploy que nadie reconoce; cambios en el workflow.' }],
  'prompt-injection': [{ phase: 'exploit', fact: 'El chatbot reveló su system prompt.', channel: 'support', symptom: 'El bot "dijo cosas raras" o filtró datos internos.' }],
  phishing: [{ phase: 'exploit', fact: 'Enlaces con el dominio de la víctima que llevan a un sitio clonado.', channel: 'email', symptom: 'Usuarios reportan correos con links de la app que piden su clave.' }],
};

export const destructivePlugin: EnginePlugin = {
  id: 'destructive',
  scenarioNamespace: 'destructive',
  catalog: CATALOG,
  attacks: ATTACKS,
  reconCandidates: CANDIDATES,
  storylines: STORYLINES,
};
