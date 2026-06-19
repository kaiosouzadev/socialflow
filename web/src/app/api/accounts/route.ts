import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { encryptToken } from "@/lib/crypto";
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

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { accessToken, tokenExpiresAt, ...rest } = parsed.data;
  const encrypted = encryptToken(accessToken);

  const account = await prisma.socialAccount.create({
    data: {
      ...rest,
      accessTokenEnc: encrypted,
      ...(tokenExpiresAt ? { tokenExpiresAt: new Date(tokenExpiresAt) } : {}),
    },
  });

  return Response.json({ id: account.id, platform: account.platform }, { status: 201 });
}
