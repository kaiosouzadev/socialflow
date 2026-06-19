import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";
import { generateText, CAPTION_MODEL } from "@/lib/gemini";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  clientId: uuidString,
  theme: z.string().optional(),
  notes: z.string().optional(),
  targets: z.array(z.enum(["instagram", "facebook", "linkedin"])).min(1),
});

const PLATFORM_GUIDE: Record<string, string> = {
  instagram:
    "Instagram: tom visual e envolvente, 3-6 hashtags relevantes no final, emojis com moderação.",
  facebook:
    "Facebook: texto um pouco mais explicativo, call-to-action claro, poucos ou nenhum hashtag.",
  linkedin:
    "LinkedIn: tom profissional, foco em valor/insight, sem excesso de emojis, hashtags discretas.",
};

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

  const guide = targets.map((t) => `- ${PLATFORM_GUIDE[t]}`).join("\n");

  const system =
    "Você é um redator de social media de uma agência brasileira. Escreve legendas " +
    "prontas para publicação, em português do Brasil, naturais e persuasivas, adaptadas " +
    "às convenções de cada rede. Responda SOMENTE com JSON válido, sem texto fora do JSON.";

  const prompt = [
    `Cliente: ${client.name}.`,
    client.toneOfVoice
      ? `Tom de voz do cliente: ${client.toneOfVoice}.`
      : "Tom de voz: não informado, use um tom profissional e próximo.",
    theme ? `Tema do post: ${theme}.` : "",
    notes ? `Observações: ${notes}.` : "",
    "Escreva UMA legenda específica para cada rede a seguir, respeitando o estilo de cada uma:",
    guide,
    `Responda em JSON com exatamente estas chaves: {${targets
      .map((t) => `"${t}":"<legenda>"`)
      .join(",")}}. Cada valor é o texto pronto da legenda daquela rede.`,
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
    });
    const data = JSON.parse(raw);
    const captions: Record<string, string> = {};
    for (const t of targets) {
      if (typeof data?.[t] === "string" && data[t].trim()) captions[t] = data[t].trim();
    }
    if (Object.keys(captions).length === 0) {
      return Response.json({ error: "A IA não retornou legendas." }, { status: 502 });
    }
    return Response.json({ captions, model: CAPTION_MODEL });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao gerar legenda";
    return Response.json({ error: msg }, { status: 502 });
  }
}
