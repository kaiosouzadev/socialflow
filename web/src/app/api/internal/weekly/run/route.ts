import type { NextRequest } from "next/server";
import { auth } from "@/auth";
import { checkInternalKey } from "@/lib/internal-auth";
import { runWeeklyReviews } from "@/lib/weekly";

export const dynamic = "force-dynamic";
// gera conteúdo IA em lote por cliente — pode passar de 1 min
export const maxDuration = 300;

/**
 * Monta e envia os links SEMANAIS de aprovação (posts completos da próxima
 * semana). Agendar no n8n para QUARTA e QUINTA (ex: 10h SP). Aceita:
 * - header x-internal-key (cron/n8n), ou
 * - sessão logada (botão manual no painel).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    const denied = checkInternalKey(req);
    if (denied) return denied;
  }

  try {
    const result = await runWeeklyReviews(req.nextUrl.origin);
    return Response.json(result);
  } catch (e) {
    console.error("[weekly/run]", e);
    const msg = e instanceof Error ? e.message : "erro";
    return Response.json({ error: msg }, { status: 500 });
  }
}
