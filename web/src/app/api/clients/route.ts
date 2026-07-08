import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { scheduleAllBasicMonths } from "@/lib/basic-plan";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  plan: z.enum(["sem_aprovacao", "aprovacao_cliente"]).default("sem_aprovacao"),
  tier: z.enum(["basica", "completa"]).default("completa"),
  toneOfVoice: z.string().optional(),
  driveFolderId: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const clients = await prisma.client.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { socialAccounts: true, posts: true } },
    },
  });

  return Response.json(clients);
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const client = await prisma.client.create({ data: parsed.data });

    // cliente básico: agenda na hora o calendário de artes básicas de todos os
    // meses disponíveis (posts draft sem arte — as imagens ficam pendentes)
    let basicPlan: { scheduled: number } | null = null;
    if (client.tier === "basica") {
      try {
        const r = await scheduleAllBasicMonths(client.id);
        basicPlan = { scheduled: r.scheduled };
      } catch {
        basicPlan = null; // não bloqueia o cadastro; dá pra agendar depois na página do cliente
      }
    }

    return Response.json({ ...client, basicPlan }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return Response.json({ error: "Já existe um cliente com este email" }, { status: 409 });
    }
    throw e;
  }
}
