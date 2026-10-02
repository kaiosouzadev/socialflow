import type { NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { QUEUEABLE_CLIENT } from "@/lib/publish-guard";
import { STUCK_MINUTES } from "@/lib/queue-health";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  // "failed": tudo que falhou · "stuck": preso em publishing · "ids": posts específicos
  scope: z.enum(["failed", "stuck", "ids"]),
  ids: z.array(z.string().uuid()).max(200).optional(),
  clientId: z.string().uuid().optional(),
});

/**
 * Recoloca posts na fila.
 *
 * Zera o `retryCount` de propósito: o WF-03 só reprocessa `failed` com
 * retry_count < 3, então sem zerar o reenvio manual não teria efeito nenhum
 * nos posts que já esgotaram as tentativas automáticas.
 *
 * O agendamento vai para daqui a 2 minutos para o post ser pego pela próxima
 * execução do WF-01 em vez de disparar no meio desta requisição.
 *
 * Cliente só produção (`agencyPublishes = false`) nunca volta à fila, em
 * nenhum escopo: esses posts são pulados e contados em `skippedNoPublish`.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { scope, ids, clientId } = parsed.data;

  if (scope === "ids" && (!ids || ids.length === 0)) {
    return Response.json({ error: "Nenhum post informado" }, { status: 400 });
  }

  const where: Prisma.PostWhereInput =
    scope === "stuck"
      ? {
          status: "publishing",
          scheduledAt: { lt: new Date(Date.now() - STUCK_MINUTES * 60_000) },
          ...(clientId ? { clientId } : {}),
        }
      : scope === "failed"
        ? { status: "failed", ...(clientId ? { clientId } : {}) }
        : { id: { in: ids! }, status: { in: ["failed", "publishing"] } };

  const [{ count }, skippedNoPublish] = await prisma.$transaction([
    prisma.post.updateMany({
      where: { ...where, client: QUEUEABLE_CLIENT },
      data: {
        status: "scheduled",
        scheduledAt: new Date(Date.now() + 2 * 60_000),
        retryCount: 0,
        lastError: null,
      },
    }),
    prisma.post.count({ where: { ...where, client: { agencyPublishes: false } } }),
  ]);

  return Response.json({ ok: true, requeued: count, skippedNoPublish });
}
