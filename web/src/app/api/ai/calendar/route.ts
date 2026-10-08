import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";
import { parseModelJson } from "@/lib/gemini";
import { generateAiText } from "@/lib/ai-text";
import { getTextModel } from "@/lib/ai-models";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { enforceAiQuota } from "@/lib/ai-quota";
import { readJsonLimited } from "@/lib/read-json";
import { toUserMessage } from "@/lib/user-facing-error";
import { z } from "zod";

export const dynamic = "force-dynamic";
// 12 ideias (tema + explicação) numa só chamada; as legendas saem em lotes à parte
// (POST /api/ai/calendar/captions e o after() do commit)
export const maxDuration = 120;

const FALLBACK = "Não foi possível gerar o cronograma agora. Tente de novo em instantes.";

const schema = z.object({
  clientId: uuidString,
  // mês de referência no formato YYYY-MM
  month: z.string().regex(/^\d{4}-\d{2}$/),
  // horário padrão de publicação (HH:MM, fuso São Paulo)
  time: z.string().regex(/^\d{2}:\d{2}$/).default("18:00"),
  count: z.number().int().min(1).max(31).default(12),
  targets: z.array(z.enum(["instagram", "facebook", "linkedin"])).optional(),
});

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Mon/Wed/Fri datas do mês (3 por semana), em instantes UTC a partir do fuso -03:00.
 * Mês em andamento: só datas a partir de amanhã (nunca gera post para dia que já passou).
 */
function pickDates(year: number, month: number, count: number, time: string): Date[] {
  const targetWeekdays = [1, 3, 5]; // seg, qua, sex
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  // dia de hoje no fuso SP; se o mês pedido é o corrente, começa em hoje+1
  const spNow = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // "YYYY-MM-DD"
  const [curY, curM, curD] = spNow.split("-").map(Number);
  const firstDay = year === curY && month === curM ? curD + 1 : 1;

  const days: number[] = [];
  for (let d = firstDay; d <= lastDay; d++) {
    const wd = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    if (targetWeekdays.includes(wd)) days.push(d);
  }
  return days
    .slice(0, count)
    .map((d) => new Date(`${year}-${pad(month)}-${pad(d)}T${time}:00-03:00`));
}

type Idea = {
  theme: string;
  format?: string;
  explanation?: string;
};

/** Teto do corpo (cliente, mês, horário, quantidade, redes). */
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(req: NextRequest) {
  const { user, denied } = await requireAuthUser();
  if (denied) return denied;

  // geração de calendário é cara: 10 por 5 min por IP
  const limited = enforceRateLimit(`ai-calendar:${clientIp(req)}`, 10, 5 * 60_000);
  if (limited) return limited;

  const read = await readJsonLimited(req, MAX_BODY_BYTES);
  if (!read.ok) return read.response;
  const parsed = schema.safeParse(read.value);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { clientId, month, time, count } = parsed.data;
  const [year, mon] = month.split("-").map(Number);

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      name: true,
      toneOfVoice: true,
      socialAccounts: { where: { status: "active" }, select: { platform: true } },
    },
  });
  if (!client) return Response.json({ error: "Cliente não encontrado" }, { status: 404 });

  const activePlatforms = Array.from(new Set(client.socialAccounts.map((a) => a.platform)));
  const targets =
    parsed.data.targets && parsed.data.targets.length
      ? parsed.data.targets
      : activePlatforms.length
        ? activePlatforms
        : ["instagram", "facebook"];

  const dates = pickDates(year, mon, count, time);
  if (dates.length === 0) {
    return Response.json(
      { error: "Este mês não tem mais datas futuras disponíveis. Gere o calendário do próximo mês." },
      { status: 400 }
    );
  }
  const n = Math.min(count, dates.length);

  const monthName = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(Date.UTC(year, mon - 1, 15)));

  // FASE CRONOGRAMA: o cliente aprova só TÍTULO + breve explicação do tema (link mensal).
  // Esta chamada não gera legenda: legendas/slides saem em segundo plano durante a revisão
  // (lib/calendar-captions) e o cliente só as vê no link semanal.
  const system =
    "Você é um estrategista de conteúdo de social media de uma agência brasileira. " +
    "Cria cronogramas editoriais mensais variados e coerentes com o tom de voz do cliente. " +
    "Responda SOMENTE com JSON válido, sem texto fora do JSON.";

  const prompt = [
    `Cliente: ${client.name}.`,
    client.toneOfVoice ? `Tom de voz: ${client.toneOfVoice}.` : "Tom de voz: não informado, use um tom profissional e próximo.",
    `Mês de referência: ${monthName}.`,
    `Gere EXATAMENTE ${n} ideias de post para o mês, variando os tipos de conteúdo `,
    "(educativo, bastidores, prova social/depoimento, promocional, engajamento/pergunta, dica rápida, institucional). ",
    "Evite repetir temas. Para cada post forneça: ",
    "theme (título curto e forte, pronto para ser o título da postagem), ",
    "format (um de: 'feed', 'carrossel', 'reels' — todo post ganha um story de apoio automaticamente, não gere posts só de story) ",
    "e explanation (1-2 frases, em pt-BR, explicando para o CLIENTE o que essa postagem vai abordar e por quê — sem jargão, sem legenda pronta). ",
    `Responda em JSON no formato: {"posts":[{"theme":"...","format":"...","explanation":"..."}]} com ${n} itens.`,
  ].join("");

  // teto de gerações por IA da usuária e do sistema (CF-12)
  const quota = enforceAiQuota(user.id, 1, "calendario");
  if (quota) return quota;

  const textModel = await getTextModel("calendar");
  const { model } = textModel;
  let ideas: Idea[];
  try {
    const raw = await generateAiText(textModel, {
      label: "calendario",
      system,
      prompt,
      temperature: 0.95,
      json: true,
      // 2 tentativas × 55s + 1.5s de pausa cabem no maxDuration de 120s
      maxOutputTokens: 32768,
      timeoutMs: 55_000,
    });
    const data = parseModelJson<{ posts?: Idea[] } | Idea[]>(raw);
    ideas = Array.isArray(data) ? data : (data.posts as Idea[]);
    if (!Array.isArray(ideas)) throw new Error("Gemini não retornou a lista de posts (formato inesperado)");
  } catch (e) {
    console.error("[ai/calendar]", e);
    return Response.json({ error: toUserMessage(e, FALLBACK) }, { status: 502 });
  }

  const items = ideas.slice(0, n);
  if (items.length === 0) {
    return Response.json({ error: "A IA não retornou ideias." }, { status: 502 });
  }

  // Preview: NÃO salva nada. Devolve os rascunhos gerados para o usuário
  // revisar/ajustar e só então aprovar (POST /api/ai/calendar/commit).
  const previewPosts = items.map((idea, i) => ({
    theme: (idea.theme ?? `Post ${i + 1}`).slice(0, 200),
    format: idea.format ?? "feed",
    explanation:
      typeof idea.explanation === "string" ? idea.explanation.trim().slice(0, 600) : "",
    captions: {} as Record<string, string>,
    scheduledAt: dates[i].toISOString(),
    targets,
    mediaUrl: "",
  }));

  return Response.json(
    {
      month,
      clientName: client.name,
      targets,
      activePlatforms,
      model,
      posts: previewPosts,
    },
    { status: 200 }
  );
}
