import { z } from "zod";
import { requireAdmin } from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { sessionUserId } from "@/lib/session-user";
import { isValidOpenAiKey } from "@/lib/ai-model-options";
import { readTextModelInfo, saveTextModelSetting } from "@/lib/ai-models";
import {
  encryptionReady,
  hasEnvOpenAiKey,
  readOpenAiKeyStatus,
  removeOpenAiKey,
  saveOpenAiKey,
} from "@/lib/openai-key";

export const dynamic = "force-dynamic";

/**
 * Chave da API da OpenAI (Administração → "Modelos de IA"). Só administradores.
 * A chave NUNCA volta ao navegador: as respostas trazem só a situação
 * (`configured`, `source` "saved"|"env"|null, `last4` da salva, `canSave`, quem/quando).
 * Nada da chave vai para log ou mensagem de erro.
 */

const MSG = {
  body: "Cole a chave da API da OpenAI.",
  format: "Chave inválida: a chave da OpenAI começa com “sk-” e não tem espaços.",
  cipher:
    "Não dá para guardar a chave com segurança: falta configurar a chave de cifra do servidor (TOKEN_ENC_KEY). Avise o responsável pelo servidor.",
  unavailable:
    "A configuração de modelos ainda não está disponível neste servidor (falta atualizar o banco).",
  failed: "Não foi possível salvar a chave agora. Tente de novo.",
  removeFailed: "Não foi possível remover a chave agora. Tente de novo.",
} as const;

const bodySchema = z.object({ key: z.string().max(500) });

/** GET → 200 situação da chave (sem a chave). */
export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return Response.json(await readOpenAiKeyStatus());
}

/** PUT `{ key: "sk-…" }` → cifra e grava; 200 situação. 400 formato; 503 sem TOKEN_ENC_KEY/tabela; 500 banco. */
export async function PUT(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: MSG.body, field: "key" }, { status: 400 });
  const key = parsed.data.key.trim();
  if (!key) return Response.json({ error: MSG.body, field: "key" }, { status: 400 });
  if (!isValidOpenAiKey(key)) return Response.json({ error: MSG.format, field: "key" }, { status: 400 });
  if (!encryptionReady()) return Response.json({ error: MSG.cipher, field: "key" }, { status: 503 });

  const before = await readOpenAiKeyStatus();
  if (!before.available) return Response.json({ error: MSG.unavailable }, { status: 503 });

  try {
    await saveOpenAiKey(key, await sessionUserId());
  } catch (e) {
    // só o código do erro: nunca o objeto (poderia carregar os dados gravados)
    console.error("[settings/openai-key] falha ao salvar", (e as { code?: unknown } | null)?.code ?? "erro");
    return Response.json({ error: MSG.failed }, { status: 500 });
  }
  console.info("[settings/openai-key] chave da OpenAI salva");
  // só o fato (salvou / substituiu); NUNCA a chave nem parte dela
  await audit(
    { action: "settings.openai_key", targetType: "setting", targetId: "ai.openaiKey", meta: { op: before.source === "saved" ? "replaced" : "saved" } },
    { req }
  );
  return Response.json(await readOpenAiKeyStatus());
}

/**
 * DELETE → apaga a chave salva. Se o ChatGPT estava em uso e não há OPENAI_API_KEY no ambiente,
 * o modelo de texto volta para o "Padrão do sistema" (`modelReset: true`).
 * 200 → situação + `modelReset` + `textModel` (a configuração do modelo, para a tela).
 */
export async function DELETE() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const status = await readOpenAiKeyStatus();
  if (!status.available) return Response.json({ error: MSG.unavailable }, { status: 503 });

  let modelReset = false;
  try {
    await removeOpenAiKey();
    const info = await readTextModelInfo();
    if (info.setting?.provider === "openai" && info.setting.model && !hasEnvOpenAiKey()) {
      await saveTextModelSetting({ provider: "google", model: null }, await sessionUserId());
      modelReset = true;
    }
  } catch (e) {
    console.error("[settings/openai-key] falha ao remover", (e as { code?: unknown } | null)?.code ?? "erro");
    return Response.json({ error: MSG.removeFailed }, { status: 500 });
  }
  console.info(`[settings/openai-key] chave da OpenAI removida${modelReset ? "; modelo de texto voltou ao padrão do sistema" : ""}`);
  await audit({ action: "settings.openai_key", targetType: "setting", targetId: "ai.openaiKey", meta: { op: "removed", modelReset } });
  return Response.json({ ...(await readOpenAiKeyStatus()), modelReset, textModel: await readTextModelInfo() });
}
