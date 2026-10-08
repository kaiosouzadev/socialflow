import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { sessionActor } from "@/lib/permissions";
import { uuidString } from "@/lib/validators";
import { canEnterQueue } from "@/lib/publish-policy";
import { QUEUEABLE_CLIENT } from "@/lib/publish-guard";

export const dynamic = "force-dynamic";

/**
 * Aprovação interna (Pamela / plano sem_aprovacao): aprova o cronograma sem
 * passar pelo cliente. Posts draft → scheduled (entram na fila do WF-01).
 * Cliente só produção: o cronograma é aprovado do mesmo jeito, mas os posts
 * continuam draft (`queued: 0`, `noPublish: true`).
 * Grava quem aprovou na trilha de auditoria (`schedule.approve_internal`, AC-13): o status é o
 * mesmo da aprovação do cliente, então o registro é o que distingue "aprovado sem o cliente".
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
  const schedule = await prisma.schedule.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      monthRef: true,
      clientId: true,
      client: { select: { agencyPublishes: true, name: true } },
    },
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

  const actor = await sessionActor();
  await audit(
    {
      action: "schedule.approve_internal",
      targetType: "schedule",
      targetId: id,
      clientId: schedule.clientId,
      meta: {
        clientName: schedule.client.name,
        monthRef: schedule.monthRef.toISOString().slice(0, 10),
        previousStatus: schedule.status,
        queued: posts.count,
        noPublish: !canEnterQueue(schedule.client),
      },
    },
    { req, ...(actor ? { actor: { id: actor.id, email: actor.email } } : {}) }
  );

  return Response.json({
    ok: true,
    scheduled: posts.count,
    queued: posts.count,
    noPublish: !canEnterQueue(schedule.client),
  });
}
