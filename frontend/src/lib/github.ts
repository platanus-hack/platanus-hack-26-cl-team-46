/**
 * Cliente mínimo de la API pública de GitHub (sin token).
 *
 * Por ahora Mayday solo trabaja con repos públicos, así que "conectar GitHub" es
 * decirnos tu usuario: listamos tus repos públicos desde el navegador. Sin OAuth,
 * sin permisos y sin claves. El límite anónimo es de 60 requests/hora por IP, y
 * como cada usuario llama desde su navegador, no lo compartimos entre usuarios.
 *
 * Si más adelante se agrega OAuth, solo cambia este archivo (y el hook de conexión).
 */

const GITHUB_API = "https://api.github.com";

/** Repo de ejemplo deliberadamente inseguro (ver docs/victim). */
export const DEMO_REPO = {
  full_name: "hack26-sandboxes/apuntes",
  html_url: "https://github.com/hack26-sandboxes/apuntes",
  description: "App de notas en Express + Postgres. Viene con vulnerabilidades plantadas.",
  language: "TypeScript",
} as const;

export interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  public_repos: number;
  html_url: string;
}

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

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly kind: "not_found" | "rate_limited" | "network" | "unknown",
  ) {
    super(message);
  }
}

/** Lo que puede escribir el usuario: `usuario`, `@usuario`, una URL de perfil o de repo, o `dueño/repo`. */
export type GitHubTarget = { kind: "user"; login: string } | { kind: "repo"; owner: string; repo: string };

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

export function parseGitHubInput(raw: string): GitHubTarget | null {
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/^@/, "");
  s = s.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\/?/i, "");
  s = s.replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/\.git$/, "");

  // Acepta URLs más profundas (…/tree/main/src) quedándose con dueño/repo.
  const [owner, repo] = s.split("/");
  if (!owner || !LOGIN.test(owner)) return null;
  if (!repo) return { kind: "user", login: owner };
  return REPO.test(repo) ? { kind: "repo", owner, repo } : null;
}

async function gh<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${GITHUB_API}${path}`, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
  } catch {
    throw new GitHubError("No pudimos hablar con GitHub. Revisa tu conexión.", "network");
  }
  if (res.ok) return (await res.json()) as T;
  if (res.status === 404) throw new GitHubError("No existe en GitHub, o no es público.", "not_found");
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const minutes = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : null;
    throw new GitHubError(
      `GitHub nos pidió una pausa (límite de consultas sin login).${minutes ? ` Intenta en ${minutes} min.` : ""}`,
      "rate_limited",
    );
  }
  throw new GitHubError(`GitHub respondió ${res.status}.`, "unknown");
}

export const github = {
  getUser: (login: string) => gh<GitHubUser>(`/users/${encodeURIComponent(login)}`),
  getRepo: (owner: string, repo: string) =>
    gh<GitHubRepo>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`),
  /** Repos públicos propios, los más recientes primero (hasta 100: de sobra para elegir uno). */
  listRepos: (login: string) =>
    gh<GitHubRepo[]>(`/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&per_page=100`),
};

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
