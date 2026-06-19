import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import EditPostForm from "./EditPostForm";

export const dynamic = "force-dynamic";

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          socialAccounts: {
            where: { status: "active" },
            select: { platform: true },
          },
        },
      },
    },
  });

  if (!post) notFound();

  const availablePlatforms = Array.from(
    new Set(post.client.socialAccounts.map((a) => a.platform))
  );

  return (
    <div className="p-8 max-w-2xl mx-auto animate-fade-up">
      <PageHeader title="Editar post" back="/posts" />
      <EditPostForm
        post={{
          id: post.id,
          clientName: post.client.name,
          clientId: post.client.id,
          theme: post.theme ?? "",
          caption: post.caption ?? "",
          captions: (post.captions as Record<string, string> | null) ?? {},
          mediaUrl: post.mediaUrl ?? "",
          scheduledAt: post.scheduledAt.toISOString(),
          targets: post.targets,
          status: post.status,
        }}
        availablePlatforms={availablePlatforms}
      />
    </div>
  );
}
