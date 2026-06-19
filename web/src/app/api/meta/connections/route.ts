import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";
import { encryptToken } from "@/lib/crypto";
import { validateToken } from "@/lib/meta";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).optional(),
  token: z.string().min(20),
});

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const connections = await prisma.metaConnection.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      businessId: true,
      status: true,
      createdAt: true,
      _count: { select: { socialAccounts: true } },
    },
  });
  return Response.json(connections);
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const limited = enforceRateLimit(`meta-conn:${clientIp(req)}`, 10, 60_000);
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // valida o token na Graph API antes de salvar
  let me: { id: string; name: string };
  try {
    me = await validateToken(parsed.data.token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Token inválido";
    return Response.json({ error: `Token recusado pela Meta: ${msg}` }, { status: 400 });
  }

  try {
    const conn = await prisma.metaConnection.create({
      data: {
        name: parsed.data.name?.trim() || me.name,
        businessId: me.id,
        accessTokenEnc: encryptToken(parsed.data.token),
        status: "active",
      },
      select: { id: true, name: true, businessId: true, status: true },
    });
    return Response.json(conn, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      throw e;
    }
    throw e;
  }
}
