import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";
import { PENDING_KINDS } from "@/lib/status-meta";
import { pendingItemInclude } from "@/lib/doc-import-commit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateSchema = z
  .object({
    kind: z.enum(PENDING_KINDS).optional(),
    title: z.string().trim().min(1, "Informe o título").max(200).optional(),
    // "" ou null limpa
    details: z.string().max(10_000).nullable().optional(),
    responsibleUserId: uuidString.nullable().optional(),
    postId: uuidString.nullable().optional(),
    // true = resolver; false = reabrir
    resolved: z.boolean().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: "Nada para atualizar" });

/** Edita campos, resolve ou reabre uma pendência. */
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
  const { kind, title, details, responsibleUserId, postId, resolved } = parsed.data;

  const current = await prisma.pendingItem.findUnique({
    where: { id },
    select: { clientId: true, resolvedAt: true },
  });
  if (!current) return Response.json({ error: "Pendência não encontrada" }, { status: 404 });

  if (responsibleUserId) {
    const user = await prisma.user.findUnique({ where: { id: responsibleUserId }, select: { id: true } });
    if (!user) return Response.json({ error: "Responsável não encontrado" }, { status: 400 });
  }
  if (postId) {
    const post = await prisma.post.findUnique({ where: { id: postId }, select: { clientId: true } });
    if (!post || post.clientId !== current.clientId) {
      return Response.json({ error: "Post não encontrado para este cliente" }, { status: 400 });
    }
  }

  try {
    const item = await prisma.pendingItem.update({
      where: { id },
      data: {
        ...(kind !== undefined ? { kind } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(details !== undefined ? { details: details?.trim() || null } : {}),
        ...(responsibleUserId !== undefined ? { responsibleUserId } : {}),
        ...(postId !== undefined ? { postId } : {}),
        // resolver de novo não muda a data original
        ...(resolved === true ? { resolvedAt: current.resolvedAt ?? new Date() } : {}),
        ...(resolved === false ? { resolvedAt: null } : {}),
      },
      include: pendingItemInclude,
    });
    return Response.json(item);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2025") return Response.json({ error: "Pendência não encontrada" }, { status: 404 });
      if (e.code === "P2003") {
        return Response.json({ error: "Responsável ou post não encontrado" }, { status: 400 });
      }
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
  if (!uuidString.safeParse(id).success) {
    return Response.json({ error: "ID inválido" }, { status: 400 });
  }
  try {
    await prisma.pendingItem.delete({ where: { id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return Response.json({ error: "Pendência não encontrada" }, { status: 404 });
    }
    throw e;
  }
  return Response.json({ ok: true });
}
