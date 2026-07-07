import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { newApprovalToken, approvalLink, monthLabel } from "@/lib/approval";
import { sendEmail, approvalEmailHtml, emailConfigured } from "@/lib/email";

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

  return Response.json({
    ok: true,
    link,
    to: clientEmail,
    emailed: result.sent,
    emailError: result.sent
      ? null
      : !emailConfigured()
        ? "RESEND_API_KEY/RESEND_FROM não configurados no servidor"
        : (result.error ?? null),
  });
}
