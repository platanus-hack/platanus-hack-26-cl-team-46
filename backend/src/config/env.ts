import { z } from 'zod';

const effortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);

/**
 * Variables de entorno del backend. Se validan al arrancar: si falta algo
 * obligatorio, la app no levanta y dice qué falta.
 */
export const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  DATA_DIR: z.string().default('.data'),
  /** Si está, el estado de los sandboxes se guarda en Postgres (necesario en Render, donde el disco es efímero). */
  DATABASE_URL: z.string().optional(),
  /**
   * Proxy de previsualización: URL pública de la app de cada sandbox bajo un
   * dominio nuestro, con `{sandbox}` como comodín. Ej: `https://{sandbox}.preview.mayday.rip`
   * (necesita DNS wildcard apuntando a este backend). Local: `http://{sandbox}.preview.localhost:3001`.
   * Sin definir, el proxy está apagado y el frontend embebe la app directo.
   */
  PREVIEW_URL_TEMPLATE: z
    .string()
    .refine((v) => v.includes('{sandbox}'), 'Debe incluir {sandbox}')
    .optional(),

  // Render
  RENDER_API_KEY: z.string().min(1, 'RENDER_API_KEY es obligatoria'),
  /** Si no se define, se usa el primer workspace que devuelve GET /v1/owners. */
  RENDER_OWNER_ID: z.string().optional(),
  RENDER_REGION: z
    .enum(['oregon', 'ohio', 'virginia', 'frankfurt', 'singapore'])
    .default('oregon'),
  /** Plan de los web services sandbox. `free` hasta que lleguen los créditos; después `starter`. */
  RENDER_SERVICE_PLAN: z.string().default('free'),
  /**
   * `shared`: una sola instancia Postgres y una base de datos por sandbox
   * (necesario en free tier, que permite una Postgres free por workspace).
   * `dedicated`: una instancia Postgres por sandbox (requiere plan pagado).
   */
  RENDER_POSTGRES_MODE: z.enum(['shared', 'dedicated']).default('shared'),
  RENDER_POSTGRES_PLAN: z.string().default('free'),
  RENDER_POSTGRES_VERSION: z.string().default('16'),
  RENDER_SHARED_POSTGRES_NAME: z.string().default('hack26-shared-pg'),

  // GitHub: mirrors de los repos a desplegar
  /**
   * Token con permiso para crear repos y hacer push en GITHUB_ORG.
   * Sin token se despliega directo desde el repo original (solo repos
   * públicos y sin soporte para redeploy con parche).
   */
  GITHUB_TOKEN: z.string().optional(),
  /** Alias con el que el token vive en las variables de Conductor. */
  GITHUB_HACK26_ORG_TOKEN: z.string().optional(),
  GITHUB_ORG: z.string().default('hack26-sandboxes'),

  // Login con GitHub (GitHub App, src/auth). Sin las tres variables, el login queda apagado
  // y la API se comporta como antes: abierta, sin dueños (modo equipo / desarrollo).
  /** Client ID de la GitHub App (empieza con Iv…). */
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  GITHUB_APP_CLIENT_SECRET: z.string().optional(),
  /** Slug público de la app (github.com/apps/<slug>): para el link "comparte repos con Mayday". */
  GITHUB_APP_SLUG: z.string().optional(),
  /** Firma la cookie de sesión y cifra los tokens de GitHub guardados. */
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET debe tener al menos 32 caracteres')
    .optional(),
  /** Adónde vuelve el usuario después del login (default: el primer origen de CORS_ORIGIN). */
  FRONTEND_URL: z.url().optional(),
  /** Callback de OAuth (default: PUBLIC_BACKEND_URL/auth/github/callback o localhost:PORT). */
  AUTH_CALLBACK_URL: z.url().optional(),
  /** Logins de GitHub que ven todos los sandboxes y simulaciones (equipo). Separados por coma. */
  ADMIN_GITHUB_LOGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean),
    ),

  // Agente de deploy (fallback cuando el camino determinista no alcanza)
  /**
   * Secreto maestro de los endpoints /agent/*. Cada agente recibe un token
   * derivado (HMAC) que solo sirve para su propio sandbox.
   */
  AGENT_API_SECRET: z
    .string()
    .min(16, 'AGENT_API_SECRET debe tener al menos 16 caracteres')
    .optional(),
  /** URL pública del backend, a la que llaman los agentes desde sus VMs. */
  PUBLIC_BACKEND_URL: z.url().optional(),
  CONDUCTOR_API_KEY: z.string().optional(),
  CONDUCTOR_API_URL: z.url().default('https://api.conductor.build'),
  /** Proyecto de Conductor desde el que se crean las VMs de los agentes. */
  CONDUCTOR_PROJECT_ID: z
    .string()
    .default('250d6454-3b06-4b69-bc80-f0c6e7307a34'),
  CONDUCTOR_PROJECT_BRANCH: z.string().optional(),
  /**
   * Variables globales de Conductor que se tapan (con valor vacío) en las VMs
   * de los agentes. Conductor inyecta sus variables globales en todos los
   * workspaces, y los agentes leen código ajeno: no deben tener credenciales.
   * CONDUCTOR_API_KEY no se puede tapar (Conductor la fija en cada VM).
   */
  CONDUCTOR_AGENT_BLANK_ENV: z
    .string()
    .default(
      'RENDER_API_KEY,GITHUB_TOKEN,GITHUB_HACK26_ORG_TOKEN,AGENT_API_SECRET,OPENAI_API_KEY,ELEVENLABS_API_KEY,CLOUDFLARE_API_TOKEN,DATABASE_URL,GITHUB_APP_CLIENT_SECRET,SESSION_SECRET',
    )
    .transform((v) =>
      v
        .split(',')
        .map((k) => k.trim())
        .filter((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)),
    ),
  AGENT_MODEL: z.string().default('opus-5-5-1m'),
  AGENT_EFFORT: z.string().default('medium'),
  /** Máximo de planes de deploy que puede intentar un agente. */
  AGENT_MAX_PLANS: z.coerce.number().int().min(1).default(6),
  /** Archivar la VM del agente cuando termina (se puede revisar antes en Conductor). */
  AGENT_ARCHIVE_ON_FINISH: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Clicky: copiloto en pantalla (src/clicky). Sin las keys, sus rutas responden 503.
  /** Cerebro de Clicky: mira la captura y decide qué decir y qué marcar. */
  OPENAI_API_KEY: z.string().optional(),
  CLICKY_BRAIN_MODEL: z.string().default('gpt-6-luna'),
  /**
   * Cuánto razona el cerebro antes de responder. gpt-6-luna razona "medium" si no se
   * le dice nada, y eso se nota en la espera: "low" responde mucho antes y alcanza para
   * leer la pantalla. "none" es aún más rápido; "default" no manda el parámetro.
   */
  CLICKY_BRAIN_EFFORT: z
    .enum(['default', 'none', 'low', 'medium', 'high'])
    .default('low'),
  /** Voz de Clicky (texto a voz) y reconocimiento de lo que dice el usuario. */
  ELEVENLABS_API_KEY: z.string().optional(),
  /** Voz de la biblioteca de ElevenLabs. Default: "Norah" (español latino, cálida y clara). */
  CLICKY_VOICE_ID: z.string().default('kcQkGnn0HAT2JRDQ4Ljp'),
  CLICKY_TTS_MODEL: z.string().default('eleven_flash_v2_5'),
  CLICKY_TTS_FORMAT: z.string().default('mp3_22050_32'),
  /** Transcripción de respaldo (se sube el audio entero al soltar espacio). */
  CLICKY_STT_MODEL: z.string().default('scribe_v3'),
  /** Transcripción en vivo mientras el usuario habla (WebSocket con token de un solo uso). */
  CLICKY_STT_LIVE_MODEL: z.string().default('scribe_v3_live'),
  /** `true`: respuestas de ensayo, sin llamar a OpenAI ni ElevenLabs. */
  CLICKY_MOCK: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  /** Preguntas por minuto por IP. */
  CLICKY_RATE_LIMIT: z.coerce.number().int().min(1).default(20),
  /** Tope de preguntas por simulación (protege el gasto si alguien abusa). */
  CLICKY_MAX_QUESTIONS_PER_SIM: z.coerce.number().int().min(1).default(80),
  /** Tope de caracteres de voz por simulación; al pasarlo, Clicky usa la voz del navegador. */
  CLICKY_MAX_TTS_CHARS_PER_SIM: z.coerce.number().int().min(0).default(30000),

  // Simulación: roles que corren en el backend con la API de Claude (SimulationBrain)
  /** Sin key, todos los roles corren como threads de Conductor (comportamiento anterior). */
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Roles que pasan a la API si hay key. Vacío = ninguno. Solo infra, observer y generator. */
  SIM_API_ROLES: z.string().default('infra,observer,generator'),
  SIM_MODEL_CONTEXT: z.string().default('claude-haiku-5-5'),
  SIM_EFFORT_CONTEXT: effortSchema.default('low'),
  SIM_MODEL_GENERATOR: z.string().default('claude-sonnet-5-5'),
  SIM_EFFORT_GENERATOR: effortSchema.default('low'),
  SIM_MODEL_OBSERVER: z.string().default('claude-sonnet-5-5'),
  SIM_EFFORT_OBSERVER: effortSchema.default('medium'),
  SIM_MODEL_DEBRIEF: z.string().default('claude-opus-5-5'),
  SIM_EFFORT_DEBRIEF: effortSchema.default('high'),
  /** Agente de reportes: arma el reporte final de cada simulación (src/simulations/report). */
  SIM_MODEL_REPORT: z.string().default('claude-opus-5-5'),
  SIM_EFFORT_REPORT: effortSchema.default('high'),

  // Motor de hacking real en Modal (engine/modal_app.py, engine/docs/MODAL.md).
  /** URL de la API del motor (…--hack26-engine-api.modal.run). Con las tres variables, las simulaciones nuevas usan el motor real. */
  ENGINE_URL: z.url().optional(),
  /** Proxy Auth Token de Modal: Token ID (wk-…) y Token Secret (ws-…). */
  ENGINE_MODAL_KEY: z.string().optional(),
  ENGINE_MODAL_SECRET: z.string().optional(),
  /** Segundos entre pasos del atacante al repetir el ataque real en el simulacro. */
  ENGINE_REPLAY_STEP_SECONDS: z.coerce.number().min(1).default(30),
  /** Plugin del motor (catálogo de ataques). Hoy: apuntes | tasks. */
  /** auto = plugin propio si el repo es Apuntes/Tasks; si no, el genérico (cualquier app). */
  ENGINE_PLUGIN: z.string().default('auto'),
  /** Cuántas vulns se juegan antes de que el director cierre la simulación. */
  SIM_MAX_INCIDENTS: z.coerce.number().int().min(1).default(3),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuración inválida:\n${issues}`);
  }
  const env = parsed.data;
  env.GITHUB_TOKEN ??= env.GITHUB_HACK26_ORG_TOKEN;
  return env;
}

/** El fallback agéntico solo se habilita si está todo lo necesario. */
export function agentConfigProblems(env: Env): string[] {
  const missing: string[] = [];
  if (!env.AGENT_API_SECRET) missing.push('AGENT_API_SECRET');
  if (!env.PUBLIC_BACKEND_URL) missing.push('PUBLIC_BACKEND_URL');
  if (!env.CONDUCTOR_API_KEY) missing.push('CONDUCTOR_API_KEY');
  if (!env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN o GITHUB_HACK26_ORG_TOKEN');
  return missing;
}
