const BASE = "https://generativelanguage.googleapis.com/v1beta";

export const CAPTION_MODEL = process.env.GEMINI_CAPTION_MODEL || "gemini-2.5-flash";
export const CALENDAR_MODEL = process.env.GEMINI_CALENDAR_MODEL || "gemini-3.5-flash";
// gemini-3-pro-image (Nano Banana Pro): tipografia/texto muito mais confiável
// que os modelos flash-image — essencial para artes com título/contato legíveis.
export const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image";

export const GEMINI_BASE = BASE;

type GenerateOptions = {
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
  /** ask the model to return strict JSON */
  json?: boolean;
  /** evita resposta truncada no meio do JSON (calendários longos) */
  maxOutputTokens?: number;
  /** timeout POR TENTATIVA em ms (padrão 25s; são até 2 tentativas) */
  timeoutMs?: number;
};

/**
 * Extrai JSON de uma resposta de modelo: aceita JSON puro ou cercado por
 * ```json ... ``` / texto solto antes/depois. Lança se nada parseável.
 */
export function parseModelJson<T = unknown>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // remove cercas de código e tenta o primeiro bloco { ... } ou [ ... ]
    const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      return JSON.parse(unfenced) as T;
    } catch {
      const start = unfenced.search(/[[{]/);
      if (start >= 0) {
        const open = unfenced[start];
        const close = open === "{" ? "}" : "]";
        const end = unfenced.lastIndexOf(close);
        if (end > start) return JSON.parse(unfenced.slice(start, end + 1)) as T;
      }
      throw new Error("resposta da IA não é JSON válido");
    }
  }
}

/**
 * fetch com timeout + retry em erro transitório (429/5xx/rede).
 * ATENÇÃO ao orçamento: o pior caso é `attempts × timeoutMs + 1.5s` — quem
 * chama precisa garantir que isso cabe no maxDuration da rota (ou passar
 * attempts=1 para desligar o retry).
 */
export async function geminiFetch(
  url: string,
  init: RequestInit,
  timeoutMs = 25_000,
  attempts = 2
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if ((res.status === 429 || res.status >= 500) && attempt < attempts - 1) {
        lastErr = new Error(`Gemini ${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      // AbortError ou falha de rede: tenta mais uma vez (se ainda houver tentativa)
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Falha de conexão com a IA");
}

/**
 * Minimal Gemini text-generation call against the Generative Language API.
 * The API key stays server-side (never sent to the browser).
 */
export async function generateText({
  model,
  prompt,
  system,
  temperature = 0.8,
  json = false,
  maxOutputTokens,
  timeoutMs,
}: GenerateOptions): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY não configurada");

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: {
      temperature,
      ...(json ? { responseMimeType: "application/json" } : {}),
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
    },
  };

  // chave no header, nunca em query string (evita vazar em logs de URL)
  const res = await geminiFetch(
    `${BASE}/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    },
    timeoutMs
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  const text: string =
    data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ??
    "";

  if (!text.trim()) {
    const reason = data?.candidates?.[0]?.finishReason ?? "sem conteúdo";
    throw new Error(`Gemini não retornou texto (${reason})`);
  }

  return text.trim();
}
