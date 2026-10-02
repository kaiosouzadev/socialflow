import { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { uuidString } from "@/lib/validators";
import { PENDING_KINDS } from "@/lib/status-meta";
import { pendingItemInclude } from "@/lib/doc-import-commit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const listSchema = z.object({
  clientId: uuidString.optional(),
  kind: z.enum(PENDING_KINDS).optional(),
  responsibleUserId: uuidString.optional(),
  // abertas (padrão), resolvidas ou todas
  state: z.enum(["open", "resolved", "all"]).default("open"),
});

const createSchema = z.object({
  clientId: uuidString,
  kind: z.enum(PENDING_KINDS).default("stand_by"),
  title: z.string().trim().min(1, "Informe o título").max(200),
  details: z.string().max(10_000).nullable().optional(),
  responsibleUserId: uuidString.nullable().optional(),
  postId: uuidString.nullable().optional(),
});

/** Pendências e stand-by (filtros: cliente, tipo, responsável, abertas/resolvidas). */
export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const parsed = listSchema.safeParse({
    clientId: sp.get("clientId") || undefined,
    kind: sp.get("kind") || undefined,
    responsibleUserId: sp.get("responsibleUserId") || undefined,
    state: sp.get("state") || undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { clientId, kind, responsibleUserId, state } = parsed.data;

  const items = await prisma.pendingItem.findMany({
    where: {
      ...(clientId ? { clientId } : {}),
      ...(kind ? { kind } : {}),
      ...(responsibleUserId ? { responsibleUserId } : {}),
      ...(state === "open" ? { resolvedAt: null } : state === "resolved" ? { resolvedAt: { not: null } } : {}),
    },
    // a mais antiga primeiro: stand-by esquecido aparece no topo
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 500,
    include: pendingItemInclude,
  });

  return Response.json(items);
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { clientId, kind, title, details, responsibleUserId, postId } = parsed.data;

  const [client, user, post] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }),
    responsibleUserId ? prisma.user.findUnique({ where: { id: responsibleUserId }, select: { id: true } }) : null,
    postId ? prisma.post.findUnique({ where: { id: postId }, select: { clientId: true } }) : null,
  ]);
  if (!client) return Response.json({ error: "Cliente não encontrado" }, { status: 400 });
  if (responsibleUserId && !user) return Response.json({ error: "Responsável não encontrado" }, { status: 400 });
  if (postId && (!post || post.clientId !== clientId)) {
    return Response.json({ error: "Post não encontrado para este cliente" }, { status: 400 });
  }

  try {
    const item = await prisma.pendingItem.create({
      data: {
        clientId,
        kind,
        title,
        details: details?.trim() || null,
        responsibleUserId: responsibleUserId ?? null,
        postId: postId ?? null,
      },
      include: pendingItemInclude,
    });
    return Response.json(item, { status: 201 });
  } catch (e) {
    // cliente/usuário/post removido entre a checagem e a gravação
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return Response.json({ error: "Cliente, responsável ou post não encontrado" }, { status: 400 });
    }
    throw e;
  }
}
