/**
 * Parte PURA da escolha do modelo de IA de texto (sem banco): serve ao servidor
 * (lib/ai-models.ts, rotas /api/settings/ai-model) e à tela "Modelos de IA".
 */

export type AiProvider = "google" | "openai";
export type TextModelKind = "caption" | "calendar";

/** Nome do provedor na tela. */
export const PROVIDER_LABELS: Readonly<Record<AiProvider, string>> = {
  google: "Google (Gemini)",
  openai: "OpenAI (ChatGPT)",
};

/** ChatGPT escolhido (ou testado) sem chave da OpenAI salva nem no ambiente. */
export const OPENAI_KEY_MISSING = "Configure a chave da OpenAI antes de usar o ChatGPT.";

/** Padrão de código por função (o mesmo de antes da tela "Modelos de IA"). */
export const TEXT_MODEL_DEFAULTS: Readonly<Record<TextModelKind, string>> = {
  caption: "gemini-2.5-flash",
  calendar: "gemini-3.5-flash",
};

export type TextModelOption = { provider: AiProvider; model: string; label: string };

/**
 * Opções prontas da tela, por provedor (o "Padrão do sistema" e o "Outro" ficam na própria tela).
 * Os IDs da OpenAI são sugestões (não confirmados): o botão "Testar modelo" confirma antes de salvar.
 */
export const TEXT_MODEL_OPTIONS: readonly TextModelOption[] = [
  { provider: "google", model: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { provider: "google", model: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
  { provider: "google", model: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { provider: "google", model: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { provider: "openai", model: "gpt-5-mini", label: "GPT-5 mini" },
  { provider: "openai", model: "gpt-5", label: "GPT-5" },
  { provider: "openai", model: "gpt-4.1-mini", label: "GPT-4.1 mini" },
];

/**
 * ID de modelo (Gemini ou OpenAI): letras minúsculas, números, ponto, hífen e sublinhado; começa e
 * termina com letra/número; sem ".." ; até 80 caracteres. Sem espaço, barra, dois-pontos, "?" ou "#"
 * (no Gemini o ID vai no caminho da URL).
 */
export const MODEL_ID_PATTERN = /^(?!.*\.\.)[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/;

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

/**
 * Chave da API da OpenAI (formato, não validade): começa com "sk-", sem espaços, só letras,
 * números, "-" e "_". A validade só a OpenAI confirma (botão "Testar modelo").
 */
export const OPENAI_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{16,300}$/;

export function isValidOpenAiKey(key: string): boolean {
  return OPENAI_KEY_PATTERN.test(key);
}

/** Final da chave para a tela ("••••WXYZ"): nunca a chave inteira. */
export function maskedKey(last4: string): string {
  return `••••${last4}`;
}
