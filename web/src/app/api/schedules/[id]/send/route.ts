import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { newApprovalToken, approvalLink, monthLabel } from "@/lib/approval";
import { sendEmail, approvalEmailHtml } from "@/lib/email";

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

  const token = schedule.approvalToken ?? newApprovalToken();
  await prisma.schedule.update({
    where: { id },
    data: { approvalToken: token, status: "enviado_cliente", sentAt: new Date() },
  });

  const link = approvalLink(token);
  const result = await sendEmail({
    to: schedule.client.email,
    subject: `Cronograma de ${monthLabel(schedule.monthRef)} para aprovação`,
    html: approvalEmailHtml(schedule.client.name, monthLabel(schedule.monthRef), link),
  });

  return Response.json({ ok: true, link, emailed: result.sent, emailError: result.error ?? null });
}
