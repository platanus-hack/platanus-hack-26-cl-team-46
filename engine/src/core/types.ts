/**
 * Modelo de datos del motor de hacking.
 *
 * El motor hace una pasada de diagnóstico REAL contra una app controlada y
 * autorizada: valida qué vulnerabilidades existen, captura el paso a paso de
 * cada ataque (telemetría) y produce escenarios preconfigurados, versionados y
 * con seed para que el simulador los reproduzca. No ataca nada fuera del target.
 */

export type VulnSeverity = 'low' | 'medium' | 'high' | 'critical';

/** Severidad en el formato de eventos del backend (simulation.types.ts). */
export type EventSeverity = 'info' | 'warning' | 'critical';

/** Una interacción HTTP capturada: la evidencia cruda del ataque. */
export interface HttpExchange {
  at: string; // ISO
  method: string;
  /** path + query, lo que se vería en un log de acceso. */
  path: string;
  url: string;
  reqHeaders?: Record<string, string>;
  reqBody?: unknown;
  status: number;
  resHeaders?: Record<string, string>;
  /** Cuerpo de respuesta, truncado para que la evidencia no explote. */
  resBodyExcerpt: string;
  durationMs: number;
}

/** Un paso del ataque, pensado para el storytelling y el debrief. */
export interface AttackStep {
  /** Técnica legible: "Fuerza bruta de credenciales", "UNION-based SQLi"… */
  technique: string;
  /** IDs de MITRE ATT&CK relevantes (p. ej. "T1110.001"). */
  mitre?: string[];
  /** Resumen del request, estilo log: "GET /api/notes/3". */
  request: string;
  response_summary: string;
  /** Evidencia cruda de este paso. */
  exchange?: HttpExchange;
  note?: string;
}

export interface Foothold {
  type: 'jwt' | 'account' | 'admin' | 'data' | 'db';
  detail: string;
}

export interface Exfil {
  table: string;
  rows: number;
  /** Muestra acotada y, cuando aplica, ya ofuscada. */
  sample?: unknown;
}

/** Resultado de ejecutar un ataque real contra el target. */
export interface AttackResult {
  vuln_id: string;
  /** ¿Se confirmó la vulnerabilidad con evidencia real? */
  confirmed: boolean;
  /** true si una defensa frenó el intento (rate limit, authz, etc.). */
  blocked: boolean;
  steps: AttackStep[];
  gained: string[];
  foothold?: Foothold;
  data_exfiltrated?: Exfil;
  /** ¿El atacante queda con acceso vivo tras este ataque? */
  attacker_active: boolean;
  summary: string;
  /** Si el módulo falló por un error de ejecución (no por una defensa). */
  error?: string;
  /** Variante usada (si el módulo tiene varias estrategias, requisito F). */
  variant_used?: string;
  variants_tried?: Array<{ id: string; confirmed: boolean; confidence: number }>;
  /** Confianza 0..1 de la variante que confirmó. */
  confidence?: number;
}

/** Conocimiento estático por vulnerabilidad: lo que alimenta la enseñanza. */
export interface VulnMeta {
  id: string;
  title: string;
  severity: VulnSeverity;
  /** 1 (trivial) a 5 (difícil). */
  difficulty: number;
  /** Orden sugerido en el storytelling. */
  order: number;
  cwe: string[];
  owasp: string[];
  /** ATT&CK: pares "id — nombre". */
  mitre_attack: string[];
  /** ATLAS (ataques a sistemas de IA), cuando aplica. */
  mitre_atlas?: string[];
  /** Contramedidas D3FEND, legibles. */
  d3fend: string[];
  /** Dónde vive en el código víctima. */
  code_location: string;
  /** Caso real conocido (para el debrief). */
  real_case: string;
  /** Arreglo correcto. */
  fix_correct: string;
  /** Arreglos equivocados comunes (clave para el simulador). */
  fix_wrong: string[];
  /** La lección en una frase. */
  teaching: string;
}

/** Un "beat" del guion: qué pasa y cómo se percibe. */
export interface StorylineBeat {
  phase: 'recon' | 'exploit' | 'impact' | 'persistence';
  /** Qué hizo el atacante, en lenguaje técnico. */
  fact: string;
  /** Canal por el que el developer se enteraría (email, sentry, datadog…). */
  channel: string;
  /** Síntoma observable que vería el developer (sin spoilear la causa). */
  symptom: string;
}

/** Escenario preconfigurado, versionado y reproducible (el "guión"). */
export interface Scenario {
  scenario_id: string;
  /** Versión del guion + seed para reproducibilidad. */
  version: string;
  seed: string;
  vuln_id: string;
  title: string;
  meta: VulnMeta;
  /** Dónde empieza el ataque. */
  entry_point: string;
  /** El ataque real grabado (la fuente de verdad del replay). */
  attack: AttackResult;
  /** Beats para el narrador/generador. */
  storyline: StorylineBeat[];
  /** Cómo se evalúa al developer. */
  success_criteria: {
    detected: string;
    contained: string;
    /** Acciones que NO contienen al atacante (trampas del simulador). */
    traps: string[];
  };
  created_at: string;
  target: { url: string; commit?: string };
}

/** Configuración del target que el motor ataca. */
export interface TargetConfig {
  /** URL base del sandbox desplegado. */
  url: string;
  commit?: string;
  /** Usuarios seed conocidos (del contrato /sim/:id o de config). */
  seed_users: Array<{ email: string; password?: string; role?: string }>;
  /** Credencial débil conocida para la demo de fuerza bruta (si la hay). */
  weak_login?: { email: string; password: string };
  /** Rutas para los módulos destructivos (opcionales; defaults razonables). */
  dos_path?: string; // endpoint a estresar (default '/')
  ssrf_path?: string; // endpoint que hace fetch de una URL del usuario (default '/fetch')
  chat_path?: string; // endpoint LLM para prompt injection (default '/chat')
  redirect_path?: string; // endpoint de redirect para phishing (default '/go')
  /** Endpoint autenticado para re-testear un token robado (default '/api/users/me'). */
  whoami_path?: string;
}

/** Contexto que recibe cada módulo de ataque. */
export interface AttackContext {
  target: TargetConfig;
  /** Cliente HTTP que graba cada intercambio (con scope guard y saneamiento). */
  http: import('./http.ts').RecordingClient;
  /** IP/UA simulados del atacante, para la narrativa y los logs. */
  attacker: { ip: string; userAgent: string };
  /** PRNG seeded: toda la aleatoriedad controlable pasa por aquí. */
  rng: import('./rng.ts').RNG;
  /** Reloj inyectable. */
  clock: import('./rng.ts').Clock;
  /** Registro de recursos creados, para el teardown. */
  tracker: import('./tracker.ts').ResourceTracker;
  /** Footholds del atacante, persistentes entre ataques/verificaciones. */
  footholds: import('./footholds.ts').FootholdStore;
  log: (msg: string) => void;
}

/** Metadata para el scheduler (requisito B): cómo se secuencia este ataque. */
export interface SchedulingMeta {
  /** vuln_ids que deben completar antes (foothold, señal, etc.). */
  dependsOn?: string[];
  /** No correr en paralelo con estos vuln_ids (contaminan señales / alarma). */
  mutex?: string[];
  /** Debe correr sobre un estado/limpio, antes de ensuciar señales. */
  needsCleanBaseline?: boolean;
  /** Huella de alarma: cuánto ruido deja (para decidir secuenciación). */
  alarmFootprint?: 'low' | 'medium' | 'high';
  /** Requisitos (credenciales/capacidades). */
  requires?: string[];
}

export interface Attack {
  meta: VulnMeta;
  /** true si crea/modifica estado en el target (cuentas, notas, roles). */
  mutating: boolean;
  /** true si genera daño real (DoS, etc.): solo corre en modo --destructive y
   *  contra un contenedor desechable autorizado. */
  destructive?: boolean;
  /** Metadata de scheduling (si falta, se asume independiente y paralelizable). */
  scheduling?: SchedulingMeta;
  /** Ejecuta el ataque real y devuelve el resultado con evidencia. */
  run(ctx: AttackContext): Promise<AttackResult>;
}

/** Ruta candidata para la enumeración de superficie (recon). */
export interface CandidateRoute {
  path: string;
  sensitive?: boolean;
  adminOnly?: boolean;
}

/**
 * Contrato de plugin: todo lo específico de una app víctima. El core (core/*)
 * no importa plugins; recibe el plugin por parámetro. Así el motor se extiende a
 * otra app agregando un EnginePlugin, sin tocar el core.
 */
export interface EnginePlugin {
  id: string;
  /** Prefijo del scenario_id (p. ej. "apuntes"). */
  scenarioNamespace: string;
  /** Conocimiento de enseñanza por vuln. */
  catalog: Record<string, VulnMeta>;
  /** Módulos de ataque, en el orden sugerido del storytelling. */
  attacks: Attack[];
  /** Rutas candidatas para el recon. */
  reconCandidates: CandidateRoute[];
  /** Beats de storytelling por vuln. */
  storylines: Record<string, StorylineBeat[]>;
}
