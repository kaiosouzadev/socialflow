import { GEMINI_BASE, IMAGE_MODEL, geminiFetch, logTextGeneration, parseModelJson } from "@/lib/gemini";
import { getTextModel } from "@/lib/ai-models";

/**
 * Geração de arte para clientes de gestão básica: a IA (Gemini image) recebe a
 * arte-base + a logo do cliente e produz uma nova arte recolorida com a marca,
 * a logo inserida e o tema em destaque. Retorna os bytes da imagem gerada.
 *
 * Depois de gerar, um passe de verificação (modelo de texto multimodal) lê a
 * imagem e procura texto corrompido/erros de grafia; se achar, regenera uma vez
 * com as correções apontadas no prompt.
 */

type InlineImage = { mimeType: string; data: string };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB por imagem de entrada

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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, { cache: "no-store", redirect: "error", signal: ctrl.signal });
    if (!res.ok) throw new Error(`Falha ao baixar imagem (${res.status}): ${url}`);
    const type = res.headers.get("content-type") ?? "image/png";
    if (!type.startsWith("image/")) throw new Error(`Conteúdo não é imagem (${type})`);
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`Imagem muito grande (${Math.round(bytes.byteLength / 1024 / 1024)}MB, máx 8MB)`);
    }
    return { mimeType: type, data: Buffer.from(bytes).toString("base64") };
  } finally {
    clearTimeout(timer);
  }
}

export type GenerateArtInput = {
  templateUrl: string;
  logoUrl?: string | null;
  brandColor?: string | null;
  theme: string;
  headline?: string;
  /** formato do post — define a proporção da arte (feed 1:1, story/reels 9:16) */
  format?: string;
  /** linhas de contato prontas (ex: "WhatsApp: (11) 9..."); vazio = arte sem bloco de contato */
  contacts?: string[];
};

function aspectRatioFor(format?: string): string {
  if (format === "story" || format === "reels") return "9:16";
  // padrão atual do feed IG: retrato 1080×1350 (vale para feed e carrossel)
  return "4:5";
}

function buildInstructions(input: GenerateArtInput, corrections?: string): string {
  const temContato = (input.contacts ?? []).length > 0;
  const headline = (input.headline || input.theme).trim();
  return [
    "Você é designer de social media sênior. Recebe uma ARTE-BASE e (opcionalmente) uma LOGO.",
    "Gere UMA nova arte mantendo o layout e a composição da arte-base, com estas mudanças:",
    `- SEMPRE troque a imagem/ilustração de fundo por uma nova adequada ao tema "${input.theme}" — nunca reutilize a imagem da arte-base; mantenha apenas o estilo visual e o layout.`,
    input.brandColor
      ? `- Recolora APENAS os elementos gráficos decorativos (formas, faixas, fundos sólidos) para a cor de marca ${input.brandColor}. NUNCA recolora a logo nem fotos.`
      : "",
    `- Título em destaque, copiado LETRA POR LETRA, sem alterar nada: "${headline}"`,
    "PADRÕES FIXOS DA MARCA (iguais em todas as artes deste cliente — obrigatórios):",
    input.logoUrl
      ? "- LOGO: insira exatamente na MESMA posição em que a logo aparece na arte-base, no mesmo tamanho relativo. Preserve as cores, proporções e tipografia ORIGINAIS da logo — proibido redesenhar, recolorir ou distorcer."
      : "",
    temContato
      ? `- CONTATOS: bloco na MESMA posição do bloco de contato da arte-base (padrão: rodapé), com a mesma cor e estilo do padrão da marca, legível, com exatamente estas linhas:\n${(input.contacts ?? []).map((c) => `  • ${c}`).join("\n")}`
      : "- NÃO inclua dados de contato nem espaço reservado para eles; mantenha o layout equilibrado sem esse bloco.",
    "REGRAS DE TEXTO (obrigatórias):",
    "- Todo texto visível deve estar em português do Brasil, com grafia e acentuação perfeitas.",
    "- Use SOMENTE os textos indicados acima. Não invente frases, números, preços, telefones, sites ou outra marca.",
    "- Não desenhe documentos, boletos, faturas ou telas com texto pequeno/denso: qualquer papel ou tela que aparecer deve ser abstrato/desfocado, sem texto legível.",
    "- Tipografia limpa e legível, com alto contraste entre texto e fundo.",
    corrections
      ? `CORREÇÕES (a tentativa anterior teve estes problemas — corrija todos): ${corrections}`
      : "",
    "Mantenha aparência profissional e limpa. Saída: apenas a imagem final.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function callImageModel(
  key: string,
  parts: Array<{ text: string } | { inlineData: InlineImage }>,
  aspectRatio: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  // chave no header, nunca em query string (evita vazar em logs de URL)
  // sem retry (attempts=1): o fluxo completo (imagem + verificação + possível
  // regeração) precisa caber no maxDuration de 300s da rota
  const res = await geminiFetch(
    `${GEMINI_BASE}/models/${IMAGE_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio, imageSize: "2K" },
        },
      }),
    },
    100_000,
    1
  );

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

/**
 * Passe de verificação: um modelo multimodal lê a arte gerada e aponta texto
 * corrompido/erros de grafia. Retorna null quando está tudo ok, ou a lista de
 * problemas para realimentar a regeração. Falha do verificador NÃO derruba a
 * geração (retorna null). O verificador é TEXTO: usa o modelo de texto do sistema
 * (Administração → "Modelos de IA"); a geração da imagem continua no IMAGE_MODEL.
 */
async function findTextProblems(
  key: string,
  image: { buffer: Buffer; mimeType: string },
  expectedHeadline: string,
  expectedContacts: string[]
): Promise<string | null> {
  const { model } = await getTextModel("caption");
  const startedAt = Date.now();
  let ok = false;
  try {
    const res = await geminiFetch(
      `${GEMINI_BASE}/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text:
                    "Você revisa artes de social media. Analise a imagem e responda SOMENTE JSON " +
                    '{"ok":boolean,"problemas":["..."]}. Marque ok=false apenas se houver: ' +
                    "texto ilegível/corrompido (caracteres sem sentido), erro de ortografia em pt-BR, " +
                    `ou título diferente do esperado. Título esperado: "${expectedHeadline}". ` +
                    (expectedContacts.length
                      ? `Contatos esperados: ${expectedContacts.join(" | ")}. `
                      : "Não deve haver dados de contato. ") +
                    "Ignore estilo, cores e composição.",
                },
                {
                  inlineData: {
                    mimeType: image.mimeType,
                    data: image.buffer.toString("base64"),
                  },
                },
              ],
            },
          ],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      },
      30_000,
      1
    );
    if (!res.ok) return null;
    const data = await res.json();
    const text: string =
      data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    const verdict = parseModelJson<{ ok?: boolean; problemas?: string[] }>(text);
    ok = true;
    if (verdict.ok === false && Array.isArray(verdict.problemas) && verdict.problemas.length) {
      return verdict.problemas.slice(0, 5).join("; ");
    }
    return null;
  } catch {
    return null;
  } finally {
    logTextGeneration("verificacao-arte", model, startedAt, ok);
  }
}

/** Gera a arte via Gemini image (com verificação de texto + 1 retentativa). */
export async function generateArt(
  input: GenerateArtInput
): Promise<{ buffer: Buffer; mimeType: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY não configurada");

  const aspectRatio = aspectRatioFor(input.format);
  const template = await fetchInlineImage(input.templateUrl);
  const logo = input.logoUrl ? await fetchInlineImage(input.logoUrl) : null;

  const makeParts = (corrections?: string) => {
    const parts: Array<{ text: string } | { inlineData: InlineImage }> = [
      { text: buildInstructions(input, corrections) },
      { inlineData: template },
    ];
    if (logo) parts.push({ inlineData: logo });
    return parts;
  };

  let image = await callImageModel(key, makeParts(), aspectRatio);

  const headline = (input.headline || input.theme).trim();
  const problems = await findTextProblems(key, image, headline, input.contacts ?? []);
  if (problems) {
    image = await callImageModel(key, makeParts(problems), aspectRatio);
  }

  return image;
}
