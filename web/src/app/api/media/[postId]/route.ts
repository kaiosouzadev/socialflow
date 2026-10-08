import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyMedia } from "@/lib/media-token";
import { downloadFile, driveMediaType, looksLikeMarkup } from "@/lib/google-drive";

export const dynamic = "force-dynamic";

/**
 * Serve a mídia de um post (baixada do Drive) para o Graph API consumir.
 * Acesso por URL assinada (HMAC do postId) — sem sessão, pois quem busca é a
 * Graph API da Meta. A imagem se torna pública ao ser postada de qualquer forma.
 *
 * OWASP (AUD2): nunca repassa o tipo do Drive. Só JPEG/PNG/WebP e MP4/MOV/WebM
 * (lista de `driveMediaType`) saem, com o tipo da lista, `nosniff` e CSP que
 * não executa nada; SVG/HTML (ou conteúdo que é marcação) → 415.
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

  let file: { buffer: Buffer; contentType: string };
  try {
    file = await downloadFile(post.mediaDriveId);
  } catch {
    return Response.json({ error: "Falha ao obter a mídia" }, { status: 502 });
  }
  const type = driveMediaType(file.contentType);
  if (!type || looksLikeMarkup(file.buffer)) {
    return Response.json({ error: "Formato de mídia não suportado" }, { status: 415 });
  }
  return new Response(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": type.contentType,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=300",
    },
  });
}
