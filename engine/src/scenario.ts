/**
 * Convierte el diagnóstico en escenarios preconfigurados, versionados y
 * reproducibles. Cada escenario confirmado es un "guión" que el simulador
 * reproduce: trae el ataque real grabado, los beats de storytelling y los
 * criterios de evaluación. El usuario del simulador elige cuál seguir.
 */
import { createHash } from 'node:crypto';
import { CATALOG } from './catalog.ts';
import type { DiagnosisResult } from './diagnose.ts';
import type { AttackResult, Scenario, StorylineBeat } from './types.ts';

const SCHEMA_VERSION = '1';

/** Beats de storytelling por vuln: cómo se percibe el ataque (síntomas). */
const STORYLINES: Record<string, StorylineBeat[]> = {
  'weak-password-no-rate-limit': [
    { phase: 'recon', fact: 'Ráfaga de intentos de login fallidos contra una cuenta.', channel: 'datadog', symptom: 'Pico de respuestas 401 en /api/auth/login desde una IP.' },
    { phase: 'exploit', fact: 'La contraseña débil cae y el atacante entra.', channel: 'email', symptom: 'El usuario recibe un aviso de inicio de sesión que no reconoce.' },
  ],
  'jwt-not-invalidated-on-password-change': [
    { phase: 'persistence', fact: 'El atacante usa un token robado que sobrevive al cambio de contraseña.', channel: 'support', symptom: 'El usuario dice que cambió la contraseña pero siguen entrando a su cuenta.' },
    { phase: 'impact', fact: 'Requests con token_iat anterior al password_changed.', channel: 'datadog', symptom: 'Actividad del mismo user_id desde una IP desconocida tras el cambio de clave.' },
  ],
  idor: [
    { phase: 'exploit', fact: 'Enumeración de /api/notes/:id para leer notas ajenas.', channel: 'datadog', symptom: 'Un usuario accede a muchos IDs de notas secuenciales en poco tiempo.' },
    { phase: 'impact', fact: 'Lectura de notas con datos sensibles de otros usuarios.', channel: 'email', symptom: 'Un cliente reporta que alguien conoce datos que solo tenía en la app.' },
  ],
  'admin-endpoint-no-authz': [
    { phase: 'exploit', fact: 'Un usuario sin rol admin descarga el export completo de usuarios.', channel: 'sentry', symptom: 'admin_export con role!=admin y una respuesta de muchos bytes.' },
    { phase: 'impact', fact: 'Egreso de la tabla users con password_hash.', channel: 'phone', symptom: 'Un cliente llama: alguien tiene su teléfono y email.' },
  ],
  'mass-assignment': [
    { phase: 'exploit', fact: 'Un usuario se auto-asciende a admin vía PATCH /api/users/me.', channel: 'slack', symptom: 'Apareció un admin nuevo que nadie creó.' },
    { phase: 'impact', fact: 'La cuenta escalada entra al panel de admin.', channel: 'sentry', symptom: 'admin_access con una cuenta recién creada.' },
  ],
  'sql-injection': [
    { phase: 'recon', fact: 'Errores de sintaxis SQL provocados en la búsqueda.', channel: 'sentry', symptom: 'Errores nuevos "syntax error at or near" en minutos.' },
    { phase: 'impact', fact: 'UNION-based dump de la tabla users.', channel: 'datadog', symptom: 'Egreso de datos y queries anómalas en la base.' },
  ],
  'verbose-errors': [
    { phase: 'recon', fact: 'El atacante provoca errores para mapear la base.', channel: 'sentry', symptom: 'Aumento de server_error con stack traces completos.' },
  ],
  'stored-xss': [
    { phase: 'exploit', fact: 'Nota con payload que se ejecuta al verla.', channel: 'support', symptom: 'La admin dice que el panel "se comportó raro".' },
    { phase: 'impact', fact: 'Robo de la cookie de sesión de la admin.', channel: 'datadog', symptom: 'Acciones de admin desde una IP desconocida.' },
  ],
};

function successCriteria(vulnId: string) {
  const meta = CATALOG[vulnId];
  return {
    detected: `El developer identifica el síntoma y lo atribuye a ${meta.title.toLowerCase()}.`,
    contained: meta.fix_correct,
    traps: meta.fix_wrong,
  };
}

export function buildScenario(attack: AttackResult, diag: DiagnosisResult): Scenario {
  const meta = CATALOG[attack.vuln_id];
  // Seed determinista: deriva del vuln + commit del target, para reproducibilidad.
  const seed = createHash('sha256')
    .update(`${attack.vuln_id}:${diag.target.commit ?? diag.target.url}`)
    .digest('hex')
    .slice(0, 12);

  return {
    scenario_id: `apuntes.${attack.vuln_id}`,
    version: `${SCHEMA_VERSION}.${meta.order}+${seed}`,
    seed,
    vuln_id: attack.vuln_id,
    title: meta.title,
    meta,
    entry_point: attack.steps[0]?.request ?? meta.code_location,
    attack,
    storyline: STORYLINES[attack.vuln_id] ?? [],
    success_criteria: successCriteria(attack.vuln_id),
    created_at: new Date().toISOString(),
    target: { url: diag.target.url, commit: diag.target.commit },
  };
}

/** Un escenario por vulnerabilidad CONFIRMADA. */
export function buildScenarioPack(diag: DiagnosisResult): Scenario[] {
  return diag.results
    .filter((r) => r.confirmed)
    .map((r) => buildScenario(r, diag))
    .sort((a, b) => a.meta.order - b.meta.order);
}
