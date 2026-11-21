/**
 * Lee tokens de mayday-tokens.css en runtime, para lo que se pinta en <canvas>
 * (el canvas no entiende clases de Tailwind). Así nunca hay hex sueltos en componentes.
 */
export function readToken(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}

/** Tokens en px (`pixel-lg` → 32). */
export function readPx(name: string): number {
  return parseFloat(readToken(name)) || 0;
}
