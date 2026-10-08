import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { encryptToken } from "@/lib/crypto";
import { ADMIN_ONLY, requireAdminFor, sessionActor } from "@/lib/permissions";
import { uuidString } from "@/lib/validators";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  externalId: z.string().min(1).optional(),
  accessToken: z.string().min(1).optional(),
  dailyPostLimit: z.number().int().min(1).max(200).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  tokenExpiresAt: z.string().datetime().nullable().optional(),
});

const NOT_FOUND = "Conta não encontrada";

const accountInfo = {
  clientId: true,
  platform: true,
  externalId: true,
  status: true,
  dailyPostLimit: true,
  client: { select: { name: true } },
} as const;

/**
 * Troca conta/token/limite/status de uma conta de publicação. Só admin, com registro (AC-07):
 * o registro diz o que mudou (de → para) e se o token foi trocado — nunca o token.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdminFor(ADMIN_ONLY.accounts);
  if (denied) return denied;

  const { id } = await params;
  if (!uuidString.safeParse(id).success) return Response.json({ error: "ID inválido" }, { status: 400 });
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { accessToken, tokenExpiresAt, ...rest } = parsed.data;
  const before = await prisma.socialAccount.findUnique({ where: { id }, select: accountInfo });
  if (!before) return Response.json({ error: NOT_FOUND }, { status: 404 });

  let account: { id: string; platform: string; status: string; dailyPostLimit: number };
  try {
    account = await prisma.socialAccount.update({
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
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return Response.json({ error: NOT_FOUND }, { status: 404 });
    }
    throw e;
  }

  const changes: Record<string, unknown> = {};
  if (rest.externalId !== undefined && rest.externalId !== before.externalId) {
    changes.externalId = { from: before.externalId, to: rest.externalId };
  }
  if (rest.status !== undefined && rest.status !== before.status) changes.status = { from: before.status, to: rest.status };
  if (rest.dailyPostLimit !== undefined && rest.dailyPostLimit !== before.dailyPostLimit) {
    changes.dailyPostLimit = { from: before.dailyPostLimit, to: rest.dailyPostLimit };
  }
  if (accessToken) changes.tokenReplaced = true;
  if (tokenExpiresAt !== undefined) changes.tokenExpiresAtChanged = true;

  const actor = await sessionActor();
  await audit(
    {
      action: "client.account_change",
      targetType: "social_account",
      targetId: id,
      clientId: before.clientId,
      meta: { op: "update", platform: before.platform, externalId: before.externalId, clientName: before.client.name, changes },
    },
    { req, ...(actor ? { actor: { id: actor.id, email: actor.email } } : {}) },
  );
  return Response.json(account);
}

/** Exclui a conta de publicação (e o token salvo). Só admin, com registro (AC-07). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdminFor(ADMIN_ONLY.accounts);
  if (denied) return denied;

  const { id } = await params;
  if (!uuidString.safeParse(id).success) return Response.json({ error: "ID inválido" }, { status: 400 });
  const before = await prisma.socialAccount.findUnique({ where: { id }, select: accountInfo });
  if (!before) return Response.json({ error: NOT_FOUND }, { status: 404 });
  try {
    await prisma.socialAccount.delete({ where: { id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return Response.json({ error: NOT_FOUND }, { status: 404 });
    }
    throw e;
  }
  const actor = await sessionActor();
  await audit(
    {
      action: "client.account_change",
      targetType: "social_account",
      targetId: id,
      clientId: before.clientId,
      meta: { op: "delete", platform: before.platform, externalId: before.externalId, clientName: before.client.name },
    },
    { req, ...(actor ? { actor: { id: actor.id, email: actor.email } } : {}) },
  );
  return Response.json({ ok: true });
}
