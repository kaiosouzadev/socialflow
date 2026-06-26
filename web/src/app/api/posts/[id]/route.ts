import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  theme: z.string().optional(),
  caption: z.string().optional(),
  captions: z
    .object({
      instagram: z.string().optional(),
      facebook: z.string().optional(),
      linkedin: z.string().optional(),
    })
    .optional(),
  mediaUrl: z.string().url().optional().or(z.literal("")),
  format: z.enum(["feed", "story", "carrossel", "reels"]).optional(),
  scheduledAt: z.string().datetime().optional(),
  targets: z.array(z.enum(["instagram", "facebook", "linkedin"])).min(1).optional(),
  status: z.enum(["scheduled", "failed", "draft"]).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      client: true,
      publications: { orderBy: { publishedAt: "desc" } },
    },
  });

  if (!post) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(post);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { mediaUrl, scheduledAt, captions, ...rest } = parsed.data;
  const post = await prisma.post.update({
    where: { id },
    data: {
      ...rest,
      ...(captions !== undefined ? { captions: captions as Prisma.InputJsonValue } : {}),
      ...(mediaUrl !== undefined ? { mediaUrl: mediaUrl || null } : {}),
      ...(scheduledAt ? { scheduledAt: new Date(scheduledAt) } : {}),
    },
  });

  return Response.json(post);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  await prisma.post.delete({ where: { id } });
  return Response.json({ ok: true });
}
