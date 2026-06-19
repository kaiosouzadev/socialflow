import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  plan: z.enum(["sem_aprovacao", "aprovacao_cliente"]).optional(),
  toneOfVoice: z.string().optional(),
  // ID da pasta do cliente no Drive (vazio = busca pelo nome)
  driveFolderId: z.string().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      // never expose the encrypted token to the browser
      socialAccounts: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          platform: true,
          externalId: true,
          status: true,
          dailyPostLimit: true,
          tokenExpiresAt: true,
        },
      },
      _count: { select: { posts: true } },
    },
  });

  if (!client) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(client);
}

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

  // "" no driveFolderId = limpar (volta a buscar pelo nome)
  const data = { ...parsed.data };
  if (data.driveFolderId !== undefined) {
    data.driveFolderId = data.driveFolderId.trim() || null as unknown as string;
  }

  try {
    const client = await prisma.client.update({ where: { id }, data });
    return Response.json(client);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2025") return Response.json({ error: "Cliente não encontrado" }, { status: 404 });
      if (e.code === "P2002") return Response.json({ error: "Já existe um cliente com este email" }, { status: 409 });
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
    await prisma.client.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return Response.json({ error: "Cliente não encontrado" }, { status: 404 });
    }
    throw e;
  }
}
