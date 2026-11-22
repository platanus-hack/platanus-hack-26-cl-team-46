/**
 * El proveedor de agentes no se nombra en nada que llegue al usuario (pantalla o API pública).
 * Esto limpia textos que ya quedaron guardados con su nombre (eventos viejos, errores, resúmenes
 * del agente) y saca los ids y links del proveedor de los `raw` de los eventos.
 */
const PROVIDER_KEYS = new Set([
  'workspace_id',
  'session_id',
  'deep_link',
  'workspace_link',
]);

export function scrubProviderText(text: string): string;
export function scrubProviderText(
  text: string | null | undefined,
): string | null | undefined;
export function scrubProviderText(text: string | null | undefined) {
  if (!text || !/conductor|\bVMs?\b|workspace/i.test(text)) return text;
  // Respeta la mayúscula inicial del texto original ("Una VM…" → "Un agente…").
  const sub = (re: RegExp, to: string) => (t: string) =>
    t.replace(re, (m) =>
      m[0] === m[0].toUpperCase() && m[0] !== m[0].toLowerCase()
        ? to[0].toUpperCase() + to.slice(1)
        : to,
    );
  return [
    sub(/conductor:\/\/\S+/gi, ''),
    sub(/\b(una|la) VM de Conductor\b/gi, 'un agente de IA'),
    sub(/\b(el|un) workspace de Conductor\b/gi, 'el entorno de los agentes'),
    sub(/\bla VM del agente\b/gi, 'el entorno del agente'),
    sub(/\bConductor\b/gi, 'el servicio de agentes'),
    sub(/\bVMs?\b/g, 'entorno'),
    sub(/\bworkspace\b/gi, 'entorno'),
  ]
    .reduce((t, f) => f(t), text)
    .trim();
}

/** Copia de `raw` sin ids/links del proveedor y con los textos limpios. */
export function scrubProviderRaw(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (PROVIDER_KEYS.has(k)) continue;
    out[k] = typeof v === 'string' ? scrubProviderText(v) : v;
  }
  return out;
}
