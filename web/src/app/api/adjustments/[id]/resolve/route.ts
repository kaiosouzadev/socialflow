import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";
import { scheduleClientDeadline } from "@/lib/deadlines";
import { raiseAlert, teamEmails, notifyEmailHtml, escapeHtml } from "@/lib/notify";
import { approvalLink } from "@/lib/approval";
import { clientRecipients } from "@/lib/client-emails";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({ reply: z.string().max(1000).optional() });

/**
 * Redatora conclui um ajuste solicitado pelo cliente.
 * Quando o ÚLTIMO ajuste pendente do cronograma é resolvido:
 * - prazo do cliente (dia 25 do mês anterior) já venceu → cronograma aprova
 *   AUTOMATICAMENTE (regra do fluxo) e cliente é avisado;
 * - prazo ainda aberto → cliente é avisado para revisar e aprovar.
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
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const adjustment = await prisma.postAdjustment.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      post: {
        select: {
          id: true,
          theme: true,
          clientId: true,
          scheduleId: true,
          schedule: {
            select: {
              id: true,
              status: true,
              monthRef: true,
              approvalToken: true,
              client: { select: { name: true, email: true, extraEmails: true } },
            },
          },
        },
      },
    },
  });
  if (!adjustment) return Response.json({ error: "Ajuste não encontrado" }, { status: 404 });
  if (adjustment.status === "resolvido") {
    return Response.json({ error: "Ajuste já concluído" }, { status: 409 });
  }

  await prisma.postAdjustment.update({
    where: { id },
    data: {
      status: "resolvido",
      reply: parsed.data.reply?.trim() || null,
      resolvedAt: new Date(),
    },
  });

  const schedule = adjustment.post.schedule;
  let autoApproved = false;

  if (schedule) {
    const remaining = await prisma.postAdjustment.count({
      where: { status: "pendente", post: { scheduleId: schedule.id } },
    });

    if (remaining === 0 && ["em_revisao", "enviado_cliente"].includes(schedule.status)) {
      const deadline = scheduleClientDeadline(schedule.monthRef);
      const link = schedule.approvalToken
        ? approvalLink(schedule.approvalToken, req.nextUrl.origin)
        : null;
      // todos os e-mails do cliente (principal primeiro), 1 e-mail por destinatário
      const clientTo = clientRecipients(schedule.client);

      if (new Date() > deadline) {
        // prazo do cliente venceu com ajustes em aberto → aprova automaticamente
        autoApproved = true;
        await prisma.schedule.update({
          where: { id: schedule.id },
          data: { status: "aprovado_cliente", approvedAt: new Date() },
        });
        const to = await teamEmails();
        await raiseAlert({
          kind: "cronograma_auto_aprovado",
          audience: "equipe",
          message: `Cronograma de ${schedule.client.name} aprovado automaticamente (ajustes concluídos após o prazo do dia 25).`,
          dedupeKey: `auto_aprovado:${schedule.id}`,
          clientId: adjustment.post.clientId,
          scheduleId: schedule.id,
          email: {
            to,
            subject: `Cronograma auto-aprovado — ${schedule.client.name}`,
            html: notifyEmailHtml(
              "Cronograma aprovado automaticamente",
              [
                `Todos os ajustes de <strong>${escapeHtml(schedule.client.name)}</strong> foram concluídos após o prazo (dia 25).`,
                "O cronograma foi marcado como aprovado. Próximo passo: legendas, artes e envios semanais.",
              ]
            ),
          },
        });
        if (clientTo.length > 0) {
          await raiseAlert({
            kind: "cronograma_auto_aprovado",
            audience: "cliente",
            message: `Cliente ${schedule.client.name} avisado da aprovação automática.`,
            dedupeKey: `auto_aprovado_cliente:${schedule.id}`,
            clientId: adjustment.post.clientId,
            scheduleId: schedule.id,
            email: {
              to: clientTo,
              subject: "Seus ajustes foram concluídos — cronograma aprovado",
              html: notifyEmailHtml(
                "Ajustes concluídos ✓",
                [
                  `Olá, ${escapeHtml(schedule.client.name)}! Os ajustes que você pediu foram concluídos.`,
                  "Como o prazo de revisão já tinha encerrado, o cronograma foi aprovado automaticamente, como combinado.",
                ],
                link ?? undefined,
                "Ver cronograma"
              ),
            },
          });
        }
      } else if (clientTo.length > 0) {
        // prazo ainda aberto → cliente revisa e aprova
        await raiseAlert({
          kind: "ajuste_resolvido",
          audience: "cliente",
          message: `Ajustes concluídos para ${schedule.client.name} — aguardando aprovação do cliente.`,
          dedupeKey: `ajustes_concluidos:${schedule.id}:${Date.now()}`,
          clientId: adjustment.post.clientId,
          scheduleId: schedule.id,
          email: {
            to: clientTo,
            subject: "Ajustes concluídos — revise e aprove seu cronograma",
            html: notifyEmailHtml(
              "Seus ajustes foram concluídos ✓",
              [
                `Olá, ${escapeHtml(schedule.client.name)}! A equipe concluiu os ajustes que você pediu.`,
                "Revise o cronograma e aprove para seguirmos com a produção.",
              ],
              link ?? undefined,
              "Revisar e aprovar"
            ),
          },
        });
      }
    }
  }

  return Response.json({ ok: true, autoApproved });
}
