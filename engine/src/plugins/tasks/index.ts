/** Plugin del target "Tasks": segundo dummy para probar generalización del core. */
import type { CandidateRoute, EnginePlugin, StorylineBeat } from '../../core/types.ts';
import { ATTACKS } from './attacks.ts';
import { CATALOG } from './catalog.ts';

const CANDIDATES: CandidateRoute[] = [
  { path: '/' }, { path: '/login' }, { path: '/register' },
  { path: '/me', sensitive: true }, { path: '/tasks', sensitive: true }, { path: '/tasks/1', sensitive: true },
  { path: '/go', sensitive: true }, { path: '/health' },
];

const STORYLINES: Record<string, StorylineBeat[]> = {
  idor: [{ phase: 'exploit', fact: 'Enumeración de /tasks/:id.', channel: 'datadog', symptom: 'Un usuario accede a muchos IDs en poco tiempo.' }],
  'sql-injection': [{ phase: 'impact', fact: 'UNION dump de users.', channel: 'sentry', symptom: 'Errores SQL y egreso de datos.' }],
  'open-redirect': [{ phase: 'exploit', fact: 'Enlaces /go?to= a dominios externos.', channel: 'support', symptom: 'Usuarios reportan links de la app que llevan a sitios raros.' }],
};

export const tasksPlugin: EnginePlugin = {
  id: 'tasks',
  scenarioNamespace: 'tasks',
  catalog: CATALOG,
  attacks: ATTACKS,
  reconCandidates: CANDIDATES,
  storylines: STORYLINES,
};
