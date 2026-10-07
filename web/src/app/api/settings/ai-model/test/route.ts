import { z } from "zod";
import { requireAdmin } from "@/lib/api-auth";
import { generateText } from "@/lib/gemini";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import {
  OPENAI_UNAVAILABLE,
  describeModelTestError,
  isValidModelId,
  modelLabel,
  normalizeModelId,
  systemTextModels,
} from "@/lib/ai-models";

export const dynamic = "force-dynamic";
// até 2 modelos × (2 tentativas × 20 s + 1,5 s) no pior caso do "Padrão do sistema"
export const maxDuration = 90;

const MSG = {
  body: "Escolha um modelo da lista ou digite o ID do modelo.",
  modelId: "ID de modelo inválido: use letras minúsculas, números, ponto e hífen, sem espaços (ex.: gemini-3.8-flash).",
  openai: `${OPENAI_UNAVAILABLE}. Por enquanto, teste um modelo Gemini.`,
} as const;

/** Pedido mínimo (poucos tokens), em pt-BR. */
const TEST_PROMPT = "Teste de conexão do sistema. Responda apenas com a palavra OK.";
const TEST_TIMEOUT_MS = 20_000;

const bodySchema = z.object({
  provider: z.enum(["google", "openai"]).default("google"),
  /** null = testar o "Padrão do sistema" (modelo de legendas e de calendário) */
  model: z.string().max(200).nullable(),
});

type ModelTestResult =
  | { model: string; label: string; ok: true; ms: number }
  | { model: string; label: string; ok: false; ms: number; error: string };

async function runTest(model: string): Promise<ModelTestResult> {
  const startedAt = Date.now();
  try {
    await generateText({ model, label: "teste-modelo", prompt: TEST_PROMPT, temperature: 0, timeoutMs: TEST_TIMEOUT_MS });
    return { model, label: modelLabel(model), ok: true, ms: Date.now() - startedAt };
  } catch (e) {
    // o detalhe técnico fica só no log; a tela recebe a frase pt-BR
    console.error("[settings/ai-model/test]", model, e instanceof Error ? e.message.slice(0, 300) : e);
    return { model, label: modelLabel(model), ok: false, ms: Date.now() - startedAt, error: describeModelTestError(e) };
  }
}

/**
 * Botão "Testar modelo" da tela "Modelos de IA" (só administradores). NÃO salva nada.
 * Corpo `{ provider: "google", model: "<id>" | null }` (null = os modelos do padrão do sistema).
 * 200 → `{ results: ModelTestResult[] }` (o modelo pode ter falhado: veja `ok`/`error` de cada um).
 * Erros: 401/403 (requireAdmin); 400 corpo/ID inválido ou ChatGPT; 429 muitos testes seguidos.
 */
export async function POST(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const limited = enforceRateLimit(`ai-model-test:${clientIp(req)}`, 6, 60_000);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: MSG.body, field: "model" }, { status: 400 });
  if (parsed.data.provider === "openai") return Response.json({ error: MSG.openai, field: "provider" }, { status: 400 });

  let models: string[];
  if (parsed.data.model === null) {
    const system = systemTextModels();
    models = [...new Set([system.caption, system.calendar])];
  } else {
    const model = normalizeModelId(parsed.data.model);
    if (!isValidModelId(model)) return Response.json({ error: MSG.modelId, field: "model" }, { status: 400 });
    models = [model];
  }

  const results: ModelTestResult[] = [];
  for (const model of models) results.push(await runTest(model));
  return Response.json({ results });
}
