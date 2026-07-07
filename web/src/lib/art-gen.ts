import { GEMINI_BASE, IMAGE_MODEL } from "@/lib/gemini";

/**
 * Geração de arte para clientes de gestão básica: a IA (Gemini image) recebe a
 * arte-base + a logo do cliente e produz uma nova arte recolorida com a marca,
 * a logo inserida e o tema em destaque. Retorna os bytes da imagem gerada.
 *
 * Aviso: modelo de imagem aproxima cor e pode imperfeiçoar texto/logo — revisar
 * antes de publicar.
 */

type InlineImage = { mimeType: string; data: string };

/** Anti-SSRF: só https e nunca hosts privados/loopback/metadata. */
function assertSafeImageUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "https:") throw new Error(`URL de imagem deve ser https: ${raw}`);
  const h = u.hostname.toLowerCase();
  const privado =
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    h === "0.0.0.0" ||
    h === "[::1]" ||
    h === "::1";
  if (privado) throw new Error(`Host de imagem não permitido: ${h}`);
  return u;
}

async function fetchInlineImage(url: string): Promise<InlineImage> {
  assertSafeImageUrl(url);
  const res = await fetch(url, { cache: "no-store", redirect: "error" });
  if (!res.ok) throw new Error(`Falha ao baixar imagem (${res.status}): ${url}`);
  const type = res.headers.get("content-type") ?? "image/png";
  if (!type.startsWith("image/")) throw new Error(`Conteúdo não é imagem (${type})`);
  const mimeType = type;
  const data = Buffer.from(await res.arrayBuffer()).toString("base64");
  return { mimeType, data };
}

export type GenerateArtInput = {
  templateUrl: string;
  logoUrl?: string | null;
  brandColor?: string | null;
  theme: string;
  headline?: string;
  /** linhas de contato prontas (ex: "WhatsApp: (11) 9..."); vazio = arte sem bloco de contato */
  contacts?: string[];
};

/** Gera a arte via Gemini image. Retorna buffer + mimeType da imagem. */
export async function generateArt(
  input: GenerateArtInput
): Promise<{ buffer: Buffer; mimeType: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY não configurada");

  const parts: Array<
    { text: string } | { inlineData: InlineImage }
  > = [];

  const temContato = (input.contacts ?? []).length > 0;
  const instrucoes = [
    "Você é designer de social media. Recebe uma ARTE-BASE e (opcionalmente) uma LOGO.",
    "Gere UMA nova arte mantendo o layout e a composição da arte-base, com estas mudanças:",
    input.brandColor ? `- Recolora os elementos gráficos para a cor de marca ${input.brandColor}.` : "",
    input.logoUrl ? "- Insira a LOGO fornecida de forma harmônica, sem distorcê-la." : "",
    `- Destaque o tema da postagem com texto legível e curto: "${input.headline || input.theme}".`,
    `- Adapte a imagem/ilustração de fundo para combinar com o tema "${input.theme}", mantendo o estilo visual da arte-base.`,
    temContato
      ? `- Inclua um bloco discreto de contato no rodapé, legível, com exatamente estas linhas:\n${(input.contacts ?? []).map((c) => `  • ${c}`).join("\n")}`
      : "- NÃO inclua dados de contato nem espaço reservado para eles; mantenha o layout equilibrado sem esse bloco.",
    "Não invente outra marca, telefone ou site. Mantenha aparência profissional e limpa. Saída: apenas a imagem final.",
  ]
    .filter(Boolean)
    .join("\n");

  parts.push({ text: instrucoes });
  parts.push({ inlineData: await fetchInlineImage(input.templateUrl) });
  if (input.logoUrl) parts.push({ inlineData: await fetchInlineImage(input.logoUrl) });

  // chave no header, nunca em query string (evita vazar em logs de URL)
  const res = await fetch(`${GEMINI_BASE}/models/${IMAGE_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini image ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const outParts: Array<{ inlineData?: InlineImage }> = data?.candidates?.[0]?.content?.parts ?? [];
  const img = outParts.find((p) => p.inlineData)?.inlineData;
  if (!img?.data) {
    const reason = data?.candidates?.[0]?.finishReason ?? "sem imagem";
    throw new Error(`Gemini não retornou imagem (${reason})`);
  }

  return { buffer: Buffer.from(img.data, "base64"), mimeType: img.mimeType || "image/png" };
}
