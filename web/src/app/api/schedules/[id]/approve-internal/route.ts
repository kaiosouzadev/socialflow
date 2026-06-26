import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Aprovação interna (Pamela / plano sem_aprovacao): aprova o cronograma sem
 * passar pelo cliente. Posts draft → scheduled (entram na fila do WF-01).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  const schedule = await prisma.schedule.findUnique({ where: { id }, select: { id: true } });
  if (!schedule) return Response.json({ error: "Cronograma não encontrado" }, { status: 404 });

  const [, posts] = await prisma.$transaction([
    prisma.schedule.update({
      where: { id },
      data: { status: "aprovado_cliente", approvedAt: new Date() },
    }),
    prisma.post.updateMany({
      where: { scheduleId: id, status: "draft" },
      data: { status: "scheduled" },
    }),
  ]);

  return Response.json({ ok: true, scheduled: posts.count });
}
