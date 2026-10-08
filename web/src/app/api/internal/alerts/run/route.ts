import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkInternalKey, noStore } from "@/lib/internal-auth";
import { scheduleClientDeadline, spTodayKey, postResponseDeadline, shortLabel } from "@/lib/deadlines";
import { raiseAlert, teamEmails, notifyEmailHtml, escapeHtml } from "@/lib/notify";
import { approvalLink } from "@/lib/approval";
import { clientRecipients } from "@/lib/client-emails";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Varredura diária de prazos — "nada passa despercebido". Agendar no n8n
 * todo dia (ex: 9h SP). Idempotente: cada aviso tem dedupeKey por dia.
 *
 * 1) Cronograma enviado e sem resposta: lembra o CLIENTE nos dias 21-25 do mês
 *    anterior; passou do dia 25 → alerta a EQUIPE todo dia.
 * 2) Post do link semanal sem resposta com prazo vencendo/vencido: lembra o
 *    cliente e alerta a redatora.
 */
export async function POST(req: NextRequest) {
  // nada desta rota (contagens, avisos) fica em cache de proxy/CDN
  return noStore(await run(req));
}

async function run(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    const denied = checkInternalKey(req);
    if (denied) return denied;
  }

  const today = spTodayKey();
  const now = new Date();
  const base = (process.env.SYSTEM_BASE_URL ?? req.nextUrl.origin ?? "").replace(/\/$/, "");
  const out = { scheduleReminders: 0, scheduleOverdue: 0, postReminders: 0 };
  const team = await teamEmails();

  // ---- 1) cronogramas aguardando o cliente ----
  const openSchedules = await prisma.schedule.findMany({
    where: { status: { in: ["enviado_cliente", "em_revisao"] }, approvalToken: { not: null } },
    select: {
      id: true,
      status: true,
      monthRef: true,
      approvalToken: true,
      clientId: true,
      client: { select: { name: true, email: true, extraEmails: true } },
    },
  });

  for (const s of openSchedules) {
    const deadline = scheduleClientDeadline(s.monthRef);
    const msLeft = deadline.getTime() - now.getTime();
    const daysLeft = Math.ceil(msLeft / 86_400_000);
    const link = approvalLink(s.approvalToken!, base);
    const pending = await prisma.postAdjustment.count({
      where: { status: "pendente", post: { scheduleId: s.id } },
    });

    if (msLeft > 0 && daysLeft <= 5) {
      // reta final (dias ~21-25): lembra o cliente (1x por dia), em todos os e-mails dele
      const clientTo = clientRecipients(s.client);
      const r = await raiseAlert({
        kind: "prazo_cronograma",
        audience: "cliente",
        message: `Lembrete enviado a ${s.client.name}: ${daysLeft} dia(s) para aprovar o cronograma.`,
        dedupeKey: `prazo_cliente:${s.id}:${today}`,
        clientId: s.clientId,
        scheduleId: s.id,
        email: clientTo.length > 0
          ? {
              to: clientTo,
              subject:
                daysLeft <= 1
                  ? "Último dia para aprovar seu cronograma"
                  : `Faltam ${daysLeft} dias para aprovar seu cronograma`,
              html: notifyEmailHtml(
                "Seu cronograma aguarda aprovação",
                [
                  `Olá, ${escapeHtml(s.client.name)}! O prazo para aprovar ou pedir ajustes no cronograma vai até <strong>${shortLabel(deadline)}</strong>.`,
                  "Depois disso, os ajustes pendentes serão concluídos pela equipe e o cronograma seguirá aprovado automaticamente.",
                ],
                link,
                "Revisar cronograma"
              ),
            }
          : undefined,
      });
      if (r.created) out.scheduleReminders++;
    } else if (msLeft <= 0) {
      // prazo vencido: equipe precisa agir (resolver ajustes → auto-aprova; ou cobrar)
      const r = await raiseAlert({
        kind: "prazo_cronograma",
        audience: "equipe",
        message: `Prazo vencido: cronograma de ${s.client.name} (${s.status === "em_revisao" ? `${pending} ajuste(s) pendente(s)` : "sem resposta do cliente"}).`,
        dedupeKey: `prazo_equipe:${s.id}:${today}`,
        clientId: s.clientId,
        scheduleId: s.id,
        email: {
          to: team,
          subject: `Prazo vencido — cronograma de ${s.client.name}`,
          html: notifyEmailHtml(
            "Cronograma com prazo vencido",
            [
              `O prazo do cliente <strong>${escapeHtml(s.client.name)}</strong> (dia 25) passou.`,
              s.status === "em_revisao"
                ? `Há <strong>${pending} ajuste(s) pendente(s)</strong> — ao concluir todos, o cronograma aprova automaticamente.`
                : "O cliente não respondeu. Entre em contato ou aprove internamente.",
            ],
            `${base}/aprovacoes`,
            "Abrir aprovações"
          ),
        },
      });
      if (r.created) out.scheduleOverdue++;
    }
  }

  // ---- 2) posts semanais sem resposta ----
  const waiting = await prisma.post.findMany({
    where: {
      weeklyReviewId: { not: null },
      clientApproval: null,
      status: "draft",
      scheduledAt: { gte: now },
    },
    select: {
      id: true,
      theme: true,
      scheduledAt: true,
      clientId: true,
      client: { select: { name: true, email: true, extraEmails: true } },
      weeklyReview: { select: { token: true } },
    },
  });

  for (const p of waiting) {
    const deadline = postResponseDeadline(p.scheduledAt);
    // alerta no dia do prazo e depois dele (até o post chegar)
    if (now.getTime() < deadline.getTime() - 86_400_000) continue;
    const overdue = now > deadline;
    const link = p.weeklyReview ? `${base}/aprovar-semana/${p.weeklyReview.token}` : `${base}/aprovacoes`;
    const clientTo = clientRecipients(p.client);

    const r1 = await raiseAlert({
      kind: "sem_resposta",
      audience: "cliente",
      message: `Lembrete a ${p.client.name}: "${p.theme ?? "post"}" ${overdue ? "com prazo vencido" : "vence hoje"} (${shortLabel(deadline)}).`,
      dedupeKey: `sem_resposta_cliente:${p.id}:${today}`,
      clientId: p.clientId,
      postId: p.id,
      email: clientTo.length > 0
        ? {
            to: clientTo,
            subject: overdue
              ? `Postagem aguardando sua resposta — prazo vencido`
              : `Hoje é o prazo para aprovar uma postagem`,
            html: notifyEmailHtml(
              overdue ? "Postagem com prazo vencido" : "Prazo de aprovação é hoje",
              [
                `Olá, ${escapeHtml(p.client.name)}! A postagem <strong>${escapeHtml(p.theme ?? "")}</strong> (agendada para ${shortLabel(p.scheduledAt)}) ainda não foi aprovada.`,
                `O prazo de resposta ${overdue ? "venceu" : "termina"} em <strong>${shortLabel(deadline)}</strong>.`,
              ],
              link,
              "Revisar postagem"
            ),
          }
        : undefined,
    });
    const r2 = await raiseAlert({
      kind: "sem_resposta",
      audience: "equipe",
      message: `${p.client.name} não respondeu "${p.theme ?? "post"}" — prazo ${overdue ? "VENCIDO" : "vence hoje"} (${shortLabel(deadline)}).`,
      dedupeKey: `sem_resposta_equipe:${p.id}:${today}`,
      clientId: p.clientId,
      postId: p.id,
      email: {
        to: team,
        subject: `Cliente sem resposta — ${p.client.name}`,
        html: notifyEmailHtml(
          "Post aguardando resposta do cliente",
          [
            `<strong>${escapeHtml(p.client.name)}</strong> ainda não respondeu a postagem <strong>${escapeHtml(p.theme ?? "")}</strong> (vai ao ar ${shortLabel(p.scheduledAt)}).`,
            `Prazo de resposta: <strong>${shortLabel(deadline)}</strong>${overdue ? " — JÁ VENCIDO." : "."}`,
          ],
          `${base}/posts/${p.id}`,
          "Abrir post"
        ),
      },
    });
    if (r1.created || r2.created) out.postReminders++;
  }

  return Response.json(out);
}
