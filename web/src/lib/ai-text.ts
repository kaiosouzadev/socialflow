import { generateText } from "@/lib/gemini";
import { logTextGeneration } from "@/lib/ai-log";
import { openaiGenerateText, type OpenAiTurn } from "@/lib/openai";
import { getTextModel, type TextModel, type TextModelKind } from "@/lib/ai-models";
import { getOpenAiKey } from "@/lib/openai-key";
import { OPENAI_KEY_MISSING } from "@/lib/ai-model-options";

/**
 * PONTO ÚNICO da geração de texto por IA: resolve o provedor/modelo de Administração →
 * "Modelos de IA" (getTextModel) e chama o Gemini (lib/gemini.generateText) ou a OpenAI
 * (lib/openai.openaiGenerateText, com a chave salva/ambiente). Sem configuração salva o
 * resultado é idêntico ao de antes (Gemini padrão por função).
 *
 * Fora daqui só ficam: a verificação de texto das artes (lib/art-gen, recebe imagem — sempre
 * Gemini), o assistente com Gemini (formato de conversa próprio) e o "Testar modelo" (que passa
 * o modelo pedido em vez da configuração, mas também usa generateAiText).
 */

export type AiTextOptions = {
  prompt: string;
  system?: string;
  temperature?: number;
  json?: boolean;
  maxOutputTokens?: number;
  /** timeout POR TENTATIVA em ms (padrão 25s; são até 2 tentativas) */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** nome da geração no log `[ia-texto]` (ex.: "legenda"); nunca dado de cliente */
  label?: string;
};

/**
 * Gera texto com o modelo da função `target` ("caption" | "calendar") ou com um modelo já
 * resolvido (`{ provider, model }`, quando a rota também devolve o modelo usado).
 */
export async function generateAiText(target: TextModelKind | TextModel, opts: AiTextOptions): Promise<string> {
  const tm = typeof target === "string" ? await getTextModel(target) : target;
  if (tm.provider === "openai") return generateOpenAiText(tm.model, opts);
  return generateText({ ...opts, model: tm.model });
}

/** OpenAI com a chave salva (ou do ambiente). `messages` = conversa (assistente), no lugar de `prompt`. */
export async function generateOpenAiText(
  model: string,
  opts: Omit<AiTextOptions, "prompt"> & { prompt?: string; messages?: OpenAiTurn[] }
): Promise<string> {
  const apiKey = await getOpenAiKey();
  if (!apiKey) {
    logTextGeneration(opts.label ?? "texto", model, Date.now(), false, "openai");
    throw new Error(OPENAI_KEY_MISSING);
  }
  return openaiGenerateText({ ...opts, model, apiKey });
}
