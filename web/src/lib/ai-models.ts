import { prisma } from "@/lib/prisma";
import { getOpenAiKey } from "@/lib/openai-key";

/**
 * Modelo de IA de TEXTO do sistema (legendas, cronograma, assistente, resumo do
 * Dashboard, revisão semanal e artes-base) — Gemini (Google) ou ChatGPT (OpenAI).
 * A geração de IMAGENS não passa por aqui (continua em IMAGE_MODEL, lib/gemini.ts), e a
 * verificação de texto das artes (recebe imagem) fica SEMPRE no Gemini (getGeminiTextModel).
 * Para gerar texto use `generateAiText` (lib/ai-text.ts), que roteia pelo provedor.
 *
 * Ordem de resolução (getTextModel):
 *   1. configuração salva em Administração → "Modelos de IA" (app_settings['ai.textModel'],
 *      UM modelo para todo o texto; com ChatGPT, só se houver chave da OpenAI — senão o passo 2/3);
 *   2. sem configuração (ou "Padrão do sistema"): env GEMINI_CAPTION_MODEL / GEMINI_CALENDAR_MODEL;
 *   3. padrão de código por função (legendas: gemini-2.5-flash · calendário: gemini-3.5-flash).
 * Sem nada salvo, o resultado é idêntico ao de antes desta tela.
 *
 * A leitura do banco tem cache curto em memória (TEXT_MODEL_CACHE_MS) e é invalidada ao salvar.
 * Se a tabela não existir (produção antes da migração) ou o banco falhar, vale o passo 2/3
 * sem quebrar nada (um aviso no log por processo).
 */

import {
  OPENAI_KEY_MISSING,
  TEXT_MODEL_DEFAULTS,
  isValidModelId,
  type AiProvider,
  type TextModelKind,
} from "@/lib/ai-model-options";

// a parte pura (opções, validação do ID, nomes) vive em lib/ai-model-options.ts (serve à tela também)
export {
  MODEL_ID_PATTERN,
  OPENAI_KEY_MISSING,
  PROVIDER_LABELS,
  TEXT_MODEL_DEFAULTS,
  TEXT_MODEL_OPTIONS,
  isValidModelId,
  modelLabel,
  normalizeModelId,
} from "@/lib/ai-model-options";
export type { AiProvider, TextModelKind } from "@/lib/ai-model-options";

/** O que os geradores de texto usam: provedor + ID do modelo. */
export type TextModel = { provider: AiProvider; model: string };
/** Valor salvo em app_settings['ai.textModel']. `model: null` = padrão do sistema. */
export type TextModelSetting = { provider: AiProvider; model: string | null };

export const TEXT_MODEL_KEY = "ai.textModel";
export const TEXT_MODEL_CACHE_MS = 30_000;

/** Modelo do sistema (env → padrão de código) para a função, lido na hora. */
export function systemTextModel(kind: TextModelKind): string {
  const env = kind === "caption" ? process.env.GEMINI_CAPTION_MODEL : process.env.GEMINI_CALENDAR_MODEL;
  return env || TEXT_MODEL_DEFAULTS[kind];
}

export function systemTextModels(): Record<TextModelKind, string> {
  return { caption: systemTextModel("caption"), calendar: systemTextModel("calendar") };
}

/** Valor do banco → configuração válida, ou null (ausente/ilegível = padrão do sistema). */
export function parseTextModelSetting(value: unknown): TextModelSetting | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as { provider?: unknown; model?: unknown };
  if (v.provider !== "google" && v.provider !== "openai") return null;
  if (v.model === null || v.model === undefined) return { provider: v.provider, model: null };
  if (typeof v.model !== "string" || !isValidModelId(v.model)) return null;
  return { provider: v.provider, model: v.model };
}

/**
 * Regra pura: configuração salva (com modelo) vence; senão o modelo do sistema (Gemini).
 * A falta de chave da OpenAI é checada em getTextModel (precisa do banco).
 */
export function resolveTextModel(kind: TextModelKind, setting: TextModelSetting | null): TextModel {
  if (setting && setting.model) return { provider: setting.provider, model: setting.model };
  return { provider: "google", model: systemTextModel(kind) };
}

// ------------------------------------------------------------ cache (por processo)

type CacheState = {
  entry: { setting: TextModelSetting | null; expires: number } | null;
  pending: Promise<TextModelSetting | null> | null;
  warned: boolean;
};

// em globalThis: no `next dev` cada rota pode ter a sua cópia do módulo; a invalidação ao
// salvar precisa valer para todas no mesmo processo
const holder = globalThis as unknown as { __sfTextModel?: CacheState };
function cacheState(): CacheState {
  if (!holder.__sfTextModel) holder.__sfTextModel = { entry: null, pending: null, warned: false };
  return holder.__sfTextModel;
}

/** Esquece a configuração lida (chamar depois de salvar). */
export function invalidateTextModelCache(): void {
  const s = cacheState();
  s.entry = null;
  s.pending = null;
}

function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  return e instanceof Error ? e.name : "erro";
}

function warnOnce(text: string): void {
  const s = cacheState();
  if (s.warned) return;
  s.warned = true;
  console.warn(`[ai-models] ${text}`);
}

async function readSetting(): Promise<TextModelSetting | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: TEXT_MODEL_KEY }, select: { value: true } });
    if (!row) return null;
    const setting = parseTextModelSetting(row.value);
    if (!setting) warnOnce("valor inválido em app_settings['ai.textModel']; usando o padrão do sistema");
    return setting;
  } catch (e) {
    const code = errorCode(e);
    // P2021 = tabela inexistente (produção antes da migração 2026-10-07-app-settings.sql)
    warnOnce(
      `configuração do modelo de texto indisponível (${code}${code === "P2021" ? ": tabela app_settings ausente" : ""}); usando o padrão do sistema`,
    );
    return null;
  }
}

async function loadSetting(): Promise<TextModelSetting | null> {
  const s = cacheState();
  if (s.entry && s.entry.expires > Date.now()) return s.entry.setting;
  if (!s.pending) {
    const pending = readSetting().then((setting) => {
      const st = cacheState();
      // uma invalidação no meio do caminho descarta esta leitura
      if (st.pending === pending) {
        st.entry = { setting, expires: Date.now() + TEXT_MODEL_CACHE_MS };
        st.pending = null;
      }
      return setting;
    });
    s.pending = pending;
  }
  return s.pending;
}

/**
 * Modelo de texto a usar AGORA na função `kind` (provedor + ID). Nunca lança: sem banco/tabela,
 * devolve o modelo do sistema (env → padrão). ChatGPT escolhido sem chave da OpenAI (nem salva
 * nem no ambiente) → modelo do sistema, com um aviso no log (a geração não para).
 */
export async function getTextModel(kind: TextModelKind): Promise<TextModel> {
  const resolved = resolveTextModel(kind, await loadSetting());
  if (resolved.provider === "openai" && !(await getOpenAiKey())) {
    warnOnce("ChatGPT escolhido, mas sem chave da OpenAI; usando o padrão do sistema (Gemini)");
    return { provider: "google", model: systemTextModel(kind) };
  }
  return resolved;
}

/**
 * Modelo GEMINI para o que só roda no Gemini (a verificação de texto das artes, que recebe
 * imagem): o Gemini escolhido na tela, ou — com ChatGPT escolhido — o modelo do sistema.
 */
export async function getGeminiTextModel(kind: TextModelKind): Promise<string> {
  const setting = await loadSetting();
  if (setting && setting.provider === "google" && setting.model) return setting.model;
  return systemTextModel(kind);
}

// ------------------------------------------------------------ tela de Administração

export type TextModelInfo = {
  /** false = tabela app_settings ausente/banco indisponível (a tela não salva) */
  available: boolean;
  setting: TextModelSetting | null;
  updatedAt: string | null;
  updatedByName: string | null;
  /** modelos do sistema por função (o "Padrão do sistema") */
  system: Record<TextModelKind, string>;
};

/** Configuração atual para a tela de Administração (sem cache). */
export async function readTextModelInfo(): Promise<TextModelInfo> {
  const system = systemTextModels();
  try {
    const row = await prisma.appSetting.findUnique({
      where: { key: TEXT_MODEL_KEY },
      select: { value: true, updatedAt: true, updater: { select: { name: true } } },
    });
    return {
      available: true,
      setting: row ? parseTextModelSetting(row.value) : null,
      updatedAt: row ? row.updatedAt.toISOString() : null,
      updatedByName: row?.updater?.name ?? null,
      system,
    };
  } catch (e) {
    console.warn(`[ai-models] leitura da configuração falhou (${errorCode(e)})`);
    return { available: false, setting: null, updatedAt: null, updatedByName: null, system };
  }
}

/** Grava a configuração (quem salvou em `userId`) e invalida o cache. */
export async function saveTextModelSetting(setting: TextModelSetting, userId: string | null): Promise<void> {
  const value = { provider: setting.provider, model: setting.model };
  const write = (updatedBy: string | null) =>
    prisma.appSetting.upsert({
      where: { key: TEXT_MODEL_KEY },
      create: { key: TEXT_MODEL_KEY, value, updatedBy },
      update: { value, updatedBy },
    });
  try {
    await write(userId);
  } catch (e) {
    // P2003: a usuária da sessão não existe mais (JWT antigo) → grava sem autor
    if (errorCode(e) !== "P2003" || userId === null) throw e;
    await write(null);
  } finally {
    invalidateTextModelCache();
  }
}

// ------------------------------------------------------------ botão "Testar modelo"

/**
 * Erro da chamada de teste → mensagem pt-BR curta, sem detalhe técnico (N-14).
 * O detalhe vai só para o log do servidor.
 */
export function describeModelTestError(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (name === "AbortError" || name === "TimeoutError" || /\b(aborted|timed out)\b/i.test(msg)) {
    return "Tempo esgotado: o modelo demorou demais para responder. Tente de novo.";
  }
  if (msg === OPENAI_KEY_MISSING) return OPENAI_KEY_MISSING;
  const openai = /^OpenAI (\d{3}) ([\w.-]+)/.exec(msg);
  if (openai) return describeOpenAiStatus(Number(openai[1]), openai[2]);
  if (/^OpenAI não retornou/i.test(msg)) {
    return "O modelo respondeu sem texto. Tente de novo; se repetir, escolha outro modelo.";
  }
  if (/^Falha de conexão com a OpenAI/.test(msg)) return "Falha de conexão com a OpenAI. Tente de novo em instantes.";
  if (/GEMINI_API_KEY/.test(msg)) return "A IA não está configurada no servidor. Avise o administrador do sistema.";
  const status = /^Gemini (\d{3})\b/.exec(msg)?.[1];
  if (status === "404") return "Modelo não encontrado: confira o ID.";
  if (status === "400") {
    if (/API key|API_KEY/i.test(msg)) return "Sem permissão: a chave da IA do servidor foi recusada.";
    return "Modelo não encontrado ou sem suporte a texto: confira o ID.";
  }
  if (status === "401" || status === "403") return "Sem permissão para usar este modelo com a chave da IA do servidor.";
  if (status === "429") return "Limite de uso da IA atingido agora. Tente de novo em alguns minutos.";
  if (status && status.startsWith("5")) return "A IA está instável agora. Tente de novo em instantes.";
  if (/Gemini não retornou/i.test(msg)) return "O modelo respondeu sem texto. Tente de novo; se repetir, escolha outro modelo.";
  if (/fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(msg)) {
    return "Falha de conexão com a IA. Tente de novo em instantes.";
  }
  return "Não foi possível testar o modelo agora. Tente de novo em instantes.";
}

/** Erro HTTP da OpenAI (status + code) → frase pt-BR curta para a tela de Administração. */
function describeOpenAiStatus(status: number, code: string): string {
  if (status === 401 || code === "invalid_api_key") return "Chave da OpenAI inválida: confira a chave salva.";
  if (code === "insufficient_quota") return "Sem créditos/limite na OpenAI: confira o faturamento da conta.";
  if (status === 404 || code === "model_not_found") return "Modelo não encontrado: confira o ID.";
  if (status === 403) return "Sem permissão para usar este modelo com a chave da OpenAI.";
  if (status === 429) return "Limite de uso da OpenAI atingido agora. Tente de novo em alguns minutos.";
  if (status >= 500) return "A OpenAI está instável agora. Tente de novo em instantes.";
  if (status === 400) return "A OpenAI recusou o pedido para este modelo: confira o ID.";
  return "Não foi possível testar o modelo agora. Tente de novo em instantes.";
}
