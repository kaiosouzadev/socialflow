import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { checkInternalKey } from "@/lib/internal-auth";
import { decryptToken } from "@/lib/crypto";
import { publishToPlatform, type MediaItem } from "@/lib/meta-publish";
import { r2Configured, r2KeyFromUrl, deleteFromR2 } from "@/lib/r2";

export const dynamic = "force-dynamic";
// publish de vídeo/carrossel faz polling — pode levar minutos
export const maxDuration = 300;

/**
 * Publica um post nas redes-alvo (chamado pelo WF-01). Grava `publications`,
 * atualiza o status do post e, no sucesso, limpa a mídia do R2.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const denied = checkInternalKey(req);
  if (denied) return denied;

  const { postId } = await params;
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return Response.json({ error: "Post não encontrado" }, { status: 404 });

  const accounts = await prisma.socialAccount.findMany({
    where: { clientId: post.clientId, status: "active", platform: { in: post.targets } },
  });

  const captions = (post.captions as Record<string, string> | null) ?? {};
  const items = (post.mediaItems as MediaItem[] | null) ?? null;

  const results: { platform: string; ok: boolean; externalId?: string; error?: string }[] = [];

  for (const platform of post.targets) {
    const acc = accounts.find((a) => a.platform === platform);
    if (!acc) {
      results.push({ platform, ok: false, error: "conta não conectada" });
      continue;
    }
    try {
      const token = decryptToken(acc.accessTokenEnc);
      const caption = captions[platform] ?? post.caption ?? "";
      const externalId = await publishToPlatform(platform, acc.externalId, token, {
        format: post.format,
        mediaUrl: post.mediaUrl,
        mediaItems: items,
        caption,
      });
      await prisma.publication.create({
        data: { postId, platform, externalPostId: externalId, status: "success", publishedAt: new Date() },
      });
      results.push({ platform, ok: true, externalId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "erro";
      await prisma.publication.create({
        data: { postId, platform, status: "failed", error: msg.slice(0, 500) },
      });
      results.push({ platform, ok: false, error: msg });
    }
  }

  const allOk = results.length > 0 && results.every((r) => r.ok);

  if (allOk) {
    // limpa mídia do R2 + zera URLs
    if (r2Configured()) {
      const urls = [post.mediaUrl, ...(items?.map((i) => i.url) ?? [])].filter(Boolean) as string[];
      for (const u of urls) {
        const key = r2KeyFromUrl(u);
        if (key) await deleteFromR2(key).catch(() => {});
      }
    }
    await prisma.post.update({
      where: { id: postId },
      data: { status: "published", mediaUrl: null, mediaItems: Prisma.JsonNull, lastError: null },
    });
  } else {
    await prisma.post.update({
      where: { id: postId },
      data: {
        status: "failed",
        retryCount: { increment: 1 },
        lastError: results.find((r) => !r.ok)?.error?.slice(0, 500) ?? "falha",
      },
    });
  }

  return Response.json({ ok: allOk, results });
}
