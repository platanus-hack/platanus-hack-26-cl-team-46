/**
 * Los agentes de Conductor corren en VMs que pueden ver credenciales del backend
 * (CONDUCTOR_API_KEY no se puede tapar). Antes de guardar en el timeline lo que
 * escriben, se tapan los valores literales de esas variables.
 */

/** Variables del backend cuyo valor nunca debe quedar en el timeline. */
export const SENSITIVE_ENV_KEYS = [
  'CONDUCTOR_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'GITHUB_TOKEN',
  'GITHUB_HACK26_ORG_TOKEN',
  'GITHUB_APP_CLIENT_SECRET',
  'SESSION_SECRET',
  'AGENT_API_SECRET',
  'RENDER_API_KEY',
  'ENGINE_MODAL_KEY',
  'ENGINE_MODAL_SECRET',
  'SANDBOX_DB_SECRET',
  'DATABASE_URL',
] as const;

export const REDACTED = '[redactado]';
/** Valores más cortos que esto no se tapan (taparían palabras comunes). */
const MIN_SECRET_LENGTH = 8;

/** Valores a tapar, del más largo al más corto (uno puede contener a otro). */
export function secretValues(get: (key: string) => unknown): string[] {
  const values = SENSITIVE_ENV_KEYS.map((k) => get(k)).filter(
    (v): v is string => typeof v === 'string' && v.length >= MIN_SECRET_LENGTH,
  );
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}

export function redactSecrets(
  text: string,
  secrets: readonly string[],
): string {
  let out = text;
  for (const s of secrets)
    if (out.includes(s)) out = out.split(s).join(REDACTED);
  return out;
}

/** Igual que redactSecrets, recorriendo objetos y arreglos (el `raw` de un evento). */
export function redactDeep<T>(value: T, secrets: readonly string[]): T {
  if (!secrets.length) return value;
  if (typeof value === 'string') return redactSecrets(value, secrets) as T;
  if (Array.isArray(value))
    return value.map((v: unknown) => redactDeep(v, secrets)) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactDeep(v, secrets)]),
    ) as T;
  return value;
}
