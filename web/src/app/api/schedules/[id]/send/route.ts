import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { newApprovalToken, approvalLink, monthLabel } from "@/lib/approval";
import { sendEmailEach, approvalEmailHtml, emailConfigured } from "@/lib/email";
import { scheduleSendWindow, shortLabel } from "@/lib/deadlines";
import { clientRecipients } from "@/lib/client-emails";
import { toUserMessage } from "@/lib/user-facing-error";

export const dynamic = "force-dynamic";

/** Envia o cronograma para aprovação do cliente: gera token, e-mail, status. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  const schedule = await prisma.schedule.findUnique({
    where: { id },
    include: {
      client: { select: { name: true, email: true, extraEmails: true } },
      _count: { select: { posts: true } },
    },
  });
  if (!schedule) return Response.json({ error: "Cronograma não encontrado" }, { status: 404 });
  if (schedule._count.posts === 0) {
    return Response.json({ error: "Cronograma sem posts" }, { status: 400 });
  }
  // reenviar um cronograma já aprovado reabriria a edição do cliente por acidente
  if (schedule.status === "aprovado_cliente") {
    return Response.json(
      { error: "Cronograma já aprovado. Use 'Reverter aprovação' antes de reenviar." },
      { status: 409 }
    );
  }

  // diagnóstico claro antes de enviar: todos os e-mails do cliente, o principal primeiro
  const recipients = clientRecipients(schedule.client);
  if (recipients.length === 0) {
    return Response.json(
      { error: "Cliente sem e-mail cadastrado. Preencha o campo e-mail no cadastro do cliente." },
      { status: 400 }
    );
  }

  const token = schedule.approvalToken ?? newApprovalToken();
  await prisma.schedule.update({
    where: { id },
    data: { approvalToken: token, status: "enviado_cliente", sentAt: new Date() },
  });

  const link = approvalLink(token, req.nextUrl.origin);
  // 1 e-mail por destinatário: ninguém vê o endereço do outro
  const results = await sendEmailEach(recipients, {
    subject: `Cronograma de ${monthLabel(schedule.monthRef)} para aprovação`,
    html: approvalEmailHtml(schedule.client.name, monthLabel(schedule.monthRef), link),
  });
  const failed = results.filter((r) => !r.sent);
  const configured = emailConfigured();
  if (configured && failed.length > 0) {
    // o detalhe técnico fica só no log; o usuário recebe a mensagem amigável
    console.error(
      `[schedules/send] ${failed.length}/${results.length} e-mail(s) não enviado(s):`,
      failed.map((r) => r.error)
    );
  }

  // janela ideal de envio: dias 10-20 do mês anterior (aviso, não bloqueio)
  const win = scheduleSendWindow(schedule.monthRef);
  const now = new Date();
  const windowWarning =
    now < win.start
      ? `Envio antes da janela ideal (${shortLabel(win.start)} a ${shortLabel(win.end)}).`
      : now > win.end
        ? `Envio FORA da janela ideal (${shortLabel(win.start)} a ${shortLabel(win.end)}) — o cliente terá menos tempo até o prazo do dia 25.`
        : null;

  return Response.json({
    ok: true,
    link,
    // `to` mantido para compatibilidade: todos os destinatários unidos por ", "
    to: recipients.join(", "),
    recipients,
    failed: failed.map((r) => r.to),
    // verdadeiro se pelo menos um e-mail saiu
    emailed: failed.length < results.length,
    windowWarning,
    // motivo da falha (null quando todos foram enviados), sem detalhe técnico
    emailError:
      failed.length === 0
        ? null
        : !configured
          ? toUserMessage("RESEND_API_KEY/RESEND_FROM não configurados no servidor")
          : toUserMessage(failed[0].error, "Não foi possível enviar o e-mail. Tente de novo em instantes."),
  });
}
