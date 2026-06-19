import type { NextRequest } from "next/server";
import { checkInternalKey } from "@/lib/internal-auth";
import { syncMedia } from "@/lib/drive-sync";

export const dynamic = "force-dynamic";

/**
 * Verificador de mídia chamado pelo n8n (WF-05) de hora em hora.
 * Para posts agendados sem mídia, procura a imagem no Drive e a anexa.
 */
export async function POST(req: NextRequest) {
  const denied = checkInternalKey(req);
  if (denied) return denied;

  try {
    const result = await syncMedia({ withinDays: 30 });
    return Response.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro na sincronização";
    return Response.json({ error: msg }, { status: 500 });
  }
}
