import { z } from "zod";
import { requireAdmin } from "@/lib/api-auth";
import { sessionUserId } from "@/lib/session-user";
import { getOpenAiKey } from "@/lib/openai-key";
import {
  OPENAI_KEY_MISSING,
  isValidModelId,
  modelLabel,
  normalizeModelId,
  readTextModelInfo,
  saveTextModelSetting,
} from "@/lib/ai-models";

export const dynamic = "force-dynamic";

/** Textos do 400/503/500 (N-14: `error` é sempre uma frase pt-BR, nunca o objeto do zod). */
const MSG = {
  body: "Escolha um modelo da lista ou digite o ID do modelo.",
  modelId: "ID de modelo inválido: use letras minúsculas, números, ponto e hífen, sem espaços (ex.: gemini-3.8-flash ou gpt-5-mini).",
  openaiModel: "Escolha um modelo do ChatGPT ou digite o ID (ex.: gpt-5-mini).",
  unavailable:
    "A configuração de modelos ainda não está disponível neste servidor (falta atualizar o banco). Por enquanto vale o padrão do sistema.",
  failed: "Não foi possível salvar o modelo agora. Tente de novo.",
} as const;

const bodySchema = z.object({
  provider: z.enum(["google", "openai"]).default("google"),
  /** null = "Padrão do sistema" (Gemini) */
  model: z.string().max(200).nullable(),
});

/**
 * Modelo de IA de texto do sistema (Administração → "Modelos de IA"). Só administradores.
 *
 * GET → 200 `{ available, setting: { provider, model|null } | null, updatedAt, updatedByName, system: { caption, calendar } }`
 *   (`setting` null ou `model` null = padrão do sistema; `available` false = tabela app_settings ausente).
 */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return Response.json(await readTextModelInfo());
}

/**
 * PUT `{ provider: "google" | "openai", model: "<id>" | null }` → grava e vale na próxima geração (cache invalidado).
 * 200 → o mesmo corpo do GET + `label` (nome amigável do que ficou valendo).
 * Erros: 401/403 (requireAdmin); 400 corpo/ID inválido, ou ChatGPT sem chave da OpenAI (`field: "openaiKey"`);
 * 503 tabela ausente; 500 falha do banco — sempre `{ error: "<pt-BR>" }`.
 */
export async function PUT(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: MSG.body, field: "model" }, { status: 400 });
  let { provider } = parsed.data;

  let model: string | null = null;
  if (parsed.data.model !== null) {
    model = normalizeModelId(parsed.data.model);
    if (!isValidModelId(model)) return Response.json({ error: MSG.modelId, field: "model" }, { status: 400 });
  }
  if (provider === "openai") {
    if (model === null) return Response.json({ error: MSG.openaiModel, field: "model" }, { status: 400 });
    if (!(await getOpenAiKey())) return Response.json({ error: OPENAI_KEY_MISSING, field: "openaiKey" }, { status: 400 });
  }
  // "Padrão do sistema" é sempre o Gemini padrão por função
  if (model === null) provider = "google";

  const before = await readTextModelInfo();
  if (!before.available) return Response.json({ error: MSG.unavailable }, { status: 503 });

  try {
    await saveTextModelSetting({ provider, model }, await sessionUserId());
  } catch (e) {
    console.error("[settings/ai-model] falha ao salvar", (e as { code?: string } | null)?.code ?? "erro");
    return Response.json({ error: MSG.failed }, { status: 500 });
  }
  console.info(`[settings/ai-model] modelo de texto alterado para ${model ? `${provider}/${model}` : "padrão do sistema"}`);
  const info = await readTextModelInfo();
  return Response.json({ ...info, label: model ? modelLabel(model) : "Padrão do sistema" });
}
