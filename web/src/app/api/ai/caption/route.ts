import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";
import { generateText, parseModelJson, CAPTION_MODEL } from "@/lib/gemini";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  clientId: uuidString,
  theme: z.string().optional(),
  notes: z.string().optional(),
  targets: z.array(z.enum(["instagram", "facebook", "linkedin"])).min(1),
});

// padrão do sistema: FB+IG compartilham a MESMA legenda; LinkedIn tem a própria
const SHARED_GUIDE =
  '"shared": legenda ÚNICA usada em Facebook e Instagram (envolvente, call-to-action claro, 3-6 hashtags relevantes no final, emojis com moderação)';
const LINKEDIN_GUIDE =
  '"linkedin": legenda para LinkedIn (tom profissional, foco em valor/insight, sem excesso de emojis, hashtags discretas)';

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  // limita custo/abuso de IA: 20 gerações/min por IP
  const limited = enforceRateLimit(`ai-caption:${clientIp(req)}`, 20, 60_000);
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { clientId, theme, notes, targets } = parsed.data;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { name: true, toneOfVoice: true },
  });
  if (!client) return Response.json({ error: "Cliente não encontrado" }, { status: 404 });

  const hasMeta = targets.includes("instagram") || targets.includes("facebook");
  const hasLinkedin = targets.includes("linkedin");
  const guide = [hasMeta ? `- ${SHARED_GUIDE}` : "", hasLinkedin ? `- ${LINKEDIN_GUIDE}` : ""]
    .filter(Boolean)
    .join("\n");
  const jsonKeys = [hasMeta ? '"shared":"<legenda>"' : "", hasLinkedin ? '"linkedin":"<legenda>"' : ""]
    .filter(Boolean)
    .join(",");

  const system =
    "Você é um redator de social media de uma agência brasileira. Escreve legendas " +
    "prontas para publicação, em português do Brasil, naturais e persuasivas. " +
    "Facebook e Instagram usam SEMPRE a mesma legenda. Responda SOMENTE com JSON válido, sem texto fora do JSON.";

  const prompt = [
    `Cliente: ${client.name}.`,
    client.toneOfVoice
      ? `Tom de voz do cliente: ${client.toneOfVoice}.`
      : "Tom de voz: não informado, use um tom profissional e próximo.",
    theme ? `Tema do post: ${theme}.` : "",
    notes ? `Observações: ${notes}.` : "",
    "Escreva as legendas pedidas:",
    guide,
    `Responda em JSON com exatamente estas chaves: {${jsonKeys}}.`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const raw = await generateText({
      model: CAPTION_MODEL,
      system,
      prompt,
      temperature: 0.9,
      json: true,
      maxOutputTokens: 8192,
    });
    const data = parseModelJson<Record<string, unknown>>(raw);
    const shared = typeof data.shared === "string" && data.shared.trim() ? data.shared.trim() : "";
    const li = typeof data.linkedin === "string" && data.linkedin.trim() ? data.linkedin.trim() : "";

    // armazenamento continua por rede — FB+IG recebem a mesma legenda
    const captions: Record<string, string> = {};
    if (hasMeta && shared) {
      if (targets.includes("instagram")) captions.instagram = shared;
      if (targets.includes("facebook")) captions.facebook = shared;
    }
    if (hasLinkedin && (li || shared)) captions.linkedin = li || shared;

    if (Object.keys(captions).length === 0) {
      return Response.json({ error: "A IA não retornou legendas." }, { status: 502 });
    }
    return Response.json({ captions, model: CAPTION_MODEL });
  } catch (e) {
    console.error("[ai/caption]", e);
    const msg = e instanceof Error ? e.message : "Erro ao gerar legenda";
    return Response.json({ error: msg }, { status: 502 });
  }
}
