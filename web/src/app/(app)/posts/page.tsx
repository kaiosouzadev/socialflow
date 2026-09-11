import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import Link from "next/link";
import PostsFilters from "./PostsFilters";
import PostsPagination from "./PostsPagination";
import DeletePostButton from "./DeletePostButton";
import { PageHeader, StatusBadge, PlatformChip, EmptyState } from "@/components/ui";
import { Icon } from "@/components/Icons";
import { dateWindow, isRangeKind, spDateKey, rangeLabel, type RangeKind } from "@/lib/date-range";
import { formatDateTime } from "@/lib/format-date";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{
    clientId?: string;
    status?: string;
    q?: string;
    range?: string;
    ref?: string;
    page?: string;
    scheduleId?: string;
    noted?: string;
  }>;
}) {
  const sp = await searchParams;
  const { clientId, status, scheduleId } = sp;
  const q = sp.q?.trim() ?? "";
  const range: RangeKind = isRangeKind(sp.range) ? sp.range : "all";
  const ref = sp.ref && /^\d{4}-\d{2}-\d{2}$/.test(sp.ref) ? sp.ref : spDateKey();
  const page = Math.max(1, Number(sp.page) || 1);
  // vindo da tela de Aprovações: só os posts que o cliente comentou
  const onlyNoted = sp.noted === "1";

  const win = dateWindow(range, ref);

  const where: Prisma.PostWhereInput = {
    ...(clientId ? { clientId } : {}),
    ...(status ? { status } : {}),
    ...(scheduleId ? { scheduleId } : {}),
    ...(onlyNoted ? { clientNote: { not: null } } : {}),
    ...(win ? { scheduledAt: { gte: win.gte, lt: win.lt } } : {}),
    ...(q ? { client: { is: { name: { contains: q, mode: "insensitive" } } } } : {}),
  };

  const [total, posts, clients] = await Promise.all([
    prisma.post.count({ where }),
    prisma.post.findMany({
      where,
      orderBy: { scheduledAt: range === "all" ? "desc" : "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { client: { select: { name: true } } },
    }),
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // posts that haven't gone out yet can be safely edited/removed
  const deletable = (s: string) => s === "scheduled" || s === "failed" || s === "draft";

  const subtitle =
    `${total} post${total !== 1 ? "s" : ""}` +
    (range !== "all" ? ` · ${rangeLabel(range, ref)}` : "") +
    (onlyNoted ? " · com ajuste pedido pelo cliente" : "") +
    (scheduleId && !onlyNoted ? " · de um cronograma" : "");

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-up">
      <PageHeader
        title="Posts"
        subtitle={subtitle}
        action={
          <Link href="/posts/new" className="btn-primary">
            <Icon.plus className="w-4 h-4" />
            Novo post
          </Link>
        }
      />

      <PostsFilters
        clients={clients}
        currentStatus={status}
        currentClientId={clientId}
        currentRange={range}
        currentRef={ref}
        currentQuery={q}
      />

      {posts.length === 0 ? (
        <EmptyState
          title="Nenhum post encontrado"
          description="Ajuste os filtros ou crie um novo agendamento."
          action={
            <Link href="/posts/new" className="btn-primary">
              <Icon.plus className="w-4 h-4" />
              Novo post
            </Link>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {["Cliente", "Tema", "Redes", "Agendado para", "Status", ""].map((h, i) => (
                  <th
                    key={i}
                    className="text-left px-6 py-3 text-xs font-medium text-[var(--color-text-faint)] uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr
                  key={post.id}
                  className="group border-b border-[var(--color-border)] last:border-0 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-6 py-3.5">
                    <Link
                      href={`/clients/${post.clientId}`}
                      className="font-medium hover:text-[var(--color-accent)] transition-colors"
                    >
                      {post.client.name}
                    </Link>
                  </td>
                  <td className="px-6 py-3.5 max-w-xs">
                    <Link
                      href={`/posts/${post.id}`}
                      className="block truncate text-[var(--color-text-muted)] hover:text-white transition-colors"
                    >
                      {post.theme ?? "—"}
                    </Link>
                    <div className="flex items-center gap-1.5 mt-1">
                      {post.clientNote && (
                        <span
                          title={post.clientNote}
                          className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-200 bg-violet-500/10 border border-violet-500/25 rounded px-1.5 py-0.5"
                        >
                          <Icon.edit className="w-2.5 h-2.5" />
                          ajuste pedido
                        </span>
                      )}
                      {!post.mediaUrl &&
                        !(Array.isArray(post.mediaItems) && post.mediaItems.length > 0) &&
                        post.status !== "published" && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
                            <Icon.alert className="w-2.5 h-2.5" />
                            sem arte
                          </span>
                        )}
                    </div>
                  </td>
                  <td className="px-6 py-3.5">
                    <div className="flex gap-1">
                      {post.targets.map((t) => (
                        <PlatformChip key={t} platform={t} />
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-3.5 text-[var(--color-text-muted)]">
                    {formatDateTime(post.scheduledAt)}
                  </td>
                  <td className="px-6 py-3.5">
                    <StatusBadge status={post.status} />
                  </td>
                  <td className="px-6 py-3.5 text-right w-28">
                    {deletable(post.status) && (
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/posts/${post.id}/edit`}
                          className="p-1.5 rounded-lg text-[var(--color-text-faint)] hover:text-white hover:bg-white/5 transition-colors opacity-0 group-hover:opacity-100"
                          title="Editar"
                        >
                          <Icon.edit className="w-4 h-4" />
                        </Link>
                        <DeletePostButton postId={post.id} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <PostsPagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
        />
      )}
    </div>
  );
}
