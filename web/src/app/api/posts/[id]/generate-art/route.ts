import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { r2Configured, uploadToR2 } from "@/lib/r2";
import { generateArt } from "@/lib/art-gen";
import { contactLines } from "@/lib/basic-plan";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { toUserMessage } from "@/lib/user-facing-error";

export const dynamic = "force-dynamic";
// geração de imagem + verificação pode passar de 60s
export const maxDuration = 300;

const FALLBACK = "Não foi possível gerar a arte agora. Tente de novo em instantes.";

const TZ = "America/Sao_Paulo";
const monthKey = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" })
    .format(d)
    .slice(0, 7);

/**
 * Gera a arte do post via IA (arte-base + logo + cor + tema) e grava em media_url.
 * Escolhe a arte-base ativa: prioriza a do mês do post, senão a mais recente ativa.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAuth();
  if (denied) return denied;
  if (!r2Configured()) {
    const cause = "R2 não configurado (variáveis R2_* ausentes)";
    console.error("[posts/generate-art]", cause);
    return Response.json({ error: toUserMessage(cause, FALLBACK) }, { status: 500 });
  }

  // rota mais cara de IA (imagem): 6 gerações/min por IP
  const limited = enforceRateLimit(`generate-art:${clientIp(req)}`, 6, 60_000);
  if (limited) return limited;

  const { id } = await params;
  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      client: {
        select: {
          id: true,
          logoUrl: true,
          brandColor: true,
          showContacts: true,
          phone: true,
          whatsapp: true,
          website: true,
          instagramUrl: true,
          city: true,
        },
      },
    },
  });
  if (!post) return Response.json({ error: "Post não encontrado" }, { status: 404 });
  if (post.status === "published" || post.status === "publishing") {
    return Response.json(
      { error: "Post já publicado (ou publicando) — a arte não pode ser substituída." },
      { status: 409 }
    );
  }

  const month = monthKey(post.scheduledAt);
  const template =
    (await prisma.artTemplate.findFirst({
      where: { active: true, month },
      orderBy: { createdAt: "desc" },
    })) ??
    (await prisma.artTemplate.findFirst({
      where: { active: true },
      orderBy: { createdAt: "desc" },
    }));

  if (!template) {
    return Response.json({ error: "Nenhuma arte-base ativa. Cadastre em /templates." }, { status: 400 });
  }

  try {
    const { buffer, mimeType } = await generateArt({
      templateUrl: template.baseImageUrl,
      logoUrl: post.client.logoUrl,
      brandColor: post.client.brandColor,
      theme: post.theme ?? "",
      format: post.format,
      contacts: contactLines(post.client),
    });

    const ext = mimeType.includes("jpeg") ? "jpg" : "png";
    const key = `arts/${post.client.id}/${post.id}-${Date.now()}.${ext}`;
    const url = await uploadToR2(key, buffer, mimeType);

    await prisma.post.update({
      where: { id: post.id },
      data: { mediaUrl: url, mediaDriveId: null },
    });

    return Response.json({ url, template: template.name });
  } catch (e) {
    console.error("[posts/generate-art]", e);
    return Response.json({ error: toUserMessage(e, FALLBACK) }, { status: 502 });
  }
}
