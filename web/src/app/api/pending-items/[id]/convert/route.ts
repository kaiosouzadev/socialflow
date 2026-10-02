import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";
import { POST_FORMATS } from "@/lib/formats";
import { spLocalInputFromISO } from "@/lib/format-date";
import {
  POST_TARGETS,
  defaultTargetsFor,
  findOrCreateMonthSchedule,
  pendingItemInclude,
} from "@/lib/doc-import-commit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  scheduledAt: z.string().datetime({ offset: true }),
  format: z.enum(POST_FORMATS),
  // padrão: redes das contas do cliente, ou IG + FB
  targets: z.array(z.enum(POST_TARGETS)).min(1).optional(),
});

class ConvertConflict extends Error {}

/**
 * Converte a pendência num post RASCUNHO (nunca agenda, mesmo para cliente que
 * publica): tema = título, nota interna = detalhes, cronograma do mês (SP)
 * encontrado ou criado como rascunho. A pendência fica vinculada e resolvida.
 */
export async function POST(
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
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { format, targets } = parsed.data;
  const scheduledAt = new Date(parsed.data.scheduledAt);
  const monthKey = spLocalInputFromISO(scheduledAt).slice(0, 7);

  const item = await prisma.pendingItem.findUnique({
    where: { id },
    select: {
      title: true,
      details: true,
      postId: true,
      resolvedAt: true,
      clientId: true,
      client: { select: { socialAccounts: { select: { platform: true } } } },
    },
  });
  if (!item) return Response.json({ error: "Pendência não encontrada" }, { status: 404 });
  if (item.postId) {
    return Response.json({ error: "Esta pendência já está vinculada a um post." }, { status: 409 });
  }
  if (item.resolvedAt) {
    return Response.json({ error: "Esta pendência já foi resolvida. Reabra-a antes de converter." }, { status: 409 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const schedule = await findOrCreateMonthSchedule(tx, item.clientId, monthKey, "rascunho");
      const post = await tx.post.create({
        data: {
          clientId: item.clientId,
          scheduleId: schedule.id,
          theme: item.title.slice(0, 200),
          internalNote: item.details,
          format,
          scheduledAt,
          targets: targets ?? defaultTargetsFor(item.client.socialAccounts.map((a) => a.platform)),
          // explícito: o default da coluna é "scheduled"
          status: "draft",
        },
        select: { id: true, theme: true, format: true, scheduledAt: true, status: true, scheduleId: true },
      });
      // só converte se ninguém converteu/resolveu no meio do caminho
      const linked = await tx.pendingItem.updateMany({
        where: { id, postId: null, resolvedAt: null },
        data: { postId: post.id, resolvedAt: new Date() },
      });
      if (linked.count !== 1) throw new ConvertConflict();
      const updated = await tx.pendingItem.findUniqueOrThrow({ where: { id }, include: pendingItemInclude });
      return { post, item: updated, schedule: { ...schedule, month: monthKey } };
    });
    return Response.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof ConvertConflict) {
      return Response.json({ error: "Esta pendência acabou de ser convertida ou resolvida." }, { status: 409 });
    }
    throw e;
  }
}
