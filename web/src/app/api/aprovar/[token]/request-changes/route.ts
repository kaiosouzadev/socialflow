import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { z } from "zod";
import {
  LINK_ACTIONS_PER_MINUTE,
  bodyTooLarge,
  declaredBodyTooLarge,
  isTokenShaped,
  linkNotFound,
  monthlyLinkBlocked,
  monthlyLinkState,
  publicJson,
  readJsonCapped,
  tokenKey,
  withPublicHeaders,
} from "@/lib/approval";

export const dynamic = "force-dynamic";

const schema = z.object({
  note: z.string().max(2000).optional(),
});

/**
 * Cliente pede ajustes no cronograma (link público).
 *
 * Não mexe no status dos posts — eles continuam em rascunho, fora da fila.
 * Só marca o cronograma como "em_revisao" e guarda o comentário geral para a
 * agência ver na tela de Aprovações.
 * Ciclo de vida do link (lib/approval): aprovado → 409; 60 dias após o envio → 410.
 * O token é validado ANTES de ler o corpo, e o corpo tem teto de 32 KB (CF-16).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = enforceRateLimit(`aprovar-changes:${clientIp(req)}`, 20, 60_000);
  if (limited) return withPublicHeaders(limited);
  if (declaredBodyTooLarge(req)) return bodyTooLarge();

  const { token } = await params;
  if (!isTokenShaped(token)) return linkNotFound();
  const perLink = enforceRateLimit(`aprovar-link:${tokenKey(token)}`, LINK_ACTIONS_PER_MINUTE, 60_000);
  if (perLink) return withPublicHeaders(perLink);

  const schedule = await prisma.schedule.findUnique({
    where: { approvalToken: token },
    select: { id: true, status: true, sentAt: true, createdAt: true },
  });
  if (!schedule) return linkNotFound();
  const blocked = monthlyLinkBlocked(monthlyLinkState(schedule));
  if (blocked) return blocked;

  const body = await readJsonCapped(req);
  if (body.tooLarge) return bodyTooLarge();
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) return publicJson({ error: parsed.error.flatten() }, 400);

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

  return publicJson({ ok: true, postsWithNotes: withNotes });
}
