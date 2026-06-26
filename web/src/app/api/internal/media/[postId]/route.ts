import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { checkInternalKey } from "@/lib/internal-auth";
import { r2Configured, r2KeyFromUrl, deleteFromR2 } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Apaga a mídia do R2 após a publicação (chamado pelo n8n no sucesso do WF-01).
 * Remove o objeto único (mediaUrl) e os itens de carrossel (mediaItems), e
 * limpa as URLs no post. Não toca no Drive (origem).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const denied = checkInternalKey(req);
  if (denied) return denied;

  const { postId } = await params;
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { mediaUrl: true, mediaItems: true },
  });
  if (!post) return Response.json({ error: "Post não encontrado" }, { status: 404 });

  if (!r2Configured()) {
    return Response.json({ deleted: 0, note: "R2 não configurado" });
  }

  // coleta as URLs (single + itens do carrossel)
  const urls: string[] = [];
  if (post.mediaUrl) urls.push(post.mediaUrl);
  if (Array.isArray(post.mediaItems)) {
    for (const it of post.mediaItems as { url?: string }[]) {
      if (it?.url) urls.push(it.url);
    }
  }

  let deleted = 0;
  for (const url of urls) {
    const key = r2KeyFromUrl(url);
    if (!key) continue;
    try {
      await deleteFromR2(key);
      deleted++;
    } catch {
      // segue; não falha a publicação por causa de limpeza
    }
  }

  await prisma.post.update({
    where: { id: postId },
    data: { mediaUrl: null, mediaItems: Prisma.JsonNull },
  });

  return Response.json({ deleted });
}
