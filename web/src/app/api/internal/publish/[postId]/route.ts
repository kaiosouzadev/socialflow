import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkInternalKey } from "@/lib/internal-auth";
import { decryptToken } from "@/lib/crypto";
import { publishToPlatform, type MediaItem } from "@/lib/meta-publish";
import { thumbFromUrl } from "@/lib/media-thumb";

export const dynamic = "force-dynamic";
// publish de vídeo/carrossel faz polling — pode levar minutos
export const maxDuration = 300;

/**
 * Publica um post nas redes-alvo (chamado pelo WF-01). Grava `publications`,
 * atualiza o status e salva a miniatura-lembrança. A mídia cheia PERMANECE no
 * R2 por 30 dias (limpeza em /api/internal/cleanup-media, WF-06).
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
    // mídia fica no R2 por 30 dias (WF-06 limpa); grava a miniatura-lembrança
    const thumb = post.mediaUrl ? await thumbFromUrl(post.mediaUrl) : null;
    await prisma.post.update({
      where: { id: postId },
      data: { status: "published", lastError: null, ...(thumb ? { mediaThumb: thumb } : {}) },
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
