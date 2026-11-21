import { NextResponse } from "next/server";
import { TOKEN_COOKIE } from "@/lib/github-oauth";

/** POST /api/auth/logout → borra la sesión de GitHub. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(TOKEN_COOKIE);
  return res;
}
