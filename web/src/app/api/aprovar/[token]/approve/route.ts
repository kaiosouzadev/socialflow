import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const OPEN = ["enviado_cliente", "em_revisao"];

/** Cliente aprova o cronograma (link público). Posts draft → scheduled. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = enforceRateLimit(`aprovar-approve:${clientIp(req)}`, 30, 60_000);
  if (limited) return limited;

  const { token } = await params;
  const schedule = await prisma.schedule.findUnique({ where: { approvalToken: token }, select: { id: true, status: true } });
  if (!schedule) return Response.json({ error: "Link inválido" }, { status: 404 });
  if (!OPEN.includes(schedule.status)) {
    return Response.json({ error: "Cronograma não está aberto para aprovação" }, { status: 409 });
  }

  const [, posts] = await prisma.$transaction([
    prisma.schedule.update({
      where: { id: schedule.id },
      data: { status: "aprovado_cliente", approvedAt: new Date() },
    }),
    prisma.post.updateMany({
      where: { scheduleId: schedule.id, status: "draft" },
      data: { status: "scheduled" },
    }),
  ]);

  return Response.json({ ok: true, scheduled: posts.count });
}
