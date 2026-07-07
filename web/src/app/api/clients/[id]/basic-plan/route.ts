import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { listBasicMonths, generateBasicPlanMonth } from "@/lib/basic-plan";
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
});

/** Gera um lote de artes do mês para o cliente básico. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
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
    const result = await generateBasicPlanMonth(id, parsed.data.month);
    return Response.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha na geração";
    return Response.json({ error: msg }, { status: 502 });
  }
}
