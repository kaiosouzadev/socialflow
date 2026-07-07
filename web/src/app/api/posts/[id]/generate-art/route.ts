import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { r2Configured, uploadToR2 } from "@/lib/r2";
import { generateArt } from "@/lib/art-gen";
import { contactLines } from "@/lib/basic-plan";

export const dynamic = "force-dynamic";

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
  if (!r2Configured()) return Response.json({ error: "R2 não configurado" }, { status: 500 });

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
    const msg = e instanceof Error ? e.message : "Falha ao gerar arte";
    return Response.json({ error: msg }, { status: 502 });
  }
}
