import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const OPEN = ["enviado_cliente", "em_revisao"];

const schema = z.object({
  note: z.string().max(2000).optional(),
});

/**
 * Cliente pede ajustes no cronograma (link público).
 *
 * Não mexe no status dos posts — eles continuam em rascunho, fora da fila.
 * Só marca o cronograma como "em_revisao" e guarda o comentário geral para a
 * agência ver na tela de Aprovações.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = enforceRateLimit(`aprovar-changes:${clientIp(req)}`, 20, 60_000);
  if (limited) return limited;

  const { token } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });

  const schedule = await prisma.schedule.findUnique({
    where: { approvalToken: token },
    select: { id: true, status: true },
  });
  if (!schedule) return Response.json({ error: "Link inválido" }, { status: 404 });
  if (!OPEN.includes(schedule.status)) {
    return Response.json(
      { error: "Cronograma não está aberto para revisão" },
      { status: 409 }
    );
  }

  const note = (parsed.data.note ?? "").trim();

  // quantos posts já têm comentário individual — a agência vê o total no retorno
  const [, withNotes] = await prisma.$transaction([
    prisma.schedule.update({
      where: { id: schedule.id },
      data: {
        status: "em_revisao",
        clientNote: note || null,
        changesAskedAt: new Date(),
      },
    }),
    prisma.post.count({
      where: { scheduleId: schedule.id, clientNote: { not: null } },
    }),
  ]);

  return Response.json({ ok: true, postsWithNotes: withNotes });
}
