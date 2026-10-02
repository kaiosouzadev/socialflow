import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { uuidString } from "@/lib/validators";
import EditPostForm from "./EditPostForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Editar post" };

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // id que não é uuid faria o Prisma lançar: vira 404
  if (!uuidString.safeParse(id).success) notFound();

  const [post, writers] = await Promise.all([
    prisma.post.findUnique({
      where: { id },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            agencyPublishes: true,
            socialAccounts: {
              where: { status: "active" },
              select: { platform: true },
            },
          },
        },
      },
    }),
    // GET /api/users é só para admin: a lista de redatoras vem do servidor (sem e-mail)
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  if (!post) notFound();

  const accountPlatforms = Array.from(
    new Set(post.client.socialAccounts.map((a) => a.platform))
  );

  const rawSlides = Array.isArray(post.slides)
    ? (post.slides as { text?: string }[]).map((s) => s?.text ?? "").filter(Boolean)
    : [];

  return (
    <div className="page animate-fade-up">
      <PageHeader
        title="Revisar e editar post"
        subtitle={post.theme?.trim() || undefined}
        back="/posts"
        backLabel="Voltar para Posts"
      />
      <EditPostForm
        post={{
          id: post.id,
          clientName: post.client.name,
          clientId: post.client.id,
          agencyPublishes: post.client.agencyPublishes,
          theme: post.theme ?? "",
          caption: post.caption ?? "",
          captions: (post.captions as Record<string, string> | null) ?? {},
          mediaUrl: post.mediaUrl ?? "",
          format: post.format ?? "feed",
          scheduledAt: post.scheduledAt.toISOString(),
          targets: post.targets,
          status: post.status,
          slides: rawSlides,
          writerId: post.writerId ?? "",
          internalNote: post.internalNote ?? "",
        }}
        accountPlatforms={accountPlatforms}
        writers={writers}
      />
    </div>
  );
}
