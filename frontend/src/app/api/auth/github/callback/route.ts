import { NextResponse, type NextRequest } from "next/server";
import {
  appOrigin,
  callbackUrl,
  cookieOptions,
  oauthConfig,
  STATE_COOKIE,
  TOKEN_COOKIE,
  TOKEN_MAX_AGE,
} from "@/lib/github-oauth";

/** GET /api/auth/github/callback → cambia el code por un token y lo deja en una cookie httpOnly. */
export async function GET(req: NextRequest) {
  const origin = appOrigin(req);
  const fail = (reason: string) => {
    const res = NextResponse.redirect(`${origin}/start/github?error=${reason}`);
    res.cookies.delete(STATE_COOKIE);
    return res;
  };

  const config = oauthConfig();
  if (!config) return fail("not_configured");

  const params = req.nextUrl.searchParams;
  // El usuario apretó "Cancel" en GitHub.
  if (params.get("error")) return fail("denied");

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || state !== req.cookies.get(STATE_COOKIE)?.value) return fail("state");

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: callbackUrl(req),
    }),
    cache: "no-store",
  }).catch(() => null);
  const body = (await tokenRes?.json().catch(() => null)) as { access_token?: string } | null;
  if (!body?.access_token) return fail("exchange");

  const res = NextResponse.redirect(`${origin}/start/repos`);
  res.cookies.set(TOKEN_COOKIE, body.access_token, cookieOptions(TOKEN_MAX_AGE));
  res.cookies.delete(STATE_COOKIE);
  return res;
}
