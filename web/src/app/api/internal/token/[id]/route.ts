import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptToken, encryptToken } from "@/lib/crypto";
import { checkInternalKey } from "@/lib/internal-auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/internal/token/[id]">
) {
  const denied = checkInternalKey(req);
  if (denied) return denied;

  const { id } = await ctx.params;

  const account = await prisma.socialAccount.findUnique({
    where: { id },
    select: {
      id: true,
      platform: true,
      externalId: true,
      accessTokenEnc: true,
      status: true,
    },
  });

  if (!account || account.status !== "active") {
    return Response.json({ error: "Account not found or inactive" }, { status: 404 });
  }

  let token: string;
  try {
    token = decryptToken(account.accessTokenEnc);
  } catch {
    return Response.json({ error: "Failed to decrypt token" }, { status: 500 });
  }

  return Response.json({
    token,
    platform: account.platform,
    externalId: account.externalId,
  });
}

export async function PUT(
  req: NextRequest,
  ctx: RouteContext<"/api/internal/token/[id]">
) {
  const denied = checkInternalKey(req);
  if (denied) return denied;

  const { id } = await ctx.params;

  let body: { token: string; expiresIn: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.token || typeof body.token !== "string") {
    return Response.json({ error: "token is required" }, { status: 400 });
  }

  const encrypted = encryptToken(body.token);
  const expiresAt = body.expiresIn
    ? new Date(Date.now() + body.expiresIn * 1000)
    : null;

  await prisma.socialAccount.update({
    where: { id },
    data: {
      accessTokenEnc: encrypted,
      ...(expiresAt && { tokenExpiresAt: expiresAt }),
    },
  });

  return Response.json({ ok: true });
}
