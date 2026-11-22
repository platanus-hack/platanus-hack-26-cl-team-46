import { BadRequestException } from '@nestjs/common';

/** Dueño o repo de GitHub: sin `%`, `/`, espacios ni nada que git pueda reinterpretar. */
const SEGMENT = /^[A-Za-z0-9_.-]+$/;
/** Solo `https://github.com/{dueño}/{repo}` (con `.git` o `/` final opcionales). Sin query, fragmento, puerto ni usuario. */
const GITHUB_REPO_URL =
  /^https:\/\/github\.com\/([^/?#\s]+)\/([^/?#\s]+?)(?:\.git)?\/*$/i;

export const GITHUB_URL_HINT =
  'repo_url debe ser https://github.com/dueño/repo';

/**
 * Lee una URL de repo de GitHub de forma estricta. Todo lo que no tenga la
 * forma exacta devuelve null: así nadie esconde un mirror (`%73bx-…`) ni
 * otro host detrás de una URL rara.
 */
export function parseGitHubRepoUrl(
  repoUrl: string,
): { owner: string; repo: string } | null {
  const m = GITHUB_REPO_URL.exec(repoUrl.trim());
  if (!m) return null;
  const [, owner, repo] = m;
  for (const part of [owner, repo]) {
    if (!SEGMENT.test(part) || /^\.+$/.test(part)) return null;
  }
  return { owner, repo };
}

/** `https://github.com/{dueño}/{repo}` canónica, o 400 si la URL no es de un repo de GitHub. */
export function canonicalGitHubUrl(repoUrl: string): string {
  const parsed = parseGitHubRepoUrl(repoUrl);
  if (!parsed) throw new BadRequestException(GITHUB_URL_HINT);
  return `https://github.com/${parsed.owner}/${parsed.repo}`;
}
