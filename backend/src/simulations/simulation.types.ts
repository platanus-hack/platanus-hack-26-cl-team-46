/**
 * Una simulación = un sandbox desplegado + un workspace de Conductor (una VM)
 * con varios threads, cada uno un agente con un rol. Todos se coordinan a
 * través del TIMELINE: un registro append-only de eventos tipados que vive en
 * el backend. Nadie lee el transcript de otro thread; leen el timeline.
 */

/** Roles de los threads del workspace de la simulación. */
export const SIM_ROLES = [
  'infra',
  'hacker',
  'observer',
  'generator',
  'coder',
] as const;
export type SimRole = (typeof SIM_ROLES)[number];

/** Quién emite un evento: un thread, el usuario o el propio backend. */
export type SimActor = SimRole | 'user' | 'system';

/**
 * starting: creando VM/threads y esperando deploy + plan de ataque.
 * ready:    todo listo, esperando que el usuario parta.
 * running:  incidente en curso.
 * paused:   el atacante está detenido (el usuario puede seguir actuando).
 * finished: el observador cerró la simulación con un debrief.
 * failed:   no se pudo preparar (deploy fallido, etc.).
 * stopped:  el usuario la terminó y se archivó la VM.
 */
export type SimStatus =
  | 'starting'
  | 'ready'
  | 'running'
  | 'paused'
  | 'finished'
  | 'failed'
  | 'stopped';

/** Canales simulados por los que llegan notificaciones al developer. */
export const NOTIFY_CHANNELS = [
  'email', // correos de clientes/usuarios
  'support', // tickets de soporte / chat de clientes
  'phone', // llamada de un cliente
  'sentry',
  'posthog',
  'datadog',
  'slack',
  'github', // dependabot, secret scanning
  'render', // alertas de la plataforma (CPU, memoria, deploys)
] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

/**
 * Canales que siempre existen, aunque el repo no tenga ninguna herramienta.
 * `slack` es el chat del equipo: todo developer tiene compañeros que escriben.
 */
export const BASE_CHANNELS: NotifyChannel[] = [
  'email',
  'slack',
  'support',
  'phone',
  'render',
];

export type Severity = 'info' | 'warning' | 'critical';

/**
 * Evento del timeline. Es compatible con el contrato §6.2 (`t`, `vuln_id`,
 * `source`, `severity`, `title`, `body`, `raw`) y agrega metadata para
 * orquestar (`seq`, `actor`, `type`, `visibility`).
 */
export interface TimelineEvent {
  seq: number;
  t: string;
  sim_id: string;
  actor: SimActor;
  /** Tipo con namespace, p. ej. `attack.success`, `notify`, `user.message`. Ver EVENT_TYPES. */
  type: string;
  /** user: se muestra al developer. internal: solo agentes y vista "god mode". */
  visibility: 'user' | 'internal';
  vuln_id: string | null;
  /** §6.2: para `notify` es el canal (email, sentry…); en el resto, el actor. */
  source: string;
  severity: Severity;
  title: string;
  body: string;
  raw: Record<string, unknown>;
}

export interface EventTypeSpec {
  /** Quién puede publicarlo. */
  by: SimActor[];
  /** Quién se despierta cuando aparece. */
  wakes: SimRole[];
  visibility: 'user' | 'internal';
  description: string;
}

/**
 * Catálogo cerrado de tipos de evento. Define el "cableado" de la
 * orquestación: quién publica cada cosa y a quién despierta.
 */
export const EVENT_TYPES: Record<string, EventTypeSpec> = {
  // ---- sistema
  'sim.status': {
    by: ['system'],
    wakes: [],
    visibility: 'user',
    description: 'Cambio de fase de la simulación',
  },
  'deploy.progress': {
    by: ['system'],
    wakes: [],
    visibility: 'internal',
    description: 'Progreso del deploy (desde el servicio de deploy)',
  },
  'deploy.ready': {
    by: ['system'],
    wakes: ['infra', 'observer'],
    visibility: 'internal',
    description: 'La app quedó arriba por primera vez',
  },
  'deploy.failed': {
    by: ['system'],
    wakes: ['infra', 'observer'],
    visibility: 'internal',
    description: 'El deploy inicial falló',
  },

  // ---- control del atacante (contrato con el motor de hacking)
  'control.start': {
    by: ['user', 'system'],
    wakes: ['hacker', 'observer'],
    visibility: 'internal',
    description: 'Parte el ataque',
  },
  'control.next': {
    by: ['user', 'observer'],
    wakes: ['hacker'],
    visibility: 'internal',
    description: 'Atacar la siguiente vuln (raw.vuln_id opcional)',
  },
  'control.pause': {
    by: ['user', 'observer'],
    wakes: ['hacker'],
    visibility: 'internal',
    description: 'Detener el ataque',
  },
  'control.resume': {
    by: ['user', 'observer'],
    wakes: ['hacker'],
    visibility: 'internal',
    description: 'Reanudar el ataque',
  },
  'control.finish': {
    by: ['user'],
    wakes: ['observer'],
    visibility: 'internal',
    description:
      'El developer pide terminar: el observador cierra con el debrief',
  },
  'control.verify': {
    by: ['user', 'observer'],
    wakes: ['hacker'],
    visibility: 'internal',
    description:
      '¿Sigue siendo explotable vuln_id? ¿El atacante sigue adentro?',
  },

  // ---- motor de hacking (emulado o real)
  'attack.plan': {
    by: ['hacker'],
    wakes: ['observer'],
    visibility: 'internal',
    description: 'Hallazgos ordenados (formato del analizador §6.2)',
  },
  'attack.step': {
    by: ['hacker'],
    wakes: ['observer', 'generator'],
    visibility: 'internal',
    description: 'Paso del ataque (reconocimiento, intento…)',
  },
  'attack.success': {
    by: ['hacker'],
    wakes: ['observer', 'generator'],
    visibility: 'internal',
    description: 'El atacante logró algo (acceso, datos, privilegios)',
  },
  'attack.blocked': {
    by: ['hacker'],
    wakes: ['observer', 'generator'],
    visibility: 'internal',
    description: 'Un intento falló por una defensa',
  },
  'attack.verify': {
    by: ['hacker'],
    wakes: ['observer'],
    visibility: 'internal',
    description: 'Resultado de control.verify',
  },
  'attack.done': {
    by: ['hacker'],
    wakes: ['observer'],
    visibility: 'internal',
    description: 'El atacante terminó con la vuln actual / con todo',
  },

  // ---- observador (estado del incidente + director)
  'state.update': {
    by: ['observer'],
    wakes: ['generator'],
    visibility: 'internal',
    description: 'Nuevo estado del incidente (raw = IncidentState)',
  },
  'sim.finished': {
    by: ['observer'],
    wakes: [],
    visibility: 'user',
    description: 'Fin de la simulación (raw.debrief)',
  },

  // ---- generador de eventos (lo que ve el developer)
  notify: {
    by: ['generator'],
    wakes: [],
    visibility: 'user',
    description: 'Notificación simulada (raw.channel, raw.from…)',
  },

  // ---- developer y su agente de código
  'user.message': {
    by: ['user'],
    wakes: ['coder'],
    visibility: 'user',
    description: 'El developer le escribe a su agente de código',
  },
  'user.action': {
    by: ['user'],
    wakes: ['observer'],
    visibility: 'user',
    description: 'Acción rápida del developer (botón)',
  },
  'coder.reply': {
    by: ['coder'],
    wakes: [],
    visibility: 'user',
    description: 'Respuesta del agente de código al developer',
  },
  'change.commit': {
    by: ['system'],
    wakes: ['observer'],
    visibility: 'user',
    description: 'Se commiteó un cambio de código al mirror',
  },
  'change.env': {
    by: ['system'],
    wakes: ['observer'],
    visibility: 'user',
    description: 'Cambio de variables de entorno',
  },
  'change.restart': {
    by: ['system'],
    wakes: ['observer'],
    visibility: 'user',
    description: 'Reinicio del servicio',
  },
  'change.db': {
    by: ['system'],
    wakes: ['observer'],
    visibility: 'user',
    description: 'Cambio de datos en la base',
  },
  'change.deployed': {
    by: ['system'],
    wakes: ['observer', 'coder'],
    visibility: 'user',
    description: 'Un cambio quedó desplegado',
  },
  'change.deploy_failed': {
    by: ['system'],
    wakes: ['observer', 'coder'],
    visibility: 'user',
    description: 'Un redeploy falló (sigue la versión anterior)',
  },

  // ---- infra
  'context.ready': {
    by: ['infra'],
    // El hacker no: arma su plan desde el código y despertarlo acá gastaba un turno sin hacer nada.
    wakes: ['observer', 'generator'],
    visibility: 'internal',
    description: 'Paquete de contexto del repo (raw = SimContext)',
  },
  'infra.request': {
    by: ['coder', 'observer'],
    wakes: ['infra'],
    visibility: 'internal',
    description: 'Pedido de cambio de arquitectura',
  },
  'infra.reply': {
    by: ['infra'],
    wakes: ['coder', 'observer'],
    visibility: 'internal',
    description: 'Resultado de un pedido de infra',
  },

  // ---- cualquiera
  'agent.note': {
    by: [
      ...(['infra', 'hacker', 'observer', 'generator', 'coder'] as SimRole[]),
    ],
    wakes: [],
    visibility: 'internal',
    description: 'Nota libre de un agente',
  },
};

export function canPost(actor: SimActor, type: string): boolean {
  return EVENT_TYPES[type]?.by.includes(actor) ?? false;
}

/** Paquete de contexto que arma el thread infra al inicio. */
export interface SimContext {
  summary: string;
  stack?: string;
  /** Herramientas detectadas en el repo. La fuente de verdad es SimulationRecord.tools_detected. */
  tools_detected?: string[];
  /** Personas ficticias (clientes, usuarios seed) para las historias. */
  personas?: Array<{
    name: string;
    email?: string;
    role?: string;
    notes?: string;
  }>;
  notes?: string;
  [k: string]: unknown;
}

/** Estado del incidente. Lo escribe el observador (raw de `state.update`). */
export interface IncidentState {
  phase: string;
  attacker_active: boolean;
  current_vuln: string | null;
  vulns: Record<string, { status: string; note?: string }>;
  compromised: string[];
  assessments: Array<{ action: string; verdict: string; why: string }>;
  summary?: string;
  [k: string]: unknown;
}

/**
 * conductor: thread (sesión de Claude Code) en el workspace de Conductor de la simulación.
 * api: corre dentro del backend (SimulationBrain) con llamadas directas a la API de Claude.
 * external: lo opera un servicio externo vía HTTP (motor de hacking real).
 */
export type SimThreadMode = 'conductor' | 'api' | 'external';

export interface SimThread {
  role: SimRole;
  mode: SimThreadMode;
  session_id?: string;
  deep_link?: string;
  /** Último seq entregado a este thread. */
  cursor: number;
  last_wake_at?: string;
  wakes: number;
  create_error?: string;
  /** Solo mode=api: modelo usado, duración y error de la última llamada. */
  model?: string;
  last_ms?: number;
  last_error?: string;
}

export interface SimulationRecord {
  sim_id: string;
  sandbox_id: string;
  repo_url: string;
  status: SimStatus;
  error?: string;
  created_at: string;
  updated_at: string;

  /**
   * Herramientas con evidencia de setup en el código (tools-detector.ts). Define
   * los canales de la simulación; el developer no las elige. undefined = aún no se escanea.
   */
  tools_detected?: string[];
  hacker_mode: 'emulated' | 'external';

  workspace_id?: string;
  workspace_link?: string;
  threads: SimThread[];

  context?: SimContext;
  attack_plan?: Record<string, unknown>;
  state?: IncidentState;
  debrief?: Record<string, unknown>;

  /** Cuándo quedó arriba la app por primera vez. */
  deploy_ready_at?: string;
  /** Último status del sandbox observado (para detectar transiciones). */
  sandbox_status?: string;
  sandbox_commit?: string;
  next_seq: number;
  timeline: TimelineEvent[];
}
