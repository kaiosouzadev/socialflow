import { requireAuth } from "@/lib/api-auth";
import { generateDailySummary } from "@/lib/daily-summary";
import { toUserMessage } from "@/lib/user-facing-error";

export const dynamic = "force-dynamic";

const FALLBACK = "Não foi possível gerar o resumo do dia agora. Tente de novo em instantes.";

/** Regenera o resumo do dia (fuso SP) via IA e persiste. */
export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const result = await generateDailySummary();
    return Response.json(result);
  } catch (e) {
    console.error("[ai/daily-summary]", e);
    return Response.json({ error: toUserMessage(e, FALLBACK) }, { status: 500 });
  }
}
