/**
 * Parte PURA da escolha do modelo de IA de texto (sem banco): serve ao servidor
 * (lib/ai-models.ts, rotas /api/settings/ai-model) e à tela "Modelos de IA".
 */

export type AiProvider = "google" | "openai";
export type TextModelKind = "caption" | "calendar";

export const OPENAI_UNAVAILABLE = "ChatGPT ainda não está disponível";

/** Padrão de código por função (o mesmo de antes da tela "Modelos de IA"). */
export const TEXT_MODEL_DEFAULTS: Readonly<Record<TextModelKind, string>> = {
  caption: "gemini-2.5-flash",
  calendar: "gemini-3.5-flash",
};

/** Opções prontas da tela (o "Padrão do sistema" e o "Outro" ficam na própria tela). */
export const TEXT_MODEL_OPTIONS: readonly { model: string; label: string }[] = [
  { model: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { model: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
  { model: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { model: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];

/**
 * ID de modelo: letras minúsculas, números, ponto, hífen e sublinhado; começa e termina com
 * letra/número; até 80 caracteres. Sem espaço, barra, dois-pontos ou "?" (o ID vai no caminho da URL).
 */
export const MODEL_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/;

/** Texto digitado → ID: tira espaços das pontas, o prefixo "models/" e põe em minúsculas. */
export function normalizeModelId(raw: string): string {
  return raw.trim().replace(/^models\//i, "").toLowerCase();
}

export function isValidModelId(id: string): boolean {
  return MODEL_ID_PATTERN.test(id);
}

/** Nome amigável: "Gemini 3.8 Flash (gemini-3.8-flash)" ou só o ID quando não é uma opção pronta. */
export function modelLabel(model: string): string {
  const known = TEXT_MODEL_OPTIONS.find((o) => o.model === model);
  return known ? `${known.label} (${model})` : model;
}
