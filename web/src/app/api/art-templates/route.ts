import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().or(z.literal("")),
  day: z.number().int().min(1).max(31).nullable().optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  baseImageUrl: z.string().url(),
});

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const templates = await prisma.artTemplate.findMany({ orderBy: { createdAt: "desc" } });
  return Response.json(templates);
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const template = await prisma.artTemplate.create({
    data: {
      ...parsed.data,
      month: parsed.data.month?.trim() || null,
      day: parsed.data.day ?? null,
      time: parsed.data.time || "18:00",
    },
  });
  return Response.json(template, { status: 201 });
}
