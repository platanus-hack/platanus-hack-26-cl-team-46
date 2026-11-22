/**
 * Cliente HTTP único del frontend: toda llamada al backend pasa por `request()`.
 * - Manda la cookie de sesión (credentials: include): el backend vive en otro subdominio.
 * - Content-Type JSON solo si hay body: un GET sin headers extra no dispara el preflight de CORS.
 * - Revisa `res.ok` antes de parsear y solo parsea JSON si la respuesta dice ser JSON
 *   (un 502 en HTML del proxy ya no termina en "Unexpected token '<'").
 * - Los errores HTTP salen como `HttpError`, con el status y un mensaje legible.
 *   Los de red se dejan pasar tal cual (TypeError de fetch): hay pantallas que los distinguen.
 * El 401 → login no va acá: lo agrega `apiRequest` (api.ts) solo donde corresponde.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class HttpError extends Error {
  readonly status: number;
  /** Body de la respuesta, si era JSON. */
  readonly body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

/** `path` relativo al backend (`/sandboxes`) o URL completa. */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body != null && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(/^https?:\/\//.test(path) ? path : `${API_URL}${path}`, {
    ...init,
    credentials: init.credentials ?? "include",
    headers,
  });
  const json = (res.headers.get("content-type") ?? "").includes("json");

  if (!res.ok) {
    const body = json ? await res.json().catch(() => undefined) : undefined;
    throw new HttpError(res.status, errorMessage(res.status, body), body);
  }
  const text = await res.text();
  // 204 o sin body: no hay nada que parsear.
  if (!text) return undefined as T;
  if (!json) throw new HttpError(res.status, `Respuesta inesperada del servidor (HTTP ${res.status}, no es JSON)`);
  return JSON.parse(text) as T;
}

/** Mensaje para mostrar: el `message` de Nest (string o lista de validación) o uno genérico por status. */
function errorMessage(status: number, body: unknown): string {
  const msg = (body as { message?: unknown } | undefined)?.message;
  if (Array.isArray(msg)) {
    const parts = msg.map((m) => (typeof m === "string" ? m : ((m as { message?: string })?.message ?? JSON.stringify(m))));
    if (parts.length) return parts.join(", ");
  }
  if (typeof msg === "string" && msg.trim()) return msg;
  if (status >= 500) return `El servidor no respondió bien (HTTP ${status}). Intenta de nuevo en un momento.`;
  return `HTTP ${status}`;
}
