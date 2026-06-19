import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { encryptToken } from "@/lib/crypto";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  externalId: z.string().min(1).optional(),
  accessToken: z.string().min(1).optional(),
  dailyPostLimit: z.number().int().min(1).max(200).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  tokenExpiresAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { accessToken, tokenExpiresAt, ...rest } = parsed.data;

  try {
    const account = await prisma.socialAccount.update({
      where: { id },
      data: {
        ...rest,
        ...(accessToken ? { accessTokenEnc: encryptToken(accessToken) } : {}),
        ...(tokenExpiresAt !== undefined
          ? { tokenExpiresAt: tokenExpiresAt ? new Date(tokenExpiresAt) : null }
          : {}),
      },
      select: { id: true, platform: true, status: true, dailyPostLimit: true },
    });
    return Response.json(account);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return Response.json({ error: "Conta não encontrada" }, { status: 404 });
    }
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  try {
    await prisma.socialAccount.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return Response.json({ error: "Conta não encontrada" }, { status: 404 });
    }
    throw e;
  }
}
