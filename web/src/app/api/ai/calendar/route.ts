import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";
import { generateText, CALENDAR_MODEL } from "@/lib/gemini";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { z } from "zod";

export const dynamic = "force-dynamic";

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
  captions?: { instagram?: string; facebook?: string; linkedin?: string };
};

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  // geração de calendário é cara: 10 por 5 min por IP
  const limited = enforceRateLimit(`ai-calendar:${clientIp(req)}`, 10, 5 * 60_000);
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
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

  const system =
    "Você é um estrategista de conteúdo de social media de uma agência brasileira. " +
    "Cria calendários editoriais mensais variados e coerentes com o tom de voz do cliente. " +
    "Responda SOMENTE com JSON válido, sem texto fora do JSON.";

  const captionKeys = targets.map((t) => `"${t}":"<legenda ${t}>"`).join(",");
  const prompt = [
    `Cliente: ${client.name}.`,
    client.toneOfVoice ? `Tom de voz: ${client.toneOfVoice}.` : "Tom de voz: não informado, use um tom profissional e próximo.",
    `Mês de referência: ${monthName}.`,
    `Plataformas: ${targets.join(", ")}.`,
    `Gere EXATAMENTE ${n} ideias de post para o mês, variando os tipos de conteúdo `,
    "(educativo, bastidores, prova social/depoimento, promocional, engajamento/pergunta, dica rápida, institucional). ",
    "Evite repetir temas. Para cada post forneça: theme (título curto do tema), ",
    "format (um de: 'feed', 'carrossel', 'reels', 'story') ",
    "e captions: UMA legenda pronta por rede, em pt-BR, no tom do cliente, adaptada ao estilo de cada rede ",
    "(Instagram com hashtags e emojis moderados; Facebook mais explicativo; LinkedIn profissional). ",
    `Responda em JSON no formato: {"posts":[{"theme":"...","format":"...","captions":{${captionKeys}}}]} com ${n} itens.`,
  ].join("");

  let ideas: Idea[];
  try {
    const raw = await generateText({
      model: CALENDAR_MODEL,
      system,
      prompt,
      temperature: 0.95,
      json: true,
    });
    const data = JSON.parse(raw);
    ideas = Array.isArray(data) ? data : data.posts;
    if (!Array.isArray(ideas)) throw new Error("formato inesperado");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao gerar calendário";
    return Response.json({ error: `IA: ${msg}` }, { status: 502 });
  }

  const items = ideas.slice(0, n);
  if (items.length === 0) {
    return Response.json({ error: "A IA não retornou ideias." }, { status: 502 });
  }

  // Preview: NÃO salva nada. Devolve os rascunhos gerados para o usuário
  // revisar/ajustar e só então aprovar (POST /api/ai/calendar/commit).
  const previewPosts = items.map((idea, i) => {
    const captions: Record<string, string> = {};
    for (const t of targets) {
      const c = idea.captions?.[t as keyof typeof idea.captions];
      if (typeof c === "string" && c.trim()) captions[t] = c.trim();
    }
    return {
      theme: (idea.theme ?? `Post ${i + 1}`).slice(0, 200),
      format: idea.format ?? "feed",
      captions,
      scheduledAt: dates[i].toISOString(),
      targets,
      mediaUrl: "",
    };
  });

  return Response.json(
    {
      month,
      clientName: client.name,
      targets,
      activePlatforms,
      model: CALENDAR_MODEL,
      posts: previewPosts,
    },
    { status: 200 }
  );
}
