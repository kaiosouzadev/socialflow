import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { raiseAlert, teamEmails, notifyEmailHtml, escapeHtml } from "@/lib/notify";
import { z } from "zod";
import {
  LINK_ACTIONS_PER_MINUTE,
  LINK_ADJUSTS_PER_HOUR,
  bodyTooLarge,
  declaredBodyTooLarge,
  isTokenShaped,
  linkNotFound,
  monthlyLinkBlocked,
  monthlyLinkState,
  publicJson,
  readJsonCapped,
  tokenKey,
  withPublicHeaders,
} from "@/lib/approval";

export const dynamic = "force-dynamic";

// comentário de ajuste precisa dizer O QUE mudar — mínimo de 30 caracteres
export const MIN_ADJUST_CHARS = 30;

const CAPTION_IN_WEEKLY = "A legenda é revisada no link semanal.";

const schema = z.object({
  // "edit" e "regenerate" (legenda) continuam aceitos só para responder o 409 em pt-BR abaixo
  action: z.enum(["edit", "regenerate", "note", "adjust"]),
  // comentário do cliente pedindo ajuste neste post ("" limpa) — action "note"
  clientNote: z.string().max(1000).optional(),
  // pedido de ajuste formal (mín. 30 chars, bloqueia aprovação) — action "adjust"
  comment: z.string().max(2000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; postId: string }> }
) {
  const limited = enforceRateLimit(`aprovar-post:${clientIp(req)}`, 60, 60_000);
  if (limited) return withPublicHeaders(limited);
  if (declaredBodyTooLarge(req)) return bodyTooLarge();

  const { token, postId } = await params;
  if (!isTokenShaped(token)) return linkNotFound();
  const linkId = tokenKey(token);
  const perLink = enforceRateLimit(`aprovar-link:${linkId}`, LINK_ACTIONS_PER_MINUTE, 60_000);
  if (perLink) return withPublicHeaders(perLink);

  // corpo com teto de 32 KB (CF-16); só depois o zod
  const body = await readJsonCapped(req);
  if (body.tooLarge) return bodyTooLarge();
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return publicJson({ error: parsed.error.flatten() }, 400);

  // F10 (decisão do usuário, 07/10): o link mensal não mostra nem edita legenda — ela é
  // revisada no link semanal (rota própria: /api/aprovar-semana/[token]/post/[postId]).
  // "edit" e "regenerate" devolviam legenda (e "regenerate" chamava a IA): agora recusam
  // antes de qualquer leitura no banco e de qualquer chamada à IA.
  if (parsed.data.action === "edit" || parsed.data.action === "regenerate") {
    return publicJson({ error: CAPTION_IN_WEEKLY }, 409);
  }

  const schedule = await prisma.schedule.findUnique({
    where: { approvalToken: token },
    select: {
      id: true,
      status: true,
      sentAt: true,
      createdAt: true,
      client: { select: { name: true } },
    },
  });
  if (!schedule) return linkNotFound();
  // aprovado → só leitura (409); 60 dias após o envio → 410 — antes de qualquer gravação
  const blocked = monthlyLinkBlocked(monthlyLinkState(schedule));
  if (blocked) return blocked;

  const post = await prisma.post.findFirst({
    where: { id: postId, scheduleId: schedule.id },
  });
  if (!post) return publicJson({ error: "Post não encontrado" }, 404);
  // pós-reversão o link reabre, mas post já publicado não muda mais
  if (post.status === "published" || post.status === "publishing") {
    return publicJson({ error: "Este post já foi publicado e não pode ser alterado" }, 409);
  }

  // marca em revisão na primeira mexida
  const markReview = schedule.status === "enviado_cliente"
    ? prisma.schedule.update({ where: { id: schedule.id }, data: { status: "em_revisao" } })
    : null;

  // comentário livre do cliente neste post (rascunho local do modal)
  if (parsed.data.action === "note") {
    const note = (parsed.data.clientNote ?? "").trim();
    await prisma.$transaction([
      prisma.post.update({
        where: { id: postId },
        data: { clientNote: note || null },
      }),
      ...(markReview ? [markReview] : []),
    ]);
    return publicJson({ ok: true, clientNote: note || null });
  }

  // ---- pedido de ajuste (fase cronograma): comentário do cliente no post ----
  // (única ação que sobra: "edit"/"regenerate" recusam no início e "note" já retornou)
  const comment = (parsed.data.comment ?? "").trim();
  if (comment.length < MIN_ADJUST_CHARS) {
    return publicJson({ error: `Descreva o ajuste com pelo menos ${MIN_ADJUST_CHARS} caracteres.` }, 400);
  }
  // cada ajuste manda e-mail para a equipe: teto por link por hora (qualquer IP)
  const adjustLimited = enforceRateLimit(`aprovar-adjust:${linkId}`, LINK_ADJUSTS_PER_HOUR, 60 * 60_000);
  if (adjustLimited) return withPublicHeaders(adjustLimited);

  const [adjustment] = await prisma.$transaction([
    prisma.postAdjustment.create({
      data: { postId, comment },
      select: { id: true, comment: true, status: true, createdAt: true },
    }),
    prisma.schedule.update({
      where: { id: schedule.id },
      data: { status: "em_revisao", changesAskedAt: new Date() },
    }),
  ]);

  // avisa a equipe na hora — ajuste do cliente não pode passar batido
  const to = await teamEmails();
  await raiseAlert({
    kind: "ajuste_solicitado",
    audience: "equipe",
    message: `${schedule.client.name} pediu ajuste em "${post.theme ?? "post"}": ${comment.slice(0, 140)}`,
    dedupeKey: `ajuste_solicitado:${adjustment.id}`,
    clientId: post.clientId,
    scheduleId: schedule.id,
    postId,
    email: {
      to,
      subject: `Ajuste solicitado — ${schedule.client.name}`,
      html: notifyEmailHtml(
        "Cliente pediu ajuste no cronograma",
        [
          `<strong>${escapeHtml(schedule.client.name)}</strong> comentou no post <strong>${escapeHtml(post.theme ?? "")}</strong>:`,
          `“${escapeHtml(comment)}”`,
          "Resolva o ajuste em Aprovações para liberar a aprovação do cronograma.",
        ],
        `${process.env.SYSTEM_BASE_URL ?? ""}/aprovacoes`,
        "Abrir aprovações"
      ),
    },
  });

  return publicJson({ ok: true, adjustment });
}
