import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { encryptToken } from "@/lib/crypto";
import { ADMIN_ONLY, requireAdminFor, sessionActor } from "@/lib/permissions";
import { uuidString } from "@/lib/validators";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  clientId: uuidString,
  platform: z.enum(["instagram", "facebook", "linkedin"]),
  externalId: z.string().min(1),
  accessToken: z.string().min(1),
  dailyPostLimit: z.number().int().min(1).max(200).default(25),
  tokenExpiresAt: z.string().datetime().optional(),
});

/** Adiciona manualmente uma conta de publicação (com token). Só admin, com registro (AC-07). */
export async function POST(req: NextRequest) {
  const denied = await requireAdminFor(ADMIN_ONLY.accounts);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { accessToken, tokenExpiresAt, ...rest } = parsed.data;
  const encrypted = encryptToken(accessToken);

  let account: { id: string; platform: string; client: { name: string } };
  try {
    account = await prisma.socialAccount.create({
      data: {
        ...rest,
        accessTokenEnc: encrypted,
        ...(tokenExpiresAt ? { tokenExpiresAt: new Date(tokenExpiresAt) } : {}),
      },
      select: { id: true, platform: true, client: { select: { name: true } } },
    });
  } catch (e) {
    // clientId de cliente que não existe (FK)
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return Response.json({ error: "Cliente não encontrado" }, { status: 404 });
    }
    throw e;
  }

  const actor = await sessionActor();
  await audit(
    {
      action: "client.account_change",
      targetType: "social_account",
      targetId: account.id,
      clientId: rest.clientId,
      // nunca o token: só o que foi feito e em qual conta
      meta: { op: "create", platform: account.platform, externalId: rest.externalId, clientName: account.client.name },
    },
    { req, ...(actor ? { actor: { id: actor.id, email: actor.email } } : {}) },
  );
  return Response.json({ id: account.id, platform: account.platform }, { status: 201 });
}
