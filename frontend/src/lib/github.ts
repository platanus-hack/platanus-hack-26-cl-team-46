/**
 * Tipos y utilidades de GitHub para el onboarding.
 * El login y la lista de repos viven en el backend (GitHub App, backend/src/auth):
 * ver src/lib/onboarding.ts.
 */

/** Repo de ejemplo deliberadamente inseguro (ver docs/victim). */
export const DEMO_REPO = {
  full_name: "hack26-sandboxes/apuntes",
  html_url: "https://github.com/hack26-sandboxes/apuntes",
  description: "App de notas en Express + Postgres. Viene con vulnerabilidades plantadas.",
  language: "TypeScript",
} as const;

/** Repo que el usuario compartió con Mayday (GET /auth/repos). */
export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  pushed_at: string | null;
  fork: boolean;
  archived: boolean;
  /** KB. 0 = repo vacío (no hay nada que desplegar). */
  size: number;
  private: boolean;
}

/** "hace 3 días", "hace 2 meses"… */
export function timeAgo(iso: string | null): string {
  if (!iso) return "sin commits";
  const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) {
    if (Math.abs(diff) >= secs) return rtf.format(Math.round(diff / secs), unit);
  }
  return "recién";
}
