import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyMedia } from "@/lib/media-token";
import { downloadFile } from "@/lib/google-drive";

export const dynamic = "force-dynamic";

/**
 * Serve a mídia de um post (baixada do Drive) para o Graph API consumir.
 * Acesso por URL assinada (HMAC do postId) — sem sessão, pois quem busca é a
 * Graph API da Meta. A imagem se torna pública ao ser postada de qualquer forma.
 */
export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/media/[postId]">
) {
  const { postId } = await ctx.params;
  const sig = req.nextUrl.searchParams.get("sig") ?? "";

  if (!verifyMedia(postId, sig)) {
    return Response.json({ error: "Assinatura inválida" }, { status: 403 });
  }

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { mediaDriveId: true },
  });
  if (!post?.mediaDriveId) {
    return Response.json({ error: "Mídia não encontrada" }, { status: 404 });
  }

  try {
    const { buffer, contentType } = await downloadFile(post.mediaDriveId);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return Response.json({ error: "Falha ao obter a mídia" }, { status: 502 });
  }
}
