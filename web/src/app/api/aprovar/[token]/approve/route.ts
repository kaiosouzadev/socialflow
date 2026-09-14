import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { raiseAlert, teamEmails, notifyEmailHtml, escapeHtml } from "@/lib/notify";

export const dynamic = "force-dynamic";

const OPEN = ["enviado_cliente", "em_revisao"];

/**
 * Cliente aprova o CRONOGRAMA (títulos + explicações).
 * - Bloqueado enquanto houver ajuste pendente (a redatora precisa resolver).
 * - Plano com aprovação: posts continuam draft — o conteúdo completo
 *   (legenda/arte) ainda passa pela aprovação semanal antes de agendar.
 * - Plano auto-publicação: comportamento antigo (draft → scheduled).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = enforceRateLimit(`aprovar-approve:${clientIp(req)}`, 30, 60_000);
  if (limited) return limited;

  const { token } = await params;
  const schedule = await prisma.schedule.findUnique({
    where: { approvalToken: token },
    select: {
      id: true,
      status: true,
      clientId: true,
      monthRef: true,
      client: { select: { name: true, plan: true } },
    },
  });
  if (!schedule) return Response.json({ error: "Link inválido" }, { status: 404 });
  if (!OPEN.includes(schedule.status)) {
    return Response.json({ error: "Cronograma não está aberto para aprovação" }, { status: 409 });
  }

  // ajustes pendentes bloqueiam a aprovação até a redatora resolver
  const pending = await prisma.postAdjustment.count({
    where: { status: "pendente", post: { scheduleId: schedule.id } },
  });
  if (pending > 0) {
    return Response.json(
      {
        error: `Há ${pending} ajuste(s) aguardando a equipe. Assim que forem concluídos você poderá aprovar — ou o cronograma será aprovado automaticamente se o prazo já tiver passado.`,
      },
      { status: 409 }
    );
  }

  const autoSchedule = schedule.client.plan === "sem_aprovacao";
  let scheduledCount = 0;
  await prisma.$transaction(async (tx) => {
    await tx.schedule.update({
      where: { id: schedule.id },
      data: { status: "aprovado_cliente", approvedAt: new Date() },
    });
    if (autoSchedule) {
      const r = await tx.post.updateMany({
        where: { scheduleId: schedule.id, status: "draft" },
        data: { status: "scheduled" },
      });
      scheduledCount = r.count;
    }
  });

  const monthLabel = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(schedule.monthRef);
  const to = await teamEmails();
  await raiseAlert({
    kind: "cronograma_aprovado",
    audience: "equipe",
    message: `${schedule.client.name} aprovou o cronograma de ${monthLabel}. Hora de produzir legendas e artes.`,
    dedupeKey: `cronograma_aprovado:${schedule.id}`,
    clientId: schedule.clientId,
    scheduleId: schedule.id,
    email: {
      to,
      subject: `Cronograma aprovado — ${schedule.client.name} (${monthLabel})`,
      html: notifyEmailHtml(
        "Cronograma aprovado pelo cliente",
        [
          `<strong>${escapeHtml(schedule.client.name)}</strong> aprovou o cronograma de <strong>${monthLabel}</strong>.`,
          "Próximo passo: gerar legendas/slides e preparar as artes para os envios semanais.",
        ],
        `${process.env.SYSTEM_BASE_URL ?? ""}/aprovacoes`,
        "Abrir aprovações"
      ),
    },
  });

  return Response.json({ ok: true, scheduled: scheduledCount });
}
