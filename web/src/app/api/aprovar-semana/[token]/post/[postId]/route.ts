import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { raiseAlert, teamEmails, notifyEmailHtml, escapeHtml } from "@/lib/notify";
import { canEnterQueue } from "@/lib/publish-policy";
import { z } from "zod";
import {
  LINK_ACTIONS_PER_MINUTE,
  LINK_ADJUSTS_PER_HOUR,
  bodyTooLarge,
  declaredBodyTooLarge,
  isTokenShaped,
  linkNotFound,
  publicJson,
  readJsonCapped,
  tokenKey,
  weeklyLinkBlocked,
  weeklyLinkState,
  withPublicHeaders,
} from "@/lib/approval";

export const dynamic = "force-dynamic";

const MIN_ADJUST = 30;

const schema = z.object({
  action: z.enum(["approve", "adjust"]),
  comment: z.string().max(2000).optional(),
});

const ALREADY_APPROVED = {
  error: "Esta postagem já foi aprovada. Para mudar algo, fale com a agência.",
  code: "POST_ALREADY_APPROVED",
};

/**
 * Resposta do cliente a um post do link SEMANAL:
 * - approve: post aprovado → entra na fila de publicação (scheduled); para
 *   cliente só produção a aprovação é gravada e o post continua draft;
 * - adjust: comentário (mín. 30 chars) → ajuste pendente + alerta à equipe;
 *   o post NÃO publica até a redatora concluir o ajuste.
 * Post que o cliente já aprovou não aceita mais nada por este link — nem ajuste nem uma
 * nova aprovação (409 POST_ALREADY_APPROVED): se a equipe tirou o post da fila, um link
 * antigo não o põe de volta (AC-05).
 * Ciclo de vida do link (lib/approval): semana concluída → 409; 60 dias após o envio → 410.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; postId: string }> }
) {
  const limited = enforceRateLimit(`semana-post:${clientIp(req)}`, 60, 60_000);
  if (limited) return withPublicHeaders(limited);
  if (declaredBodyTooLarge(req)) return bodyTooLarge();

  const { token, postId } = await params;
  if (!isTokenShaped(token)) return linkNotFound();
  const linkId = tokenKey(token);
  const perLink = enforceRateLimit(`semana-link:${linkId}`, LINK_ACTIONS_PER_MINUTE, 60_000);
  if (perLink) return withPublicHeaders(perLink);

  const review = await prisma.weeklyReview.findUnique({
    where: { token },
    select: {
      id: true,
      clientId: true,
      status: true,
      sentAt: true,
      client: { select: { name: true, agencyPublishes: true } },
    },
  });
  if (!review) return linkNotFound();
  // concluída → só leitura (409); 60 dias após o envio → 410 — antes de ler o corpo e de gravar
  const blocked = weeklyLinkBlocked(weeklyLinkState(review));
  if (blocked) return blocked;

  const body = await readJsonCapped(req);
  if (body.tooLarge) return bodyTooLarge();
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return publicJson({ error: parsed.error.flatten() }, 400);

  const post = await prisma.post.findFirst({
    where: { id: postId, weeklyReviewId: review.id },
    select: { id: true, theme: true, status: true, clientApproval: true },
  });
  if (!post) return publicJson({ error: "Post não encontrado" }, 404);
  if (post.status === "published" || post.status === "publishing") {
    return publicJson({ error: "Este post já foi publicado" }, 409);
  }
  // regra do usuário: aprovou, não pede mais ajuste nem aprova de novo por este link
  // (recusa antes de qualquer gravação ou alerta)
  if (post.clientApproval === "aprovado") return publicJson(ALREADY_APPROVED, 409);

  if (parsed.data.action === "approve") {
    const pending = await prisma.postAdjustment.count({
      where: { postId, status: "pendente" },
    });
    if (pending > 0) {
      return publicJson({ error: "Há ajuste pendente neste post — aguarde a equipe concluir." }, 409);
    }
    await prisma.post.update({
      where: { id: postId },
      data: {
        clientApproval: "aprovado",
        clientApprovedAt: new Date(),
        ...(post.status === "draft" && canEnterQueue(review.client) ? { status: "scheduled" } : {}),
      },
    });
    return publicJson({ ok: true, approved: true });
  }

  const comment = (parsed.data.comment ?? "").trim();
  if (comment.length < MIN_ADJUST) {
    return publicJson({ error: `Descreva o ajuste com pelo menos ${MIN_ADJUST} caracteres.` }, 400);
  }
  // cada ajuste manda e-mail para a equipe: teto por link por hora (qualquer IP)
  const adjustLimited = enforceRateLimit(`semana-adjust:${linkId}`, LINK_ADJUSTS_PER_HOUR, 60 * 60_000);
  if (adjustLimited) return withPublicHeaders(adjustLimited);

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

  return publicJson({ ok: true, adjustment });
}
