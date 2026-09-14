import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { newApprovalToken, approvalLink, monthLabel } from "@/lib/approval";
import { sendEmail, approvalEmailHtml, emailConfigured } from "@/lib/email";
import { scheduleSendWindow, shortLabel } from "@/lib/deadlines";

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
    include: { client: { select: { name: true, email: true } }, _count: { select: { posts: true } } },
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

  // diagnóstico claro antes de enviar
  const clientEmail = schedule.client.email?.trim() ?? "";
  if (!clientEmail) {
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
  const result = await sendEmail({
    to: clientEmail,
    subject: `Cronograma de ${monthLabel(schedule.monthRef)} para aprovação`,
    html: approvalEmailHtml(schedule.client.name, monthLabel(schedule.monthRef), link),
  });

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
    to: clientEmail,
    emailed: result.sent,
    windowWarning,
    emailError: result.sent
      ? null
      : !emailConfigured()
        ? "RESEND_API_KEY/RESEND_FROM não configurados no servidor"
        : (result.error ?? null),
  });
}
