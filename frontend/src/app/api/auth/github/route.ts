import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { appOrigin, callbackUrl, cookieOptions, oauthConfig, STATE_COOKIE, STATE_MAX_AGE } from "@/lib/github-oauth";

/** GET /api/auth/github → redirige a GitHub para autorizar (sin scopes: solo datos públicos). */
export async function GET(req: NextRequest) {
  const config = oauthConfig();
  if (!config) return NextResponse.redirect(`${appOrigin(req)}/start/github?error=not_configured`);

  // state contra CSRF: lo guardamos en una cookie y GitHub nos lo devuelve en el callback.
  const state = randomBytes(16).toString("hex");
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", callbackUrl(req));
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "true");

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, cookieOptions(STATE_MAX_AGE));
  return res;
}
