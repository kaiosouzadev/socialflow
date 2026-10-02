import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { guardQueueTransition } from "@/lib/publish-guard";
import { uuidString } from "@/lib/validators";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  theme: z.string().optional(),
  caption: z.string().optional(),
  captions: z
    .object({
      instagram: z.string().optional(),
      facebook: z.string().optional(),
      linkedin: z.string().optional(),
    })
    .optional(),
  mediaUrl: z.string().url().optional().or(z.literal("")),
  format: z.enum(["feed", "story", "carrossel", "reels"]).optional(),
  scheduledAt: z.string().datetime().optional(),
  targets: z.array(z.enum(["instagram", "facebook", "linkedin"])).min(1).optional(),
  status: z.enum(["scheduled", "failed", "draft"]).optional(),
  // roteiro por tela (carrossel/reels)
  slides: z.array(z.object({ text: z.string().max(2000) })).max(20).optional(),
  // redatora do post (null limpa) e nota interna da equipe ("" limpa)
  writerId: uuidString.nullable().optional(),
  internalNote: z.string().max(2000, "A nota interna aceita no máximo 2000 caracteres.").optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  if (!uuidString.safeParse(id).success) {
    return Response.json({ error: "ID inválido" }, { status: 400 });
  }
  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      // nunca envia credentialsEnc/briefing/PII do cliente ao browser
      client: { select: { id: true, name: true, email: true, plan: true, tier: true } },
      publications: { orderBy: { publishedAt: "desc" } },
    },
  });

  if (!post) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(post);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  if (!uuidString.safeParse(id).success) {
    return Response.json({ error: "ID inválido" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const current = await prisma.post.findUnique({ where: { id }, select: { status: true, clientId: true } });
  if (!current) return Response.json({ error: "Post não encontrado" }, { status: 404 });
  if (current.status === "published" || current.status === "publishing") {
    return Response.json(
      { error: `Post ${current.status === "published" ? "já publicado" : "em publicação"} não pode ser editado.` },
      { status: 409 }
    );
  }

  const { mediaUrl, scheduledAt, captions, slides, writerId, internalNote, ...rest } = parsed.data;

  if (writerId && !(await prisma.user.findUnique({ where: { id: writerId }, select: { id: true } }))) {
    return Response.json({ error: "Redatora não encontrada.", field: "writerId" }, { status: 400 });
  }

  // cliente só produção: status "scheduled" → 409 (draft e failed passam)
  const blocked = await guardQueueTransition(current.clientId, rest.status);
  if (blocked) return blocked;

  const post = await prisma.post.update({
    where: { id },
    data: {
      ...rest,
      ...(captions !== undefined ? { captions: captions as Prisma.InputJsonValue } : {}),
      ...(slides !== undefined ? { slides: slides as unknown as Prisma.InputJsonValue } : {}),
      ...(mediaUrl !== undefined ? { mediaUrl: mediaUrl || null } : {}),
      ...(scheduledAt ? { scheduledAt: new Date(scheduledAt) } : {}),
      ...(writerId !== undefined ? { writerId } : {}),
      ...(internalNote !== undefined ? { internalNote: internalNote.trim() || null } : {}),
    },
  });

  return Response.json(post);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  if (!uuidString.safeParse(id).success) {
    return Response.json({ error: "ID inválido" }, { status: 400 });
  }
  try {
    await prisma.post.delete({ where: { id } });
  } catch {
    return Response.json({ error: "Post não encontrado" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
