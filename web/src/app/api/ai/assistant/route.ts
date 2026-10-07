import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";
import { geminiFetch, logTextGeneration, parseModelJson, GEMINI_BASE } from "@/lib/gemini";
import { getTextModel } from "@/lib/ai-models";
import { generateOpenAiText } from "@/lib/ai-text";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { toUserMessage } from "@/lib/user-facing-error";
import { briefingForPrompt } from "@/lib/client-briefing-prompt";
import { clientHashtagBlock, withClientHashtags } from "@/lib/client-hashtags";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FALLBACK = "O assistente não conseguiu responder agora. Tente de novo em instantes.";

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

  // provedor/modelo de Administração → "Modelos de IA": o Gemini precisa da GEMINI_API_KEY;
  // o ChatGPT usa a chave da OpenAI (lib/ai-text)
  const textModel = await getTextModel("caption");
  const key = process.env.GEMINI_API_KEY;
  if (textModel.provider === "google" && !key) {
    const cause = "GEMINI_API_KEY não configurada";
    console.error("[ai/assistant]", cause);
    return Response.json({ error: toUserMessage(cause, FALLBACK) }, { status: 500 });
  }

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

  // briefing inteiro (texto); as hashtags fixas do cliente vão no fim de toda legenda pelo código
  const briefing = briefingForPrompt(client.briefing);
  const hashtagBlock = clientHashtagBlock(client.briefing);

  const system = [
    "Você é o assistente de IA da agência Grupo Coletivo, agência brasileira de social media: estrategista e redator.",
    "Ajuda a equipe interna a melhorar posts e cronogramas. Sempre em português do Brasil.",
    `Cliente: ${client.name}.`,
    client.toneOfVoice ? `Tom de voz do cliente: ${client.toneOfVoice}.` : "",
    briefing ?? "",
    hashtagBlock
      ? `Hashtags fixas do cliente (o sistema as coloca automaticamente no fim de toda legenda):\n${hashtagBlock}`
      : "",
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
    hashtagBlock
      ? "- caption: inclua apenas quando o pedido envolve reescrever/criar legenda. Legenda ÚNICA para Facebook+Instagram, pronta para publicar, SEM hashtags (as hashtags fixas do cliente são adicionadas automaticamente no fim)."
      : "- caption: inclua apenas quando o pedido envolve reescrever/criar legenda. Legenda ÚNICA para Facebook+Instagram, pronta para publicar, com hashtags quando fizer sentido.",
    "- artPrompt: inclua apenas quando sugerir uma arte/imagem; escreva em inglês, descritivo, para um gerador de imagem.",
    "- Não invente dados do cliente (telefones, preços, promoções).",
  ]
    .filter(Boolean)
    .join("\n");

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const { model } = textModel;
  const startedAt = Date.now();
  let ok = false;
  try {
    const text =
      textModel.provider === "openai"
        ? // ChatGPT: a mesma conversa e as mesmas regras, pelo adaptador da OpenAI (que registra o próprio log)
          await generateOpenAiText(model, {
            label: "assistente",
            system,
            messages,
            temperature: 0.9,
            json: true,
            maxOutputTokens: 8192,
            timeoutMs: 25_000,
          })
        : await geminiAssistantText(key ?? "", model, contents, system);

    const out = parseModelJson<{ reply?: string; title?: string; caption?: string; artPrompt?: string }>(text);
    ok = true;
    const reply = typeof out.reply === "string" && out.reply.trim() ? out.reply.trim() : text.trim();
    return Response.json({
      reply,
      title: typeof out.title === "string" && out.title.trim() ? out.title.trim().slice(0, 200) : undefined,
      caption:
        typeof out.caption === "string" && out.caption.trim()
          ? withClientHashtags(out.caption.trim(), hashtagBlock)
          : undefined,
      artPrompt:
        typeof out.artPrompt === "string" && out.artPrompt.trim() ? out.artPrompt.trim() : undefined,
    });
  } catch (e) {
    console.error("[ai/assistant]", e);
    return Response.json({ error: toUserMessage(e, FALLBACK) }, { status: 502 });
  } finally {
    // a OpenAI já registrou a chamada; o Gemini registra aqui (como antes)
    if (textModel.provider === "google") logTextGeneration("assistente", model, startedAt, ok);
  }
}

/** Assistente no Gemini: conversa com systemInstruction (o mesmo pedido de antes do ChatGPT). */
async function geminiAssistantText(
  key: string,
  model: string,
  contents: { role: string; parts: { text: string }[] }[],
  system: string
): Promise<string> {
  const res = await geminiFetch(
    `${GEMINI_BASE}/models/${model}:generateContent`,
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
  if (!text.trim()) throw new Error("Gemini não retornou texto (resposta vazia)");
  return text;
}
