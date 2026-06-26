import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { encryptToken } from "@/lib/crypto";
import { exchangeCode, getMember } from "@/lib/linkedin";

export const dynamic = "force-dynamic";

function backToClient(clientId: string, status: string): NextResponse {
  const base = (process.env.SYSTEM_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return NextResponse.redirect(`${base}/clients/${clientId}?linkedin=${status}`);
}

/**
 * Callback do OAuth do LinkedIn. Valida o state (cookie), troca o code por
 * tokens, lê o URN do membro e grava/atualiza a social_account (linkedin).
 */
export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const jar = await cookies();
  const rawCookie = jar.get("li_oauth")?.value;
  jar.delete("li_oauth");

  if (!rawCookie) return Response.json({ error: "Sessão OAuth expirada" }, { status: 400 });

  let saved: { state: string; clientId: string };
  try {
    saved = JSON.parse(rawCookie);
  } catch {
    return Response.json({ error: "Cookie OAuth inválido" }, { status: 400 });
  }

  if (oauthError) return backToClient(saved.clientId, "erro");
  if (!code || !state || state !== saved.state) {
    return backToClient(saved.clientId, "erro");
  }

  try {
    const tokens = await exchangeCode(code);
    const member = await getMember(tokens.access_token);

    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const refreshTokenExpiresAt = tokens.refresh_token_expires_in
      ? new Date(Date.now() + tokens.refresh_token_expires_in * 1000)
      : null;

    const data = {
      accessTokenEnc: encryptToken(tokens.access_token),
      refreshTokenEnc: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      tokenExpiresAt,
      refreshTokenExpiresAt,
      status: "active",
    };

    const existing = await prisma.socialAccount.findFirst({
      where: { clientId: saved.clientId, platform: "linkedin", externalId: member.urn },
      select: { id: true },
    });
    if (existing) {
      await prisma.socialAccount.update({ where: { id: existing.id }, data });
    } else {
      await prisma.socialAccount.create({
        data: { clientId: saved.clientId, platform: "linkedin", externalId: member.urn, dailyPostLimit: 25, ...data },
      });
    }

    return backToClient(saved.clientId, "ok");
  } catch {
    return backToClient(saved.clientId, "erro");
  }
}
