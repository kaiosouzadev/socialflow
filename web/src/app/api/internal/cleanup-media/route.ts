import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { checkInternalKey } from "@/lib/internal-auth";
import { r2Configured, r2KeyFromUrl, deleteFromR2 } from "@/lib/r2";
import { thumbFromUrl } from "@/lib/media-thumb";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({
  // padrão 30 dias; override só para teste/manual
  days: z.number().int().min(0).max(365).default(30),
  limit: z.number().int().min(1).max(200).default(50),
});

/**
 * Limpeza de mídia de posts publicados (chamado pelo WF-06, diário).
 * Posts publicados há mais de `days` dias: garante a miniatura-lembrança
 * (gera antes de apagar, se faltar), exclui a mídia do R2 e zera as URLs.
 * A lembrança fica no Postgres — zero espaço no Cloudflare.
 */
export async function POST(req: NextRequest) {
  const denied = checkInternalKey(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (!r2Configured()) return Response.json({ error: "R2 não configurado" }, { status: 500 });

  const { days, limit } = parsed.data;
  const cutoff = new Date(Date.now() - days * 86400000);

  const posts = await prisma.post.findMany({
    where: {
      status: "published",
      scheduledAt: { lt: cutoff },
      OR: [{ mediaUrl: { not: null } }, { mediaItems: { not: Prisma.JsonNull } }],
    },
    orderBy: { scheduledAt: "asc" },
    take: limit,
    select: { id: true, mediaUrl: true, mediaItems: true, mediaThumb: true },
  });

  let cleaned = 0;
  let freedKeys = 0;
  const errors: string[] = [];

  for (const post of posts) {
    try {
      const items = (post.mediaItems as { url: string }[] | null) ?? [];
      const urls = [post.mediaUrl, ...items.map((i) => i.url)].filter(Boolean) as string[];

      // lembrança antes de apagar (se ainda não tem)
      let thumb = post.mediaThumb;
      if (!thumb) {
        for (const u of urls) {
          thumb = await thumbFromUrl(u);
          if (thumb) break;
        }
      }

      // só remove do R2 o que é nosso (URLs fora do R2 são ignoradas)
      for (const u of urls) {
        const key = r2KeyFromUrl(u);
        if (key) {
          await deleteFromR2(key);
          freedKeys++;
        }
      }

      await prisma.post.update({
        where: { id: post.id },
        data: {
          mediaUrl: null,
          mediaItems: Prisma.JsonNull,
          mediaDriveId: null,
          ...(thumb ? { mediaThumb: thumb } : {}),
        },
      });
      cleaned++;
    } catch (e) {
      errors.push(`${post.id}: ${e instanceof Error ? e.message : "erro"}`);
    }
  }

  return Response.json({ checked: posts.length, cleaned, freedKeys, days, errors });
}
