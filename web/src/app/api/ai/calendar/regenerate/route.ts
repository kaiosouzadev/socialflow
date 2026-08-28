import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";
import { generateText, parseModelJson, CALENDAR_MODEL } from "@/lib/gemini";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  clientId: uuidString,
  targets: z.array(z.enum(["instagram", "facebook", "linkedin"])).min(1),
  // temas já presentes no calendário, para a IA não repetir
  avoid: z.array(z.string()).optional(),
});

type Idea = {
  theme?: string;
  format?: string;
  captions?: { shared?: string; linkedin?: string };
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

  const { clientId, targets, avoid = [] } = parsed.data;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { name: true, toneOfVoice: true },
  });
  if (!client) return Response.json({ error: "Cliente não encontrado" }, { status: 404 });

  const system =
    "Você é um estrategista de conteúdo de social media de uma agência brasileira. " +
    "Cria ideias de post coerentes com o tom de voz do cliente. " +
    "Facebook e Instagram usam SEMPRE a mesma legenda (uma só). " +
    "Responda SOMENTE com JSON válido, sem texto fora do JSON.";

  const hasLinkedin = targets.includes("linkedin");
  const captionKeys = hasLinkedin
    ? '"shared":"<legenda FB+IG>","linkedin":"<legenda LinkedIn>"'
    : '"shared":"<legenda FB+IG>"';
  const avoidLine = avoid.length
    ? `NÃO repita nem se aproxime destes temas já usados: ${avoid.slice(0, 30).join("; ")}.`
    : "";

  const prompt = [
    `Cliente: ${client.name}.`,
    client.toneOfVoice
      ? `Tom de voz: ${client.toneOfVoice}.`
      : "Tom de voz: não informado, use um tom profissional e próximo.",
    `Plataformas: ${targets.join(", ")}.`,
    "Gere EXATAMENTE 1 nova ideia de post, com um ângulo diferente e criativo. ",
    avoidLine,
    "Forneça: theme (título curto do tema), ",
    "format (um de: 'feed', 'carrossel', 'reels', 'story') ",
    "e captions: 'shared' é UMA legenda única pronta usada igual no Facebook e no Instagram ",
    "(envolvente, call-to-action, 3-6 hashtags, emojis moderados)",
    hasLinkedin ? "; 'linkedin' é a versão profissional para o LinkedIn" : "",
    ". Tudo em pt-BR, no tom do cliente. ",
    `Responda em JSON no formato: {"theme":"...","format":"...","captions":{${captionKeys}}}.`,
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
    if (!idea || typeof idea !== "object") throw new Error("formato inesperado");
  } catch (e) {
    console.error("[ai/calendar/regenerate]", e);
    const msg = e instanceof Error ? e.message : "Erro ao gerar a ideia";
    return Response.json({ error: `IA: ${msg}` }, { status: 502 });
  }

  // FB+IG com a mesma legenda; LinkedIn a própria (fallback shared)
  const captions: Record<string, string> = {};
  const shared = typeof idea.captions?.shared === "string" ? idea.captions.shared.trim() : "";
  const li = typeof idea.captions?.linkedin === "string" ? idea.captions.linkedin.trim() : "";
  if (shared) {
    if (targets.includes("instagram")) captions.instagram = shared;
    if (targets.includes("facebook")) captions.facebook = shared;
  }
  if (targets.includes("linkedin") && (li || shared)) captions.linkedin = li || shared;

  return Response.json(
    {
      theme: (idea.theme ?? "Novo post").slice(0, 200),
      format: idea.format ?? "feed",
      captions,
    },
    { status: 200 }
  );
}
