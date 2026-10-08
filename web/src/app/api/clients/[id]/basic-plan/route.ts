import type { NextRequest } from "next/server";
import { requireAuth, requireAuthUser } from "@/lib/api-auth";
import { enforceAiQuota } from "@/lib/ai-quota";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import {
  listBasicMonths,
  scheduleBasicMonth,
  generateBasicArtsMonth,
} from "@/lib/basic-plan";
import { z } from "zod";

export const dynamic = "force-dynamic";
// geração de imagem por IA é lenta; processa em lotes por chamada
export const maxDuration = 300;

/** Meses do banco de artes básicas + progresso deste cliente. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  const months = await listBasicMonths(id);
  return Response.json({ months });
}

const schema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  // schedule = só agenda os posts (sem arte); arts = gera as artes pendentes
  action: z.enum(["schedule", "arts"]).default("arts"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, denied } = await requireAuthUser();
  if (denied) return denied;

  const limited = enforceRateLimit(`basic-plan:${clientIp(req)}`, 30, 5 * 60_000);
  if (limited) return limited;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    // cota de IA por usuária: legendas (agendar) ou artes do mês contam como 5 gerações
    const quota = enforceAiQuota(user.id, 5, "plano-basico");
    if (quota) return quota;
    if (parsed.data.action === "schedule") {
      const result = await scheduleBasicMonth(id, parsed.data.month);
      return Response.json(result);
    }
    const result = await generateBasicArtsMonth(id, parsed.data.month);
    return Response.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha na operação";
    return Response.json({ error: msg }, { status: 502 });
  }
}
