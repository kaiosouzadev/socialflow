import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { raiseAlert, teamEmails, notifyEmailHtml, escapeHtml } from "@/lib/notify";
import { canEnterQueue } from "@/lib/publish-policy";
import { z } from "zod";

export const dynamic = "force-dynamic";

const MIN_ADJUST = 30;

const schema = z.object({
  action: z.enum(["approve", "adjust"]),
  comment: z.string().max(2000).optional(),
});

/**
 * Resposta do cliente a um post do link SEMANAL:
 * - approve: post aprovado → entra na fila de publicação (scheduled); para
 *   cliente só produção a aprovação é gravada e o post continua draft;
 * - adjust: comentário (mín. 30 chars) → ajuste pendente + alerta à equipe;
 *   o post NÃO publica até a redatora concluir o ajuste. Post que o cliente
 *   já aprovou não aceita ajuste (409 POST_ALREADY_APPROVED).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; postId: string }> }
) {
  const limited = enforceRateLimit(`semana-post:${clientIp(req)}`, 60, 60_000);
  if (limited) return limited;

  const { token, postId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const review = await prisma.weeklyReview.findUnique({
    where: { token },
    select: { id: true, clientId: true, client: { select: { name: true, agencyPublishes: true } } },
  });
  if (!review) return Response.json({ error: "Link inválido" }, { status: 404 });

  const post = await prisma.post.findFirst({
    where: { id: postId, weeklyReviewId: review.id },
    select: { id: true, theme: true, status: true, clientApproval: true },
  });
  if (!post) return Response.json({ error: "Post não encontrado" }, { status: 404 });
  if (post.status === "published" || post.status === "publishing") {
    return Response.json({ error: "Este post já foi publicado" }, { status: 409 });
  }

  if (parsed.data.action === "approve") {
    const pending = await prisma.postAdjustment.count({
      where: { postId, status: "pendente" },
    });
    if (pending > 0) {
      return Response.json(
        { error: "Há ajuste pendente neste post — aguarde a equipe concluir." },
        { status: 409 }
      );
    }
    await prisma.post.update({
      where: { id: postId },
      data: {
        clientApproval: "aprovado",
        clientApprovedAt: new Date(),
        ...(post.status === "draft" && canEnterQueue(review.client) ? { status: "scheduled" } : {}),
      },
    });
    return Response.json({ ok: true, approved: true });
  }

  // adjust — regra do usuário: aprovou, não pede mais ajuste por este link
  // (recusa antes de qualquer gravação ou alerta)
  if (post.clientApproval === "aprovado") {
    return Response.json(
      {
        error: "Esta postagem já foi aprovada. Para mudar algo, fale com a agência.",
        code: "POST_ALREADY_APPROVED",
      },
      { status: 409 }
    );
  }
  const comment = (parsed.data.comment ?? "").trim();
  if (comment.length < MIN_ADJUST) {
    return Response.json(
      { error: `Descreva o ajuste com pelo menos ${MIN_ADJUST} caracteres.` },
      { status: 400 }
    );
  }
  const adjustment = await prisma.postAdjustment.create({
    data: { postId, comment },
    select: { id: true, comment: true, status: true, createdAt: true },
  });
  // post agendado SEM aprovação do cliente (a equipe usou "Aprovar e agendar"
  // em /posts/[id]): sai da fila e volta para draft até a equipe concluir o ajuste
  if (post.status === "scheduled") {
    await prisma.post.update({
      where: { id: postId },
      data: { status: "draft", clientApproval: null },
    });
  }

  const to = await teamEmails();
  await raiseAlert({
    kind: "ajuste_solicitado",
    audience: "equipe",
    message: `${review.client.name} pediu ajuste no post semanal "${post.theme ?? ""}": ${comment.slice(0, 140)}`,
    dedupeKey: `ajuste_solicitado:${adjustment.id}`,
    clientId: review.clientId,
    postId,
    email: {
      to,
      subject: `Ajuste na postagem da semana — ${review.client.name}`,
      html: notifyEmailHtml(
        "Cliente pediu ajuste em post da semana",
        [
          `<strong>${escapeHtml(review.client.name)}</strong> comentou no post <strong>${escapeHtml(post.theme ?? "")}</strong>:`,
          `“${escapeHtml(comment)}”`,
          "O post fica fora da fila de publicação até o ajuste ser concluído.",
        ],
        `${process.env.SYSTEM_BASE_URL ?? ""}/aprovacoes`,
        "Abrir aprovações"
      ),
    },
  });

  return Response.json({ ok: true, adjustment });
}
