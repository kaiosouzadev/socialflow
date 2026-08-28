import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Reverte a aprovação de um cronograma (uso interno): o cronograma volta para
 * edição e os posts ainda não publicados saem da fila (scheduled → draft).
 * Posts já publicados/publicando não são tocados.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  const schedule = await prisma.schedule.findUnique({
    where: { id },
    select: { id: true, status: true, approvalToken: true },
  });
  if (!schedule) return Response.json({ error: "Cronograma não encontrado" }, { status: 404 });
  if (schedule.status !== "aprovado_cliente" && schedule.status !== "aprovado_interno") {
    return Response.json(
      { error: "Só cronogramas aprovados podem ser revertidos" },
      { status: 409 }
    );
  }

  // se já foi enviado ao cliente (tem token), volta para "em_revisao" — o link
  // do cliente reabre para ajustes; senão volta para rascunho interno.
  const newStatus = schedule.approvalToken ? "em_revisao" : "rascunho";

  const [, posts] = await prisma.$transaction([
    prisma.schedule.update({
      where: { id },
      data: { status: newStatus, approvedAt: null },
    }),
    prisma.post.updateMany({
      where: { scheduleId: id, status: "scheduled" },
      data: { status: "draft" },
    }),
  ]);

  return Response.json({ ok: true, status: newStatus, reverted: posts.count });
}
