import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { generateAiText } from "@/lib/ai-text";
import { buildCaptionBatchPrompt, parseCaptionBatch } from "@/lib/caption-batch";
import { newApprovalToken } from "@/lib/approval";
import {
  nextWeekStartKey,
  spDateFromKey,
  addDaysToKey,
  shortLabel,
  postResponseDeadline,
} from "@/lib/deadlines";
import { raiseAlert, teamEmails, notifyEmailHtml, escapeHtml } from "@/lib/notify";
import { clientRecipients } from "@/lib/client-emails";

/**
 * Fase semanal do fluxo de aprovação:
 * 1) cronograma aprovado → posts da PRÓXIMA semana ganham conteúdo (legenda
 *    única FB+IG + slides de carrossel/reels) gerado em lote pela IA;
 * 2) post sem ARTE não vai para o cliente: é reposicionado +7 dias e a equipe
 *    é alertada;
 * 3) posts prontos entram num link semanal (/aprovar-semana/<token>) enviado
 *    ao cliente na quarta/quinta, com prazo de resposta por dia do post.
 */

const hasMedia = (p: { mediaUrl: string | null; mediaItems: unknown }) =>
  !!p.mediaUrl || (Array.isArray(p.mediaItems) && (p.mediaItems as unknown[]).length > 0);

/**
 * Gera legendas (+ slides p/ carrossel/reels) em UMA chamada para os posts sem conteúdo.
 * Prompt e leitura em lib/caption-batch: briefing do cliente no prompt e hashtags fixas
 * do cliente no fim de cada legenda.
 */
export async function generateWeekContent(clientId: string, postIds: string[]): Promise<number> {
  if (postIds.length === 0) return 0;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { name: true, toneOfVoice: true, briefing: true },
  });
  if (!client) return 0;

  const posts = await prisma.post.findMany({
    where: { id: { in: postIds } },
    select: {
      id: true, theme: true, explanation: true, format: true, targets: true,
      captions: true, slides: true,
    },
    orderBy: { scheduledAt: "asc" },
  });

  const needing = posts.filter((p) => {
    const caps = (p.captions as Record<string, string> | null) ?? {};
    const noCaption = !caps.instagram && !caps.facebook;
    const needsSlides =
      (p.format === "carrossel" || p.format === "reels") &&
      !(Array.isArray(p.slides) && (p.slides as unknown[]).length > 0);
    return noCaption || needsSlides;
  });
  if (needing.length === 0) return 0;

  const { system, prompt } = buildCaptionBatchPrompt(client, needing);
  const raw = await generateAiText("calendar", {
    label: "revisao-semanal",
    system,
    prompt,
    temperature: 0.9,
    json: true,
    maxOutputTokens: 32768,
    timeoutMs: 55_000,
  });
  const entries = parseCaptionBatch(raw, needing, client.briefing);

  let updated = 0;
  for (let i = 0; i < needing.length; i++) {
    const post = needing[i];
    const entry = entries[i];
    if (!entry) continue;

    const captions: Record<string, string> = {};
    if (post.targets.includes("instagram")) captions.instagram = entry.shared;
    if (post.targets.includes("facebook")) captions.facebook = entry.shared;
    if (post.targets.includes("linkedin")) captions.linkedin = entry.linkedin || entry.shared;

    const slides = entry.slides?.map((text) => ({ text })) ?? null;

    await prisma.post.update({
      where: { id: post.id },
      data: {
        captions: captions as Prisma.InputJsonValue,
        ...(slides?.length ? { slides: slides as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    updated++;
  }
  return updated;
}

export type WeeklyRunResult = {
  reviews: { client: string; posts: number; link: string }[];
  postponed: { client: string; post: string }[];
  contentGenerated: number;
  skipped: { client: string; reason: string }[];
};

/** Monta e envia os links semanais da PRÓXIMA semana (rodar quarta/quinta). */
export async function runWeeklyReviews(origin?: string): Promise<WeeklyRunResult> {
  const result: WeeklyRunResult = { reviews: [], postponed: [], contentGenerated: 0, skipped: [] };

  const weekKey = nextWeekStartKey();
  const weekStart = spDateFromKey(weekKey);
  const weekEnd = spDateFromKey(addDaysToKey(weekKey, 7));

  // clientes com aprovação e cronograma aprovado que tenham posts na próxima semana
  const clients = await prisma.client.findMany({
    where: {
      plan: "aprovacao_cliente",
      posts: {
        some: {
          status: "draft",
          scheduledAt: { gte: weekStart, lt: weekEnd },
          schedule: { is: { status: "aprovado_cliente" } },
        },
      },
    },
    select: { id: true, name: true, email: true, extraEmails: true },
  });

  const base = (process.env.SYSTEM_BASE_URL ?? origin ?? "").replace(/\/$/, "");

  for (const client of clients) {
    const posts = await prisma.post.findMany({
      where: {
        clientId: client.id,
        status: "draft",
        scheduledAt: { gte: weekStart, lt: weekEnd },
        schedule: { is: { status: "aprovado_cliente" } },
      },
      orderBy: { scheduledAt: "asc" },
    });
    if (posts.length === 0) continue;

    // 1) conteúdo (legenda/slides) para quem ainda não tem
    try {
      result.contentGenerated += await generateWeekContent(client.id, posts.map((p) => p.id));
    } catch (e) {
      console.error(`[weekly] conteúdo ${client.name}:`, e);
      result.skipped.push({ client: client.name, reason: "falha ao gerar conteúdo (IA)" });
    }

    // 2) sem arte não vai pro cliente: adia +7d e alerta a equipe
    const fresh = await prisma.post.findMany({
      where: { id: { in: posts.map((p) => p.id) } },
      orderBy: { scheduledAt: "asc" },
    });
    const ready = [];
    for (const p of fresh) {
      if (hasMedia(p)) {
        ready.push(p);
        continue;
      }
      const newDate = new Date(p.scheduledAt.getTime() + 7 * 86_400_000);
      await prisma.post.update({ where: { id: p.id }, data: { scheduledAt: newDate } });
      result.postponed.push({ client: client.name, post: p.theme ?? p.id });
      const to = await teamEmails();
      await raiseAlert({
        kind: "sem_arte",
        audience: "equipe",
        message: `"${p.theme ?? "post"}" (${client.name}) estava sem arte — reposicionado de ${shortLabel(p.scheduledAt)} para ${shortLabel(newDate)}.`,
        dedupeKey: `sem_arte:${p.id}:${weekKey}`,
        clientId: client.id,
        postId: p.id,
        email: {
          to,
          subject: `Post sem arte reposicionado — ${client.name}`,
          html: notifyEmailHtml(
            "Post sem arte foi adiado",
            [
              `O post <strong>${escapeHtml(p.theme ?? "")}</strong> de <strong>${escapeHtml(client.name)}</strong> não tinha arte pronta para o envio semanal.`,
              `Foi reposicionado de ${shortLabel(p.scheduledAt)} para <strong>${shortLabel(newDate)}</strong>. Suba a arte para ele entrar no próximo envio.`,
            ],
            `${base}/posts/${p.id}`,
            "Abrir post"
          ),
        },
      });
    }
    if (ready.length === 0) {
      result.skipped.push({ client: client.name, reason: "nenhum post com arte pronta na semana" });
      continue;
    }

    // 3) link semanal (reusa o da semana se já existir)
    const review =
      (await prisma.weeklyReview.findUnique({
        where: { clientId_weekStart: { clientId: client.id, weekStart } },
      })) ??
      (await prisma.weeklyReview.create({
        data: { clientId: client.id, weekStart, token: newApprovalToken() },
      }));

    await prisma.post.updateMany({
      where: { id: { in: ready.map((p) => p.id) } },
      data: { weeklyReviewId: review.id },
    });

    const link = `${base}/aprovar-semana/${review.token}`;
    // todos os e-mails do cliente (principal primeiro), 1 e-mail por destinatário
    const clientTo = clientRecipients(client);
    const weekLabel = `${shortLabel(weekStart)} a ${shortLabel(new Date(weekEnd.getTime() - 86_400_000))}`;

    await raiseAlert({
      kind: "semanal_enviado",
      audience: "cliente",
      message: `Link semanal enviado para ${client.name}: ${ready.length} post(s) da semana ${weekLabel}.`,
      dedupeKey: `semanal_enviado:${review.id}`,
      clientId: client.id,
      email: clientTo.length > 0
        ? {
            to: clientTo,
            subject: `Suas postagens da próxima semana estão prontas para revisão`,
            html: notifyEmailHtml(
              "Postagens da próxima semana",
              [
                `Olá, ${escapeHtml(client.name)}! As postagens completas (texto e arte) da semana ${weekLabel} estão prontas.`,
                "Cada postagem tem um prazo de resposta — aprove ou peça ajustes dentro do prazo para garantir a publicação.",
              ],
              link,
              "Revisar postagens"
            ),
          }
        : undefined,
    });

    result.reviews.push({ client: client.name, posts: ready.length, link });
  }

  return result;
}

/** deadline serializável para a UI. */
export function deadlineFor(scheduledAt: Date): { at: Date; label: string; overdue: boolean } {
  const at = postResponseDeadline(scheduledAt);
  return { at, label: shortLabel(at), overdue: Date.now() > at.getTime() };
}
