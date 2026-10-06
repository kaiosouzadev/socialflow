import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadDesignQueue } from "@/lib/design-queue";
import { artStatus } from "@/lib/production";
import { spDateKey } from "@/lib/deadlines";
import { Icon } from "@/components/Icons";
import { ArtStatusPanel, type ArtPanelData } from "../../design/DesignQueue";
import { DESIGNER_NONE } from "../../design/design-view";

/**
 * Cartão "Arte" do detalhe do post (componente de servidor): situação da arte
 * (regra única `hasArt`), quem marcou e quando, o arquivo esperado no Drive e
 * "Marcar como feita/não feita" (PATCH /api/posts/[id]/art, no ArtStatusPanel).
 * Lê os próprios dados: na página basta `<ArtStatusCard postId={post.id} />`.
 */
export default async function ArtStatusCard({ postId }: { postId: string }) {
  const [session, post] = await Promise.all([
    auth(),
    prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        clientId: true,
        mediaUrl: true,
        mediaItems: true,
        artDoneAt: true,
        artDoneByUser: { select: { id: true, name: true } },
        client: { select: { status: true, designer: { select: { id: true, name: true } } } },
      },
    }),
  ]);
  if (!post) return null;

  const now = new Date();
  const user = session?.user as { id?: string; name?: string | null } | undefined;
  const me = user?.id && user.name ? { id: user.id, name: user.name } : null;
  const month = spDateKey(post.scheduledAt).slice(0, 7);
  const hasMedia =
    (typeof post.mediaUrl === "string" && post.mediaUrl.trim() !== "") ||
    (Array.isArray(post.mediaItems) && post.mediaItems.length > 0);
  const published = post.status === "published";

  // Na fila (cliente ativo, não publicado): nome no Drive e atraso iguais aos da página /design.
  let item: Awaited<ReturnType<typeof loadDesignQueue>>["items"][number] | undefined;
  if (!published && post.client.status === "ativo") {
    try {
      const queue = await loadDesignQueue({ userId: me?.id ?? null, clientId: post.clientId, month, include: "todas", now });
      item = queue.items.find((i) => i.id === post.id);
    } catch (e) {
      // sem a fila o cartão ainda mostra a situação (sem o nome no Drive)
      console.error("[posts/art-card] fila de artes", e);
    }
  }

  const status = item?.artStatus ?? artStatus(post);
  const data: ArtPanelData = {
    postId: post.id,
    artStatus: status,
    artSource: item?.artSource ?? (post.artDoneAt ? "marcada" : hasMedia ? "midia" : published ? "publicado" : null),
    artDoneAt: post.artDoneAt ? post.artDoneAt.toISOString() : null,
    artDoneBy: post.artDoneByUser,
    hasMedia,
    scheduledAt: post.scheduledAt.toISOString(),
    late: item?.late ?? false,
    published,
    drive: item?.drive ? { file: item.drive.file, path: item.drive.path } : null,
    designer: post.client.designer,
    designHref: item
      ? `/design?${new URLSearchParams({
          mes: month,
          designer: post.client.designer?.id ?? DESIGNER_NONE,
          cliente: post.clientId,
          mostrar: "todas",
        })}`
      : null,
  };

  return (
    <section aria-labelledby="arte-post" className="card p-4 sm:p-5">
      <h2 id="arte-post" className="flex items-center gap-1.5 text-sm font-semibold text-fg">
        <Icon.edit className="size-4 text-fg-muted" />
        Arte
      </h2>
      <ArtStatusPanel data={data} me={me} nowMs={now.getTime()} />
    </section>
  );
}
