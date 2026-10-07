import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { raiseAlert, teamEmails, notifyEmailHtml, escapeHtml } from "@/lib/notify";
import { z } from "zod";

export const dynamic = "force-dynamic";

const OPEN = ["enviado_cliente", "em_revisao"];

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
  if (limited) return limited;

  const { token, postId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  // F10 (decisão do usuário, 07/10): o link mensal não mostra nem edita legenda — ela é
  // revisada no link semanal (rota própria: /api/aprovar-semana/[token]/post/[postId]).
  // "edit" e "regenerate" devolviam legenda (e "regenerate" chamava a IA): agora recusam
  // antes de qualquer leitura no banco e de qualquer chamada à IA.
  if (parsed.data.action === "edit" || parsed.data.action === "regenerate") {
    return Response.json({ error: CAPTION_IN_WEEKLY }, { status: 409 });
  }

  const schedule = await prisma.schedule.findUnique({
    where: { approvalToken: token },
    select: {
      id: true,
      status: true,
      client: { select: { name: true } },
    },
  });
  if (!schedule) return Response.json({ error: "Link inválido" }, { status: 404 });
  if (!OPEN.includes(schedule.status)) {
    return Response.json({ error: "Cronograma não está aberto para edição" }, { status: 409 });
  }

  const post = await prisma.post.findFirst({
    where: { id: postId, scheduleId: schedule.id },
  });
  if (!post) return Response.json({ error: "Post não encontrado" }, { status: 404 });
  // pós-reversão o link reabre, mas post já publicado não muda mais
  if (post.status === "published" || post.status === "publishing") {
    return Response.json({ error: "Este post já foi publicado e não pode ser alterado" }, { status: 409 });
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
    return Response.json({ ok: true, clientNote: note || null });
  }

  // ---- pedido de ajuste (fase cronograma): comentário do cliente no post ----
  // (única ação que sobra: "edit"/"regenerate" recusam no início e "note" já retornou)
  const comment = (parsed.data.comment ?? "").trim();
  if (comment.length < MIN_ADJUST_CHARS) {
    return Response.json(
      { error: `Descreva o ajuste com pelo menos ${MIN_ADJUST_CHARS} caracteres.` },
      { status: 400 }
    );
  }

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

  return Response.json({ ok: true, adjustment });
}
