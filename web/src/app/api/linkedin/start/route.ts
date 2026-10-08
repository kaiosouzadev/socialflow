import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { ADMIN_ONLY, requireAdminFor } from "@/lib/permissions";
import { getAuthorizeUrl, linkedinConfigured } from "@/lib/linkedin";
import { uuidString } from "@/lib/validators";

export const dynamic = "force-dynamic";

/**
 * Inicia o OAuth do LinkedIn para um cliente. Guarda {state, clientId} num
 * cookie httpOnly (proteção CSRF) e redireciona para o consentimento.
 * Conectar conta de publicação é só admin (AC-07); a tela esconde o botão para a staff.
 */
export async function GET(req: NextRequest) {
  const denied = await requireAdminFor(ADMIN_ONLY.linkedin);
  if (denied) return denied;

  const clientId = req.nextUrl.searchParams.get("clientId");

  if (!linkedinConfigured()) {
    // "Conectar LinkedIn" é um link de navegação: sem configuração, volta para
    // o cliente com um aviso (a tela mostra a mensagem) em vez de JSON cru.
    console.error("[linkedin/start] LinkedIn não configurado (LINKEDIN_CLIENT_ID/SECRET ausentes)");
    const back = clientId && uuidString.safeParse(clientId).success ? `/clients/${clientId}` : "/clients";
    return NextResponse.redirect(new URL(`${back}?aviso=linkedin-indisponivel`, req.url), 302);
  }

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
