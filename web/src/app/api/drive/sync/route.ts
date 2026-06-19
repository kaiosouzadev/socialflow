import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { syncMedia } from "@/lib/drive-sync";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({ clientId: uuidString.optional() });

/** Sincronização manual de mídia (botão no painel). */
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const limited = enforceRateLimit(`drive-sync:${clientIp(req)}`, 10, 60_000);
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await syncMedia({ clientId: parsed.data.clientId, withinDays: 60 });
    return Response.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro na sincronização";
    return Response.json({ error: msg }, { status: 500 });
  }
}
