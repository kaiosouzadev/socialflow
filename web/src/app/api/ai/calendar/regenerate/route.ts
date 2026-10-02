import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";
import { generateText, parseModelJson, CALENDAR_MODEL } from "@/lib/gemini";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { toUserMessage } from "@/lib/user-facing-error";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FALLBACK = "Não foi possível gerar uma nova ideia agora. Tente de novo em instantes.";

const schema = z.object({
  clientId: uuidString,
  targets: z.array(z.enum(["instagram", "facebook", "linkedin"])).min(1),
  // temas já presentes no calendário, para a IA não repetir
  avoid: z.array(z.string()).optional(),
});

type Idea = {
  theme?: string;
  format?: string;
  explanation?: string;
};

/** Gera UMA nova ideia de post para substituir um item do calendário em revisão. */
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const limited = enforceRateLimit(`ai-regen:${clientIp(req)}`, 30, 5 * 60_000);
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { clientId, avoid = [] } = parsed.data;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { name: true, toneOfVoice: true },
  });
  if (!client) return Response.json({ error: "Cliente não encontrado" }, { status: 404 });

  const system =
    "Você é um estrategista de conteúdo de social media de uma agência brasileira. " +
    "Cria ideias de post coerentes com o tom de voz do cliente. " +
    "Responda SOMENTE com JSON válido, sem texto fora do JSON.";

  const avoidLine = avoid.length
    ? `NÃO repita nem se aproxime destes temas já usados: ${avoid.slice(0, 30).join("; ")}.`
    : "";

  const prompt = [
    `Cliente: ${client.name}.`,
    client.toneOfVoice
      ? `Tom de voz: ${client.toneOfVoice}.`
      : "Tom de voz: não informado, use um tom profissional e próximo.",
    `Plataformas: ${parsed.data.targets.join(", ")}.`,
    "Gere EXATAMENTE 1 nova ideia de post, com um ângulo diferente e criativo. ",
    avoidLine,
    "Forneça: theme (título curto e forte, pronto para ser o título da postagem), ",
    "format (um de: 'feed', 'carrossel', 'reels') ",
    "e explanation (1-2 frases explicando ao CLIENTE o que a postagem vai abordar e por quê). ",
    "Tudo em pt-BR, no tom do cliente. ",
    'Responda em JSON no formato: {"theme":"...","format":"...","explanation":"..."}.',
  ].join("");

  let idea: Idea;
  try {
    const raw = await generateText({
      model: CALENDAR_MODEL,
      system,
      prompt,
      temperature: 0.95,
      json: true,
      maxOutputTokens: 8192,
    });
    const data = parseModelJson<Record<string, unknown>>(raw);
    // aceita tanto {theme,...} quanto {posts:[{...}]}
    const cand = Array.isArray(data) ? data[0] : (data.posts as Idea[] | undefined)?.[0] ?? data;
    idea = cand as Idea;
    if (!idea || typeof idea !== "object") throw new Error("Gemini não retornou a ideia (formato inesperado)");
  } catch (e) {
    console.error("[ai/calendar/regenerate]", e);
    return Response.json({ error: toUserMessage(e, FALLBACK) }, { status: 502 });
  }

  return Response.json(
    {
      theme: (idea.theme ?? "Novo post").slice(0, 200),
      format: idea.format ?? "feed",
      explanation:
        typeof idea.explanation === "string" ? idea.explanation.trim().slice(0, 600) : "",
      captions: {},
    },
    { status: 200 }
  );
}
