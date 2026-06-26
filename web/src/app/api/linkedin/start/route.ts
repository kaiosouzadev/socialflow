import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAuth } from "@/lib/api-auth";
import { getAuthorizeUrl, linkedinConfigured } from "@/lib/linkedin";

export const dynamic = "force-dynamic";

/**
 * Inicia o OAuth do LinkedIn para um cliente. Guarda {state, clientId} num
 * cookie httpOnly (proteção CSRF) e redireciona para o consentimento.
 */
export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  if (!linkedinConfigured()) {
    return Response.json({ error: "LinkedIn não configurado (LINKEDIN_CLIENT_ID/SECRET)" }, { status: 500 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) {
    return Response.json({ error: "clientId obrigatório" }, { status: 400 });
  }

  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(getAuthorizeUrl(state));
  res.cookies.set("li_oauth", JSON.stringify({ state, clientId }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
