const BASE = "https://generativelanguage.googleapis.com/v1beta";

export const CAPTION_MODEL = process.env.GEMINI_CAPTION_MODEL || "gemini-2.5-flash";
export const CALENDAR_MODEL = process.env.GEMINI_CALENDAR_MODEL || "gemini-3.5-flash";

type GenerateOptions = {
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
  /** ask the model to return strict JSON */
  json?: boolean;
};

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
}: GenerateOptions): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY não configurada");

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: {
      temperature,
      ...(json ? { responseMimeType: "application/json" } : {}),
    },
  };

  const res = await fetch(`${BASE}/models/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

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
