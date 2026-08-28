import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/Icons";
import { BrandBadge, BRAND } from "@/components/BrandIcons";
import ApprovePostButton from "./ApprovePostButton";
import GenerateArtButton from "./GenerateArtButton";

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
      client: { select: { id: true, name: true, tier: true } },
      publications: { orderBy: { publishedAt: "desc" } },
    },
  });

  if (!post) notFound();

  const editable =
    post.status === "scheduled" || post.status === "failed" || post.status === "draft";
  const isDraft = post.status === "draft";

  const capMap = (post.captions as Record<string, string> | null) ?? {};
  // FB+IG usam legenda única no sistema: quando o texto é o mesmo, mostra um
  // bloco só ("Facebook + Instagram") em vez de repetir a legenda duas vezes.
  const captionEntries: { platforms: string[]; label: string; text: string }[] = [];
  const igText = post.targets.includes("instagram") ? (capMap.instagram ?? "").trim() : "";
  const fbText = post.targets.includes("facebook") ? (capMap.facebook ?? "").trim() : "";
  if (igText && fbText && igText === fbText) {
    captionEntries.push({
      platforms: ["facebook", "instagram"],
      label: "Facebook + Instagram",
      text: igText,
    });
  } else {
    if (fbText) captionEntries.push({ platforms: ["facebook"], label: BRAND.facebook?.label ?? "Facebook", text: fbText });
    if (igText) captionEntries.push({ platforms: ["instagram"], label: BRAND.instagram?.label ?? "Instagram", text: igText });
  }
  const liText = post.targets.includes("linkedin") ? (capMap.linkedin ?? "").trim() : "";
  if (liText) {
    captionEntries.push({ platforms: ["linkedin"], label: BRAND.linkedin?.label ?? "LinkedIn", text: liText });
  }

  const slides = Array.isArray(post.slides)
    ? (post.slides as { text?: string }[]).map((s) => s?.text ?? "").filter(Boolean)
    : [];

  // mídia: carrossel (mediaItems) ou single (mediaUrl)
  const rawItems = Array.isArray(post.mediaItems) ? (post.mediaItems as { url: string; type?: string }[]) : [];
  const mediaList = rawItems.length
    ? rawItems
    : post.mediaUrl
      ? [{ url: post.mediaUrl, type: undefined as string | undefined }]
      : [];
  const isVideo = (it: { url: string; type?: string }) =>
    it.type === "video" || /\.(mp4|mov|webm|m4v)$/i.test(it.url);
  const when = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    dateStyle: "full",
    timeStyle: "short",
  }).format(post.scheduledAt);

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-up">
      <PageHeader
        title={post.theme || "Post"}
        subtitle={`${(post.format ?? "feed").replace(/^\w/, (c) => c.toUpperCase())}${mediaList.length > 1 ? ` · ${mediaList.length} mídias` : ""}`}
        back="/posts"
        action={
          editable && (
            <div className="flex items-center gap-2">
              <Link href={`/posts/${post.id}/edit`} className="btn-ghost">
                <Icon.edit className="w-4 h-4" />
                Editar
              </Link>
              {post.client.tier === "basica" && <GenerateArtButton postId={post.id} />}
              {isDraft && (
                <ApprovePostButton
                  postId={post.id}
                  hasMedia={!!post.mediaUrl || mediaList.length > 0}
                />
              )}
            </div>
          )
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Media preview */}
        <div className="lg:col-span-3">
          <div className="card overflow-hidden">
            {mediaList.length === 0 && post.status === "published" && post.mediaThumb ? (
              <div className="relative aspect-square bg-black/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={post.mediaThumb}
                  alt="Lembrança da publicação"
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-3 left-3 text-[11px] font-medium text-white/90 bg-black/60 backdrop-blur rounded-full px-2.5 py-1">
                  Lembrança — arquivo original removido após 30 dias
                </span>
              </div>
            ) : mediaList.length === 0 && post.status === "published" ? (
              <div className="aspect-square bg-black/40 flex items-center justify-center">
                <div className="text-center text-[var(--color-text-faint)] p-8">
                  <Icon.check className="w-8 h-8 mx-auto mb-2 text-emerald-400/60" />
                  <p className="text-sm">Publicado — arquivo removido após 30 dias</p>
                </div>
              </div>
            ) : mediaList.length === 0 ? (
              <div className="aspect-square bg-black/40 flex items-center justify-center">
                <div className="text-center text-[var(--color-text-faint)] p-8">
                  <Icon.alert className="w-8 h-8 mx-auto mb-2" />
                  <p className="text-sm">Sem mídia definida</p>
                </div>
              </div>
            ) : mediaList.length === 1 ? (
              <div className="aspect-square bg-black/40 flex items-center justify-center">
                {isVideo(mediaList[0]) ? (
                  <video src={mediaList[0].url} controls className="w-full h-full object-contain" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mediaList[0].url} alt={post.theme ?? "Mídia"} className="w-full h-full object-cover" />
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1 bg-black/40 p-1">
                {mediaList.map((it, i) => (
                  <div key={i} className="relative aspect-square">
                    <span className="absolute top-1 left-1 z-10 text-[10px] font-bold bg-black/60 text-white rounded px-1.5 py-0.5">
                      {i + 1}
                    </span>
                    {isVideo(it) ? (
                      <video src={it.url} controls className="w-full h-full object-cover rounded" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.url} alt={`Mídia ${i + 1}`} className="w-full h-full object-cover rounded" />
                    )}
                  </div>
                ))}
              </div>
            )}
            {captionEntries.length > 0 ? (
              <div className="p-5 border-t border-[var(--color-border)] space-y-4">
                {captionEntries.map((e) => (
                  <div key={e.label}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="flex items-center gap-1">
                        {e.platforms.map((p) => (
                          <BrandBadge key={p} platform={p} size={20} />
                        ))}
                      </span>
                      <p className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider">
                        {e.label}
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

          {/* Roteiro por tela (carrossel/reels) */}
          {slides.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[var(--color-border)]">
                <h2 className="font-semibold text-sm">
                  {post.format === "reels" ? "Telas do reels" : "Páginas do carrossel"}
                  <span className="ml-2 text-xs font-normal text-[var(--color-text-faint)]">
                    {slides.length} {slides.length === 1 ? "tela" : "telas"}
                  </span>
                </h2>
              </div>
              <div className="divide-y divide-[var(--color-border)]">
                {slides.map((text, i) => (
                  <div key={i} className="px-5 py-3 flex gap-3">
                    <span className="shrink-0 text-xs font-semibold text-[var(--color-accent)] mt-0.5">
                      Arte {i + 1}
                    </span>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

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
