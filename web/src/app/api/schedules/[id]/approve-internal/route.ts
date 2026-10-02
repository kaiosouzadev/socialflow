import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { canEnterQueue } from "@/lib/publish-policy";
import { QUEUEABLE_CLIENT } from "@/lib/publish-guard";

export const dynamic = "force-dynamic";

/**
 * Aprovação interna (Pamela / plano sem_aprovacao): aprova o cronograma sem
 * passar pelo cliente. Posts draft → scheduled (entram na fila do WF-01).
 * Cliente só produção: o cronograma é aprovado do mesmo jeito, mas os posts
 * continuam draft (`queued: 0`, `noPublish: true`).
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
    select: { id: true, status: true, client: { select: { agencyPublishes: true } } },
  });
  if (!schedule) return Response.json({ error: "Cronograma não encontrado" }, { status: 404 });
  if (schedule.status === "aprovado_cliente") {
    return Response.json({ error: "Cronograma já aprovado" }, { status: 409 });
  }

  const [, posts] = await prisma.$transaction([
    prisma.schedule.update({
      where: { id },
      data: { status: "aprovado_cliente", approvedAt: new Date() },
    }),
    prisma.post.updateMany({
      where: { scheduleId: id, status: "draft", client: QUEUEABLE_CLIENT },
      data: { status: "scheduled" },
    }),
  ]);

  return Response.json({
    ok: true,
    scheduled: posts.count,
    queued: posts.count,
    noPublish: !canEnterQueue(schedule.client),
  });
}
