import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/Icons";
import { BrandBadge, BRAND } from "@/components/BrandIcons";
import ApprovePostButton from "./ApprovePostButton";

export const dynamic = "force-dynamic";

const TZ = "America/Sao_Paulo";

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true } },
      publications: { orderBy: { publishedAt: "desc" } },
    },
  });

  if (!post) notFound();

  const editable =
    post.status === "scheduled" || post.status === "failed" || post.status === "draft";
  const isDraft = post.status === "draft";

  const capMap = (post.captions as Record<string, string> | null) ?? {};
  const captionEntries = post.targets
    .map((t) => ({ platform: t, text: capMap[t] ?? "" }))
    .filter((e) => e.text.trim());
  const when = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    dateStyle: "full",
    timeStyle: "short",
  }).format(post.scheduledAt);

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-up">
      <PageHeader
        title={post.theme || "Post"}
        back="/posts"
        action={
          editable && (
            <div className="flex items-center gap-2">
              <Link href={`/posts/${post.id}/edit`} className="btn-ghost">
                <Icon.edit className="w-4 h-4" />
                Editar
              </Link>
              {isDraft && (
                <ApprovePostButton postId={post.id} hasMedia={!!post.mediaUrl} />
              )}
            </div>
          )
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Media preview */}
        <div className="lg:col-span-3">
          <div className="card overflow-hidden">
            <div className="aspect-square bg-black/40 flex items-center justify-center">
              {post.mediaUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={post.mediaUrl}
                  alt={post.theme ?? "Mídia do post"}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-center text-[var(--color-text-faint)] p-8">
                  <Icon.alert className="w-8 h-8 mx-auto mb-2" />
                  <p className="text-sm">Sem mídia definida</p>
                </div>
              )}
            </div>
            {captionEntries.length > 0 ? (
              <div className="p-5 border-t border-[var(--color-border)] space-y-4">
                {captionEntries.map((e) => (
                  <div key={e.platform}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <BrandBadge platform={e.platform} size={20} />
                      <p className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider">
                        {BRAND[e.platform]?.label ?? e.platform}
                      </p>
                    </div>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{e.text}</p>
                  </div>
                ))}
              </div>
            ) : (
              post.caption && (
                <div className="p-5 border-t border-[var(--color-border)]">
                  <p className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider mb-2">
                    Legenda
                  </p>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{post.caption}</p>
                </div>
              )
            )}
          </div>
        </div>

        {/* Meta */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-muted)]">Status</span>
              <StatusBadge status={post.status} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-muted)]">Cliente</span>
              <Link
                href={`/clients/${post.client.id}`}
                className="text-sm font-medium hover:text-[var(--color-accent)]"
              >
                {post.client.name}
              </Link>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-muted)]">Redes</span>
              <div className="flex gap-1.5">
                {post.targets.map((t) => (
                  <BrandBadge key={t} platform={t} size={24} />
                ))}
              </div>
            </div>
            <div className="pt-3 border-t border-[var(--color-border)]">
              <span className="text-sm text-[var(--color-text-muted)] flex items-center gap-2">
                <Icon.clock className="w-4 h-4" />
                Agendado para
              </span>
              <p className="text-sm font-medium mt-1 capitalize">{when}</p>
            </div>
            {post.retryCount > 0 && (
              <div className="text-xs text-amber-300/90 bg-amber-500/[0.07] border border-amber-500/20 rounded-lg px-3 py-2">
                {post.retryCount} tentativa(s) de reenvio
                {post.lastError ? ` · último erro: ${post.lastError}` : ""}
              </div>
            )}
          </div>

          {/* Publications history */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--color-border)]">
              <h2 className="font-semibold text-sm">Histórico de publicação</h2>
            </div>
            {post.publications.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-[var(--color-text-muted)]">
                Ainda não publicado.
              </p>
            ) : (
              <div className="divide-y divide-[var(--color-border)]">
                {post.publications.map((pub) => (
                  <div key={pub.id} className="flex items-center gap-3 px-5 py-3">
                    <BrandBadge platform={pub.platform} size={28} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{BRAND[pub.platform]?.label ?? pub.platform}</p>
                      {pub.publishedAt && (
                        <p className="text-xs text-[var(--color-text-faint)]">
                          {new Intl.DateTimeFormat("pt-BR", {
                            timeZone: TZ,
                            dateStyle: "short",
                            timeStyle: "short",
                          }).format(pub.publishedAt)}
                        </p>
                      )}
                      {pub.error && <p className="text-xs text-red-300 truncate">{pub.error}</p>}
                    </div>
                    <StatusBadge status={pub.status === "success" ? "published" : "failed"} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
