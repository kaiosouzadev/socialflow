import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const captionsSchema = z
  .object({
    instagram: z.string().optional(),
    facebook: z.string().optional(),
    linkedin: z.string().optional(),
  })
  .optional();

const postSchema = z.object({
  theme: z.string().max(200).optional(),
  explanation: z.string().max(600).optional(),
  captions: captionsSchema,
  mediaUrl: z.string().url().optional().or(z.literal("")),
  format: z.enum(["feed", "story", "carrossel", "reels"]).default("feed"),
  scheduledAt: z.string().datetime(),
  targets: z.array(z.enum(["instagram", "facebook", "linkedin"])).min(1),
  slides: z.array(z.object({ text: z.string().max(2000) })).max(20).optional(),
});

const schema = z.object({
  clientId: uuidString,
  // mês de referência YYYY-MM (cria o cronograma)
  month: z.string().regex(/^\d{4}-\d{2}$/),
  // até 31 posts principais + os stories que saem junto de cada um
  posts: z.array(postSchema).min(1).max(62),
});

const pad = (n: number) => String(n).padStart(2, "0");

/** Salva os posts revisados como rascunhos (draft), num cronograma. */
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const limited = enforceRateLimit(`calendar-commit:${clientIp(req)}`, 20, 5 * 60_000);
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { clientId, month, posts } = parsed.data;
  const [year, mon] = month.split("-").map(Number);
  const monthRef = new Date(`${year}-${pad(mon)}-01T00:00:00-03:00`);

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) return Response.json({ error: "Cliente não encontrado" }, { status: 404 });

  // cronograma do mês: reaproveita apenas se ainda estiver editável; um mês já
  // enviado/aprovado não pode receber posts por engano
  const existing = await prisma.schedule.findFirst({
    where: { clientId, monthRef },
    select: { id: true, status: true },
  });
  if (existing && !["rascunho", "em_revisao"].includes(existing.status)) {
    return Response.json(
      {
        error:
          "Este mês já tem um cronograma " +
          (existing.status === "aprovado_cliente" ? "aprovado" : `(${existing.status})`) +
          ". Reverta a aprovação em /aprovacoes antes de gerar de novo.",
      },
      { status: 409 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const schedule =
        existing ??
        (await tx.schedule.create({
          data: { clientId, monthRef, status: "rascunho" },
          select: { id: true, status: true },
        }));

      // idempotência: retry/segunda aba não pode duplicar o mês — pula posts
      // idênticos (mesmo horário + mesmo formato) já salvos neste cronograma
      const already = await tx.post.findMany({
        where: { scheduleId: schedule.id },
        select: { scheduledAt: true, format: true },
      });
      const seen = new Set(already.map((p) => `${p.scheduledAt.getTime()}:${p.format}`));
      const fresh = posts.filter(
        (p) => !seen.has(`${new Date(p.scheduledAt).getTime()}:${p.format}`)
      );

      if (fresh.length > 0) {
        await tx.post.createMany({
          data: fresh.map((p, i) => {
            const captions: Record<string, string> = {};
            if (p.captions) {
              for (const [k, v] of Object.entries(p.captions)) {
                if (typeof v === "string" && v.trim()) captions[k] = v.trim();
              }
            }
            return {
              scheduleId: schedule.id,
              clientId,
              theme: (p.theme ?? `Post ${i + 1}`).slice(0, 200),
              explanation: p.explanation?.trim() || null,
              captions: Object.keys(captions).length
                ? (captions as Prisma.InputJsonValue)
                : undefined,
              slides: p.slides?.length
                ? (p.slides as unknown as Prisma.InputJsonValue)
                : undefined,
              mediaUrl: p.mediaUrl || null,
              format: p.format,
              scheduledAt: new Date(p.scheduledAt),
              targets: p.targets,
              status: "draft",
            };
          }),
        });
      }

      return { scheduleId: schedule.id, created: fresh.length, duplicates: posts.length - fresh.length };
    });

    return Response.json({ ...result, month }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao salvar o calendário";
    return Response.json({ error: `Banco: ${msg}` }, { status: 500 });
  }
}
