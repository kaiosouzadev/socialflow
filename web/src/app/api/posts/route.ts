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

const createSchema = z.object({
  clientId: uuidString,
  theme: z.string().optional(),
  caption: z.string().optional(),
  captions: captionsSchema,
  mediaUrl: z.string().url().optional().or(z.literal("")),
  format: z.enum(["feed", "story", "carrossel", "reels"]).default("feed"),
  scheduledAt: z.string().datetime(),
  targets: z.array(z.enum(["instagram", "facebook", "linkedin"])).min(1),
});

export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");
  const status = searchParams.get("status");

  const posts = await prisma.post.findMany({
    where: {
      ...(clientId ? { clientId } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { scheduledAt: "desc" },
    take: 100,
    include: { client: { select: { name: true } } },
  });

  return Response.json(posts);
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { mediaUrl, captions, scheduledAt, ...rest } = parsed.data;
  try {
    const post = await prisma.post.create({
      data: {
        ...rest,
        captions: captions ? (captions as Prisma.InputJsonValue) : undefined,
        mediaUrl: mediaUrl || null,
        scheduledAt: new Date(scheduledAt),
      },
    });
    return Response.json(post, { status: 201 });
  } catch (e) {
    // FK inválida (clientId inexistente)
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return Response.json({ error: "Cliente não encontrado" }, { status: 400 });
    }
    throw e;
  }
}
