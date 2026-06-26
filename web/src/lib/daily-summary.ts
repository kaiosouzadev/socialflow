import { prisma } from "@/lib/prisma";
import { generateText, CAPTION_MODEL } from "@/lib/gemini";

const TZ = "America/Sao_Paulo";

/** Data de hoje "YYYY-MM-DD" no fuso de São Paulo. */
export function spToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Intervalo UTC [início, fim) de um dia SP (Brasil sem horário de verão = -03:00). */
export function spDayRange(day: string): { start: Date; end: Date } {
  const start = new Date(`${day}T00:00:00-03:00`);
  return { start, end: new Date(start.getTime() + 86400000) };
}

export type TodayPost = {
  id: string;
  clientName: string;
  theme: string | null;
  targets: string[];
  status: string;
  scheduledAt: Date;
  hasMedia: boolean;
  hasCaption: boolean;
};

/** Posts agendados/publicados para hoje (fuso SP), com flags de prontidão. */
export async function getTodayPosts(day = spToday()): Promise<TodayPost[]> {
  const { start, end } = spDayRange(day);
  const posts = await prisma.post.findMany({
    where: { scheduledAt: { gte: start, lt: end } },
    orderBy: { scheduledAt: "asc" },
    include: { client: { select: { name: true } } },
  });
  return posts.map((p) => ({
    id: p.id,
    clientName: p.client.name,
    theme: p.theme,
    targets: p.targets,
    status: p.status,
    scheduledAt: p.scheduledAt,
    hasMedia: !!p.mediaUrl,
    hasCaption: !!(p.caption || (p.captions && Object.keys(p.captions).length > 0)),
  }));
}

function buildPrompt(day: string, posts: TodayPost[]): string {
  const fmtHora = (d: Date) =>
    new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);

  const linhas = posts
    .map((p) => {
      const faltas = [
        !p.hasMedia ? "SEM mídia" : null,
        !p.hasCaption ? "SEM legenda" : null,
      ].filter(Boolean);
      return `- ${fmtHora(p.scheduledAt)} | ${p.clientName} | ${p.theme ?? "sem tema"} | ${p.targets.join("+")} | status:${p.status}${faltas.length ? " | ⚠ " + faltas.join(", ") : ""}`;
    })
    .join("\n");

  return [
    `Hoje é ${day}. Estes são os posts agendados para hoje (${posts.length} no total):`,
    "",
    linhas,
    "",
    "Escreva um resumo curto e direto em português do Brasil para as redatoras da agência.",
    "Inclua: total de posts e por cliente; principais temas; o que precisa de atenção AGORA",
    "(posts sem mídia ou sem legenda, falhas). Seja prático e acionável. Use no máximo 6 linhas,",
    "tom profissional e leve. Não invente dados além dos listados.",
  ].join("\n");
}

/** Gera (via IA) e persiste o resumo do dia. Retorna o conteúdo. */
export async function generateDailySummary(
  day = spToday()
): Promise<{ content: string; postCount: number }> {
  const posts = await getTodayPosts(day);

  let content: string;
  if (posts.length === 0) {
    content = "Nenhum post agendado para hoje. Bom momento para planejar a semana ou gerar um calendário com IA.";
  } else {
    content = await generateText({
      model: CAPTION_MODEL,
      prompt: buildPrompt(day, posts),
      system: "Você é assistente de uma agência de social media. Responde direto, sem rodeios.",
      temperature: 0.6,
    });
  }

  await prisma.dailySummary.upsert({
    where: { day },
    create: { day, content, postCount: posts.length },
    update: { content, postCount: posts.length },
  });

  return { content, postCount: posts.length };
}

/** Resumo cacheado do dia (ou null se ainda não gerado). */
export async function getCachedSummary(day = spToday()) {
  return prisma.dailySummary.findUnique({ where: { day } });
}
