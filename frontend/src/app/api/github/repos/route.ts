import { NextResponse, type NextRequest } from "next/server";
import { githubWithToken, TOKEN_COOKIE } from "@/lib/github-oauth";

/**
 * GET /api/github/repos → repos públicos del usuario logueado: los suyos y los de sus orgs.
 * Con token, GitHub nos da 5.000 consultas/hora (sin login son 60).
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(TOKEN_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: "No has entrado con GitHub." }, { status: 401 });

  const res = await githubWithToken(
    token,
    "/user/repos?visibility=public&affiliation=owner,organization_member&sort=pushed&per_page=100",
  ).catch(() => null);
  if (!res) return NextResponse.json({ message: "No pudimos hablar con GitHub." }, { status: 502 });
  if (!res.ok) return NextResponse.json({ message: `GitHub respondió ${res.status}.` }, { status: res.status });
  return NextResponse.json(await res.json());
}
