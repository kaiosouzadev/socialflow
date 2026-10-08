import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { ADMIN_ONLY, isAdmin, sessionActor } from "@/lib/permissions";
import { guardQueueTransition } from "@/lib/publish-guard";
import { mediaUrlProblem } from "@/lib/media-url";
import { uuidString } from "@/lib/validators";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** OWASP AUD2-04: `mediaUrl` só https público (nada de javascript:/data:/IP interno) → 400 pt-BR. */
function mediaUrlRejection(body: unknown): Response | null {
  const raw = (body as { mediaUrl?: unknown } | null)?.mediaUrl;
  if (typeof raw !== "string" || raw === "") return null;
  const problem = mediaUrlProblem(raw);
  return problem ? Response.json({ error: problem, field: "mediaUrl" }, { status: 400 }) : null;
}

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
  const badMedia = mediaUrlRejection(body);
  if (badMedia) return badMedia;
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
  // [R2/AC-07] post PUBLICADO só a admin exclui (com registro); a staff exclui os demais.
  // O deleteMany com filtro de status fecha a corrida "publicou entre a conferência e a exclusão".
  const actor = await sessionActor();
  const admin = isAdmin(actor);
  const post = await prisma.post.findUnique({
    where: { id },
    select: { status: true, clientId: true, theme: true, client: { select: { name: true } } },
  });
  if (!post) return Response.json({ error: "Post não encontrado" }, { status: 404 });
  if (post.status === "published" && !admin) {
    return Response.json({ error: ADMIN_ONLY.deletePublished }, { status: 403 });
  }
  const { count } = await prisma.post.deleteMany({
    where: { id, ...(admin ? {} : { status: { not: "published" } }) },
  });
  if (count === 0) {
    const still = await prisma.post.findUnique({ where: { id }, select: { status: true } });
    if (still?.status === "published") return Response.json({ error: ADMIN_ONLY.deletePublished }, { status: 403 });
    return Response.json({ error: "Post não encontrado" }, { status: 404 });
  }
  if (post.status === "published") {
    await audit(
      {
        action: "post.delete",
        targetType: "post",
        targetId: id,
        clientId: post.clientId,
        meta: { status: post.status, clientName: post.client.name, theme: post.theme ?? null },
      },
      { req, ...(actor ? { actor: { id: actor.id, email: actor.email } } : {}) },
    );
  }
  return Response.json({ ok: true });
}
