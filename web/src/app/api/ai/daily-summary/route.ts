import { requireAuthUser } from "@/lib/api-auth";
import { enforceAiQuota } from "@/lib/ai-quota";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { generateDailySummary } from "@/lib/daily-summary";
import { toUserMessage } from "@/lib/user-facing-error";

export const dynamic = "force-dynamic";

const FALLBACK = "Não foi possível gerar o resumo do dia agora. Tente de novo em instantes.";

/** Regenera o resumo do dia (fuso SP) via IA e persiste. */
export async function POST(req: Request) {
  const { user, denied } = await requireAuthUser();
  if (denied) return denied;

  // rajada por IP + teto de gerações por IA da usuária e do sistema (CF-07/CF-12)
  const limited = enforceRateLimit(`ai-daily-summary:${clientIp(req)}`, 10, 5 * 60_000);
  if (limited) return limited;
  const quota = enforceAiQuota(user.id, 1, "resumo-do-dia");
  if (quota) return quota;

  try {
    const result = await generateDailySummary();
    return Response.json(result);
  } catch (e) {
    console.error("[ai/daily-summary]", e);
    return Response.json({ error: toUserMessage(e, FALLBACK) }, { status: 500 });
  }
}
