import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { syncMedia } from "@/lib/drive-sync";
import { toUserMessage } from "@/lib/user-facing-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

const FALLBACK = "Não foi possível sincronizar as mídias agora. Tente de novo em instantes.";

/** Texto de `toUserMessage` para configuração ausente no servidor (Drive, R2, chaves…). */
const NOT_CONFIGURED = /não está configurad[ao] no servidor/;

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
    console.error("[drive/sync]", e);
    const error = toUserMessage(e, FALLBACK);
    // falta de configuração não se resolve tentando de novo: 503 (serviço indisponível)
    return Response.json({ error }, { status: NOT_CONFIGURED.test(error) ? 503 : 500 });
  }
}
