import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { guardQueueTransition } from "@/lib/publish-guard";
import { uuidString } from "@/lib/validators";
import { z } from "zod";

export const dynamic = "force-dynamic";

const captionsSchema = z
  .object({
    instagram: z.string().optional(),
    facebook: z.string().optional(),
    linkedin: z.string().optional(),
  })
  .optional();

const createSchema = z.object({
  clientId: uuidString,
  theme: z.string().optional(),
  caption: z.string().optional(),
  captions: captionsSchema,
  mediaUrl: z.string().url().optional().or(z.literal("")),
  format: z.enum(["feed", "story", "carrossel", "reels"]).default("feed"),
  scheduledAt: z.string().datetime(),
  targets: z.array(z.enum(["instagram", "facebook", "linkedin"])).min(1),
  // rascunho fica fora da fila até alguém aprovar; só "scheduled" publica
  status: z.enum(["scheduled", "draft"]).default("scheduled"),
  // roteiro por tela (carrossel/reels)
  slides: z.array(z.object({ text: z.string().max(2000) })).max(20).optional(),
  // redatora do post e nota interna da equipe (nunca aparece nas páginas públicas)
  writerId: uuidString.nullable().optional(),
  internalNote: z.string().max(2000, "A nota interna aceita no máximo 2000 caracteres.").optional(),
});

export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");
  const status = searchParams.get("status");
  if (clientId && !uuidString.safeParse(clientId).success) {
    return Response.json({ error: "clientId inválido" }, { status: 400 });
  }

  const posts = await prisma.post.findMany({
    where: {
      ...(clientId ? { clientId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { scheduledAt: "desc" },
    take: 100,
    include: { client: { select: { name: true } } },
  });

  return Response.json(posts);
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { mediaUrl, captions, scheduledAt, slides, writerId, internalNote, ...rest } = parsed.data;

  if (writerId && !(await prisma.user.findUnique({ where: { id: writerId }, select: { id: true } }))) {
    return Response.json({ error: "Redatora não encontrada.", field: "writerId" }, { status: 400 });
  }

  // cliente só produção não entra na fila: "scheduled" (o default) → 409; draft passa
  const blocked = await guardQueueTransition(rest.clientId, rest.status);
  if (blocked) return blocked;

  try {
    const post = await prisma.post.create({
      data: {
        ...rest,
        captions: captions ? (captions as Prisma.InputJsonValue) : undefined,
        slides: slides?.length ? (slides as unknown as Prisma.InputJsonValue) : undefined,
        mediaUrl: mediaUrl || null,
        scheduledAt: new Date(scheduledAt),
        ...(writerId !== undefined ? { writerId } : {}),
        ...(internalNote !== undefined ? { internalNote: internalNote.trim() || null } : {}),
      },
    });
    return Response.json(post, { status: 201 });
  } catch (e) {
    // FK inválida (clientId inexistente)
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return Response.json({ error: "Cliente não encontrado" }, { status: 400 });
    }
    throw e;
  }
}
