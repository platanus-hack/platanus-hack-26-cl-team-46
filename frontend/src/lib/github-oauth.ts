import type { NextRequest } from "next/server";

/**
 * Login con GitHub (OAuth App), del lado del servidor de Next.
 *
 * - Sin scopes: GitHub solo nos da el perfil público y lo que ya es público.
 *   Nada de escritura ni repos privados ("Solo lectura. Nunca te pedimos tus claves").
 * - El token vive en una cookie httpOnly: el JavaScript del navegador nunca lo ve.
 * - Una OAuth App no pasa por revisión de GitHub: se crea en
 *   Settings → Developer settings → OAuth Apps y funciona al tiro.
 *
 * Env (solo servidor, se leen en runtime): GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
 * y, opcional, PUBLIC_APP_URL (ej. https://mayday.rip) para armar el callback.
 */

export const TOKEN_COOKIE = "mayday_gh";
export const STATE_COOKIE = "mayday_gh_state";
const WEEK = 60 * 60 * 24 * 7;

export function oauthConfig() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Origen público de la app. Detrás del proxy de Render, request.url no siempre lo es. */
export function appOrigin(req: NextRequest) {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  return host ? `${proto}://${host}` : req.nextUrl.origin;
}

export const callbackUrl = (req: NextRequest) => `${appOrigin(req)}/api/auth/github/callback`;

export const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  // lax: la cookie viaja en la navegación de vuelta desde github.com.
  sameSite: "lax" as const,
  path: "/",
  maxAge,
});
export const TOKEN_MAX_AGE = WEEK;
export const STATE_MAX_AGE = 60 * 10;

/** Llama a la API de GitHub con el token del usuario. */
export async function githubWithToken(token: string, path: string) {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });
}
