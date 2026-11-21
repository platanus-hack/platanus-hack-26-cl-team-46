import { NextResponse, type NextRequest } from "next/server";
import { githubWithToken, oauthConfig, TOKEN_COOKIE } from "@/lib/github-oauth";

/**
 * GET /api/auth/me → { oauth, user }.
 * oauth: si el login con GitHub está configurado. user: el perfil público, o null.
 */
export async function GET(req: NextRequest) {
  const oauth = oauthConfig() !== null;
  const token = req.cookies.get(TOKEN_COOKIE)?.value;
  if (!oauth || !token) return NextResponse.json({ oauth, user: null });

  const res = await githubWithToken(token, "/user").catch(() => null);
  if (!res?.ok) {
    // Token revocado o vencido: limpiamos la cookie.
    const out = NextResponse.json({ oauth, user: null });
    if (res?.status === 401) out.cookies.delete(TOKEN_COOKIE);
    return out;
  }
  const u = (await res.json()) as { login: string; name: string | null; avatar_url: string; public_repos: number };
  return NextResponse.json({
    oauth,
    user: { login: u.login, name: u.name, avatar_url: u.avatar_url, public_repos: u.public_repos },
  });
}
