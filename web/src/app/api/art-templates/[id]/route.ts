import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().or(z.literal("")),
  day: z.number().int().min(1).max(31).nullable().optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  active: z.boolean().optional(),
  baseImageUrl: z.string().url().optional(),
});

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
  const data: Record<string, unknown> = { ...parsed.data };
  if (typeof data.month === "string") data.month = (data.month as string).trim() || null;

  try {
    const t = await prisma.artTemplate.update({ where: { id }, data });
    return Response.json(t);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return Response.json({ error: "Template não encontrado" }, { status: 404 });
    }
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  try {
    await prisma.artTemplate.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return Response.json({ error: "Template não encontrado" }, { status: 404 });
    }
    throw e;
  }
}
