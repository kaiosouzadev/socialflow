import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";
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
  captions: captionsSchema,
  mediaUrl: z.string().url().optional().or(z.literal("")),
  scheduledAt: z.string().datetime(),
  targets: z.array(z.enum(["instagram", "facebook", "linkedin"])).min(1),
});

const schema = z.object({
  clientId: uuidString,
  // mês de referência YYYY-MM (cria o cronograma)
  month: z.string().regex(/^\d{4}-\d{2}$/),
  posts: z.array(postSchema).min(1).max(31),
});

const pad = (n: number) => String(n).padStart(2, "0");

/** Salva os posts revisados como rascunhos (draft), num cronograma. */
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

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

  try {
    const result = await prisma.$transaction(async (tx) => {
      const schedule = await tx.schedule.create({
        data: { clientId, monthRef, status: "rascunho" },
      });

      await tx.post.createMany({
        data: posts.map((p, i) => {
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
            captions: Object.keys(captions).length
              ? (captions as Prisma.InputJsonValue)
              : undefined,
            mediaUrl: p.mediaUrl || null,
            scheduledAt: new Date(p.scheduledAt),
            targets: p.targets,
            status: "draft",
          };
        }),
      });

      return { scheduleId: schedule.id, created: posts.length };
    });

    return Response.json({ ...result, month }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao salvar o calendário";
    return Response.json({ error: `Banco: ${msg}` }, { status: 500 });
  }
}
