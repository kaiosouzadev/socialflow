import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { raiseAlert, teamEmails, notifyEmailHtml, escapeHtml } from "@/lib/notify";
import { canEnterQueue } from "@/lib/publish-policy";
import { QUEUEABLE_CLIENT } from "@/lib/publish-guard";
import {
  LINK_ACTIONS_PER_MINUTE,
  OPEN_SCHEDULE_STATUSES,
  bodyTooLarge,
  declaredBodyTooLarge,
  isTokenShaped,
  linkNotFound,
  monthlyLinkBlocked,
  monthlyLinkState,
  publicJson,
  tokenKey,
  withPublicHeaders,
} from "@/lib/approval";

export const dynamic = "force-dynamic";

/** O cronograma saiu de "aberto" (ou o token foi trocado) entre a leitura e a gravação. */
class ScheduleNoLongerOpen extends Error {}

/**
 * Cliente aprova o CRONOGRAMA (títulos + explicações).
 * - Bloqueado enquanto houver ajuste pendente (a redatora precisa resolver).
 * - Plano com aprovação: posts continuam draft — o conteúdo completo
 *   (legenda/arte) ainda passa pela aprovação semanal antes de agendar.
 * - Plano sem aprovação: comportamento antigo (draft → scheduled), só se a
 *   agência publica para o cliente; cliente só produção continua em draft.
 * - Ciclo de vida do link (lib/approval): aprovado → 409; 60 dias após o envio → 410.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = enforceRateLimit(`aprovar-approve:${clientIp(req)}`, 30, 60_000);
  if (limited) return withPublicHeaders(limited);
  // a aprovação não tem corpo: um corpo grande é recusado sem ser lido (CF-16)
  if (declaredBodyTooLarge(req)) return bodyTooLarge();

  const { token } = await params;
  if (!isTokenShaped(token)) return linkNotFound();
  const perLink = enforceRateLimit(`aprovar-link:${tokenKey(token)}`, LINK_ACTIONS_PER_MINUTE, 60_000);
  if (perLink) return withPublicHeaders(perLink);

  const schedule = await prisma.schedule.findUnique({
    where: { approvalToken: token },
    select: {
      id: true,
      status: true,
      sentAt: true,
      createdAt: true,
      clientId: true,
      monthRef: true,
      client: { select: { name: true, plan: true, agencyPublishes: true } },
    },
  });
  if (!schedule) return linkNotFound();
  const blocked = monthlyLinkBlocked(monthlyLinkState(schedule));
  if (blocked) return blocked;

  // ajustes pendentes bloqueiam a aprovação até a redatora resolver
  const pending = await prisma.postAdjustment.count({
    where: { status: "pendente", post: { scheduleId: schedule.id } },
  });
  if (pending > 0) {
    return publicJson(
      {
        error: `Há ${pending} ajuste(s) aguardando a equipe. Assim que forem concluídos você poderá aprovar — ou o cronograma será aprovado automaticamente se o prazo já tiver passado.`,
      },
      409
    );
  }

  const autoSchedule = schedule.client.plan === "sem_aprovacao" && canEnterQueue(schedule.client);
  let scheduledCount = 0;
  try {
    await prisma.$transaction(async (tx) => {
      // gravação condicional: se outro pedido aprovou, a equipe reenviou (token novo) ou mudou o
      // status entre a leitura e aqui, nada é gravado
      const r = await tx.schedule.updateMany({
        where: { id: schedule.id, approvalToken: token, status: { in: [...OPEN_SCHEDULE_STATUSES] } },
        data: { status: "aprovado_cliente", approvedAt: new Date() },
      });
      if (r.count === 0) throw new ScheduleNoLongerOpen();
      if (autoSchedule) {
        const posts = await tx.post.updateMany({
          where: { scheduleId: schedule.id, status: "draft", client: QUEUEABLE_CLIENT },
          data: { status: "scheduled" },
        });
        scheduledCount = posts.count;
      }
    });
  } catch (e) {
    if (e instanceof ScheduleNoLongerOpen) return monthlyLinkBlocked("aprovado")!;
    throw e;
  }

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

  return publicJson({ ok: true, scheduled: scheduledCount });
}
