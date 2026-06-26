import { requireAuth } from "@/lib/api-auth";
import { generateDailySummary } from "@/lib/daily-summary";

export const dynamic = "force-dynamic";

/** Regenera o resumo do dia (fuso SP) via IA e persiste. */
export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const result = await generateDailySummary();
    return Response.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao gerar resumo";
    return Response.json({ error: msg }, { status: 500 });
  }
}
