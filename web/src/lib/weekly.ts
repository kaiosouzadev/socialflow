import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { generateText, parseModelJson, CALENDAR_MODEL } from "@/lib/gemini";
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

type GenIdea = { shared?: string; linkedin?: string; slides?: string[] };

const hasMedia = (p: { mediaUrl: string | null; mediaItems: unknown }) =>
  !!p.mediaUrl || (Array.isArray(p.mediaItems) && (p.mediaItems as unknown[]).length > 0);

/** Gera legendas (+ slides p/ carrossel/reels) em UMA chamada para os posts sem conteúdo. */
export async function generateWeekContent(clientId: string, postIds: string[]): Promise<number> {
  if (postIds.length === 0) return 0;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { name: true, toneOfVoice: true },
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

  const system =
    "Você é redator de social media de uma agência brasileira. Produz conteúdo final " +
    "pronto para publicação, em pt-BR, no tom de voz do cliente. Facebook e Instagram " +
    "usam SEMPRE a mesma legenda. Responda SOMENTE com JSON válido.";

  const itemsDesc = needing
    .map((p, i) => {
      const wantSlides = p.format === "carrossel" || p.format === "reels";
      return `${i + 1}. id="${p.id}" formato=${p.format} título="${p.theme ?? ""}"${
        p.explanation ? ` briefing="${p.explanation}"` : ""
      }${wantSlides ? " (gerar slides)" : ""}`;
    })
    .join("\n");

  const prompt = [
    `Cliente: ${client.name}.`,
    client.toneOfVoice ? `Tom de voz: ${client.toneOfVoice}.` : "Tom de voz: profissional e próximo.",
    "Para CADA post abaixo, gere:",
    '- "shared": legenda única FB+IG (envolvente, call-to-action, 3-6 hashtags, emojis moderados);',
    '- "linkedin": versão profissional (somente se fizer sentido; opcional);',
    '- "slides": SOMENTE para carrossel/reels — array de 5 a 8 textos curtos, um por tela, contando a história do post (primeiro = capa com gancho, último = call-to-action). Sem slides para formato feed/story.',
    "Posts:",
    itemsDesc,
    'Responda em JSON: {"posts":[{"id":"<id>","shared":"...","linkedin":"...","slides":["..."]}]} — um item por post, na mesma ordem.',
  ].join("\n");

  const raw = await generateText({
    model: CALENDAR_MODEL,
    system,
    prompt,
    temperature: 0.9,
    json: true,
    maxOutputTokens: 32768,
    timeoutMs: 55_000,
  });
  const data = parseModelJson<{ posts?: (GenIdea & { id?: string })[] }>(raw);
  const ideas = Array.isArray(data.posts) ? data.posts : [];

  let updated = 0;
  for (let i = 0; i < needing.length; i++) {
    const post = needing[i];
    const idea = ideas.find((x) => x.id === post.id) ?? ideas[i];
    if (!idea) continue;
    const shared = typeof idea.shared === "string" ? idea.shared.trim() : "";
    const li = typeof idea.linkedin === "string" ? idea.linkedin.trim() : "";
    if (!shared) continue;

    const captions: Record<string, string> = {};
    if (post.targets.includes("instagram")) captions.instagram = shared;
    if (post.targets.includes("facebook")) captions.facebook = shared;
    if (post.targets.includes("linkedin")) captions.linkedin = li || shared;

    const wantSlides = post.format === "carrossel" || post.format === "reels";
    const slides =
      wantSlides && Array.isArray(idea.slides)
        ? idea.slides
            .filter((s): s is string => typeof s === "string" && !!s.trim())
            .slice(0, 20)
            .map((text) => ({ text: text.trim().slice(0, 2000) }))
        : null;

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
