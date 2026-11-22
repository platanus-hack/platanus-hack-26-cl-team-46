/**
 * Prompt y parser compartidos para la generación de ProbeSpecs (structured
 * output). El LLM emite DATOS (no código); el gate (dual/probe-spec.ts) valida
 * scope/schema antes de ejecutar, así que no se confía en la autolimitación.
 */
import type { ProbeSpec } from './types.ts';

export const PROBE_SYSTEM = `Eres un generador de pruebas de seguridad para un sandbox AUTORIZADO y controlado.
A partir del modelo del repo (rutas + señales) y de los ángulos propuestos, generas "ProbeSpecs":
pruebas DECLARATIVAS (datos, NO código) que un motor confiable ejecuta.

Reglas ESTRICTAS (si no se cumplen, el probe será rechazado):
- "path" es relativo y empieza con "/". NUNCA uses URLs absolutas (http://...), en especial fuera del host autorizado.
- "method" ∈ GET | POST | PATCH | PUT | DELETE.
- "success" con al menos UNA condición: status_eq (int) | status_gte (int) | body_matches (regex) | reflects_query (clave de query que debe reflejarse sin escapar en HTML).
- "needs_auth": true si el endpoint requiere sesión.

Responde SOLO un array JSON (máx 8) de ProbeSpec:
{ "id": "...", "vuln_class": "...", "method": "GET", "path": "/...", "query": {}, "body": {}, "needs_auth": false, "success": { }, "note": "..." }`;

const METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);

export function parseProbeSpecs(text: string): ProbeSpec[] {
  let arr: unknown;
  try {
    arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: ProbeSpec[] = [];
  for (const raw of arr) {
    const s = raw as Partial<ProbeSpec>;
    const method = String(s.method ?? '').toUpperCase();
    if (!s.id || !s.vuln_class || typeof s.path !== 'string' || !METHODS.has(method) || !s.success || typeof s.success !== 'object') continue;
    out.push({
      id: String(s.id), vuln_class: String(s.vuln_class), method: method as ProbeSpec['method'], path: s.path,
      query: s.query && typeof s.query === 'object' ? (s.query as Record<string, string>) : undefined,
      body: s.body && typeof s.body === 'object' ? (s.body as Record<string, unknown>) : undefined,
      needs_auth: !!s.needs_auth, success: s.success as ProbeSpec['success'], note: s.note ? String(s.note) : undefined,
    });
  }
  return out;
}
