import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";
import { geminiFetch, parseModelJson, GEMINI_BASE, CAPTION_MODEL } from "@/lib/gemini";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Assistente interno (equipe da agência): chat com contexto do post/cronograma.
 * Responde sugestões e, quando fizer sentido, devolve uma legenda pronta
 * (caption) e/ou um prompt de arte (artPrompt) que a UI oferece em botões
 * "Usar esta legenda" / "Copiar prompt de arte".
 */

const schema = z.object({
  clientId: uuidString,
  // limites espelham o que o editor de post permite (theme 200, slide 2000);
  // caption folgado — legenda longa não pode derrubar o assistente com 400
  post: z
    .object({
      theme: z.string().max(400).optional(),
      format: z.string().max(30).optional(),
      targets: z.array(z.string().max(20)).max(5).optional(),
      caption: z.string().max(8000).optional(),
      scheduledAt: z.string().max(40).optional(),
      slides: z.array(z.string().max(2000)).max(20).optional(),
    })
    .optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      })
    )
    .min(1)
    .max(20),
});

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const limited = enforceRateLimit(`ai-assistant:${clientIp(req)}`, 30, 60_000);
  if (limited) return limited;

  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: "GEMINI_API_KEY não configurada" }, { status: 500 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { clientId, post, messages } = parsed.data;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { name: true, toneOfVoice: true, briefing: true },
  });
  if (!client) return Response.json({ error: "Cliente não encontrado" }, { status: 404 });

  const briefing =
    client.briefing && typeof client.briefing === "object"
      ? JSON.stringify(client.briefing).slice(0, 2000)
      : "";

  const system = [
    "Você é o SocialFlow AI Assistant: estrategista e redator de social media de uma agência brasileira.",
    "Ajuda a equipe interna a melhorar posts e cronogramas. Sempre em português do Brasil.",
    `Cliente: ${client.name}.`,
    client.toneOfVoice ? `Tom de voz do cliente: ${client.toneOfVoice}.` : "",
    briefing ? `Briefing do cliente (JSON): ${briefing}` : "",
    post
      ? [
          "Post em edição:",
          post.theme ? `- Título: ${post.theme}` : "",
          post.format ? `- Formato: ${post.format}` : "",
          post.targets?.length ? `- Redes: ${post.targets.join(", ")}` : "",
          post.scheduledAt ? `- Agendado para: ${post.scheduledAt}` : "",
          post.caption ? `- Legenda atual: ${post.caption}` : "- Ainda sem legenda.",
          post.slides?.length
            ? `- Slides planejados:\n${post.slides.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    "REGRAS DE RESPOSTA — responda SOMENTE com JSON válido neste formato:",
    '{"reply":"<sua resposta curta e útil>","title":"<novo título, só quando propôs mudar o título>","caption":"<legenda pronta, só quando propôs uma nova legenda>","artPrompt":"<descrição de arte para gerador de imagem, só quando propôs uma arte>"}',
    "- reply: sempre presente; direto, sem enrolação; pode usar listas curtas.",
    "- title: inclua apenas quando o pedido envolve mudar/criar o TÍTULO da postagem — curto, forte, pronto para usar.",
    "- caption: inclua apenas quando o pedido envolve reescrever/criar legenda. Legenda ÚNICA para Facebook+Instagram, pronta para publicar, com hashtags quando fizer sentido.",
    "- artPrompt: inclua apenas quando sugerir uma arte/imagem; escreva em inglês, descritivo, para um gerador de imagem.",
    "- Não invente dados do cliente (telefones, preços, promoções).",
  ]
    .filter(Boolean)
    .join("\n");

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  try {
    const res = await geminiFetch(
      `${GEMINI_BASE}/models/${CAPTION_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: system }] },
          generationConfig: {
            temperature: 0.9,
            responseMimeType: "application/json",
            maxOutputTokens: 8192,
          },
        }),
      },
      25_000
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${detail.slice(0, 200)}`);
    }
    const data = await res.json();
    const text: string =
      data?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? "")
        .join("") ?? "";
    if (!text.trim()) throw new Error("resposta vazia");

    const out = parseModelJson<{ reply?: string; title?: string; caption?: string; artPrompt?: string }>(text);
    const reply = typeof out.reply === "string" && out.reply.trim() ? out.reply.trim() : text.trim();
    return Response.json({
      reply,
      title: typeof out.title === "string" && out.title.trim() ? out.title.trim().slice(0, 200) : undefined,
      caption: typeof out.caption === "string" && out.caption.trim() ? out.caption.trim() : undefined,
      artPrompt:
        typeof out.artPrompt === "string" && out.artPrompt.trim() ? out.artPrompt.trim() : undefined,
    });
  } catch (e) {
    console.error("[ai/assistant]", e);
    const msg = e instanceof Error ? e.message : "Erro no assistente";
    return Response.json({ error: `IA: ${msg}` }, { status: 502 });
  }
}
