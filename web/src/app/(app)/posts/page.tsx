import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import Link from "next/link";
import PostsFilters from "./PostsFilters";
import PostsPagination from "./PostsPagination";
import DeletePostButton from "./DeletePostButton";
import PostsSelection, { RowCheckbox, SelectPageCheckbox } from "./PostsSelection";
import { PageHeader, StatusBadge, PlatformChip, EmptyState, ToneBadge } from "@/components/ui";
import { buttonClasses } from "@/components/Button";
import { Icon } from "@/components/Icons";
import { dateWindow, isRangeKind, spDateKey, rangeLabel, type RangeKind } from "@/lib/date-range";
import { formatDateTime } from "@/lib/format-date";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Posts" };

const PAGE_SIZE = 25;

/** Máximo da seleção "todos deste filtro" (o mesmo limite do POST /api/posts/bulk-delete). */
const BULK_LIMIT = 500;

/** Link solto (fora de frase) com alvo ≥ 40 px (DESIGN, A11y "Alvos"). */
const LOOSE_LINK = "inline-flex min-h-11 items-center sm:min-h-10";

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
  let page = Math.max(1, Number(sp.page) || 1);
  // vindo da tela de Aprovações: só os posts que o cliente comentou
  const onlyNoted = sp.noted === "1";

  const win = dateWindow(range, ref);

  // Busca por tema OU cliente (A-031). Com um cliente já escolhido no select, o nome do
  // cliente casaria todos os posts dele: aí a busca é só pelo tema.
  const contains = { contains: q, mode: "insensitive" as const };
  const search: Prisma.PostWhereInput | null = !q
    ? null
    : clientId
      ? { theme: contains }
      : { OR: [{ theme: contains }, { client: { is: { name: contains } } }] };

  const where: Prisma.PostWhereInput = {
    ...(clientId ? { clientId } : {}),
    ...(status ? { status } : {}),
    ...(scheduleId ? { scheduleId } : {}),
    ...(onlyNoted ? { clientNote: { not: null } } : {}),
    ...(win ? { scheduledAt: { gte: win.gte, lt: win.lt } } : {}),
    ...(search ?? {}),
  };

  const orderBy = { scheduledAt: range === "all" ? "desc" : "asc" } as const;
  const findPage = (p: number) =>
    prisma.post.findMany({
      where,
      orderBy,
      skip: (p - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { client: { select: { name: true } } },
    });

  const [total, firstPosts, clients, filterItems] = await Promise.all([
    prisma.post.count({ where }),
    findPage(page),
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // seleção "todos os M deste filtro" (P5-B): consulta leve, só id e status, no máximo 500
    prisma.post.findMany({ where, orderBy, take: BULK_LIMIT, select: { id: true, status: true } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Página além da última (ex.: depois de excluir todos os posts da última página): mostra a
  // última em vez de "Nenhum post com esses filtros".
  let posts = firstPosts;
  if (posts.length === 0 && total > 0 && page > totalPages) {
    page = totalPages;
    posts = await findPage(page);
  }

  // A seleção zera ao trocar filtro ou página: a key nova remonta o PostsSelection.
  const selectionKey = JSON.stringify([clientId, status, q, range, range !== "all" ? ref : "", sp.page, scheduleId, onlyNoted]);

  // posts that haven't gone out yet can be safely edited/removed
  const deletable = (s: string) => s === "scheduled" || s === "failed" || s === "draft";

  const hasFilters = !!(clientId || status || q || scheduleId || onlyNoted || range !== "all");

  const subtitle =
    `${total} post${total !== 1 ? "s" : ""}` +
    (range !== "all" ? ` · ${rangeLabel(range, ref)}` : "") +
    (onlyNoted ? " · com ajuste pedido pelo cliente" : "") +
    (scheduleId && !onlyNoted ? " · de um cronograma" : "");

  const newPostLink = (
    <Link href="/posts/new" className={buttonClasses({ variant: "primary" })}>
      <Icon.plus className="size-4.5 shrink-0" />
      Novo post
    </Link>
  );

  const rows = posts.map((post) => {
    const label = post.theme?.trim() || `post de ${post.client.name} em ${formatDateTime(post.scheduledAt)}`;
    const hasMedia = !!post.mediaUrl || (Array.isArray(post.mediaItems) && post.mediaItems.length > 0);
    const flags = (
      <>
        {post.clientNote && (
          <ToneBadge tone="accent" icon={<Icon.edit />} title={post.clientNote}>
            Ajuste pedido
          </ToneBadge>
        )}
        {!hasMedia && post.status !== "published" && (
          <ToneBadge tone="warning" icon={<Icon.alert />}>
            Sem arte
          </ToneBadge>
        )}
      </>
    );
    return { post, label, flags, hasFlags: !!post.clientNote || (!hasMedia && post.status !== "published") };
  });

  return (
    <div className="page animate-fade-up">
      <PageHeader title="Posts" subtitle={subtitle} action={newPostLink} />

      <PostsFilters
        clients={clients}
        currentStatus={status}
        currentClientId={clientId}
        currentRange={range}
        currentRef={ref}
        currentQuery={q}
      />

      {/* Sempre montado (também no estado vazio): o Toast da exclusão em massa sobrevive ao refresh
          que esvazia a lista. */}
      <PostsSelection
        key={selectionKey}
        pageItems={posts.map((p) => ({ id: p.id, status: p.status }))}
        filterItems={filterItems}
        total={total}
      >
        {posts.length === 0 ? (
          hasFilters ? (
            <EmptyState
              headingLevel={2}
              title="Nenhum post com esses filtros"
              description={q ? `Nada encontrado para “${q}”. Confira a grafia ou limpe os filtros.` : "Mude os filtros ou limpe todos para ver a lista completa."}
              action={
                <Link href="/posts" className={buttonClasses({ variant: "ghost" })}>
                  Limpar filtros
                </Link>
              }
            />
          ) : (
            <EmptyState
              headingLevel={2}
              title="Nenhum post ainda"
              description="Crie um post aqui ou gere o cronograma do mês na página do cliente."
              action={newPostLink}
            />
          )
        ) : (
          <>
            {/* < lg: "Selecionar todos desta página" com texto, acima dos cartões */}
            <div className="mb-2 lg:hidden">
              <SelectPageCheckbox withLabel />
            </div>

            {/* ≥ lg: tabela */}
            <div className="card hidden overflow-hidden lg:block">
              <table className="w-full text-sm">
                <thead className="bg-sunken">
                  <tr>
                    <th scope="col" className="w-12 py-1 pl-2">
                      <SelectPageCheckbox />
                    </th>
                    {["Cliente", "Tema", "Redes", "Data", "Status"].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-overline text-fg-muted"
                      >
                        {h}
                      </th>
                    ))}
                    <th scope="col" className="w-28 px-4 py-3">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ post, label, flags, hasFlags }) => (
                    <tr
                      key={post.id}
                      className="group border-t border-line transition-colors duration-(--sf-dur-fast) hover:bg-hover has-checked:bg-brand-bg"
                    >
                      <td className="py-1 pl-2 align-middle">
                        <RowCheckbox id={post.id} label={label} />
                      </td>
                      <td className="px-4 py-2 align-middle">
                        <Link
                          href={`/clients/${post.clientId}`}
                          className={`${LOOSE_LINK} min-w-11 font-medium text-fg hover:text-link sm:min-w-10`}
                        >
                          {post.client.name}
                        </Link>
                      </td>
                      <td className="max-w-xs px-4 py-2 align-middle">
                        <Link
                          href={`/posts/${post.id}`}
                          title={post.theme ?? undefined}
                          className={`${LOOSE_LINK} text-fg-muted hover:text-fg`}
                        >
                          <span className="line-clamp-2">{post.theme?.trim() || "Sem título"}</span>
                        </Link>
                        {hasFlags && <div className="mb-1 flex flex-wrap items-center gap-1.5">{flags}</div>}
                      </td>
                      <td className="px-4 py-2 align-middle">
                        <div className="flex gap-1">
                          {post.targets.map((t) => (
                            <PlatformChip key={t} platform={t} decorative={false} />
                          ))}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 align-middle tabular-nums text-fg-muted">
                        {formatDateTime(post.scheduledAt)}
                      </td>
                      <td className="px-4 py-2 align-middle">
                        <StatusBadge kind="post" status={post.status} />
                      </td>
                      <td className="px-4 py-2 text-right align-middle">
                        {deletable(post.status) && (
                          <div className="flex items-center justify-end gap-1">
                            <Link
                              href={`/posts/${post.id}/edit`}
                              aria-label={`Editar post: ${label}`}
                              title="Editar post"
                              className={`${buttonClasses({ variant: "ghost", size: "sm", iconOnly: true })} opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100`}
                            >
                              <Icon.edit className="size-4" />
                            </Link>
                            <DeletePostButton postId={post.id} postLabel={label} status={post.status} />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* < lg: cartões */}
            <ul className="grid gap-3 lg:hidden">
              {rows.map(({ post, label, flags, hasFlags }) => (
                <li key={post.id} className="card grid gap-2 p-4 has-checked:border-brand-line has-checked:bg-brand-bg">
                  <div className="flex items-center gap-1">
                    {/* -ml-3: a caixa alinha com o texto do cartão; o alvo de 44 px avança no padding */}
                    <RowCheckbox id={post.id} label={label} className="-ml-3" />
                    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <Link
                        href={`/clients/${post.clientId}`}
                        className={`${LOOSE_LINK} min-w-11 text-sm font-medium text-fg-muted hover:text-link sm:min-w-10`}
                      >
                        <span className="min-w-0 truncate">{post.client.name}</span>
                      </Link>
                      <StatusBadge kind="post" status={post.status} />
                    </div>
                  </div>
                  <Link
                    href={`/posts/${post.id}`}
                    title={post.theme ?? undefined}
                    className={`${LOOSE_LINK} text-base font-semibold text-fg hover:text-link`}
                  >
                    <span className="line-clamp-2 wrap-break-word">{post.theme?.trim() || "Sem título"}</span>
                  </Link>
                  {hasFlags && <div className="flex flex-wrap items-center gap-1.5">{flags}</div>}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-fg-muted">
                    <span className="tabular-nums">{formatDateTime(post.scheduledAt)}</span>
                    <span className="flex gap-1">
                      {post.targets.map((t) => (
                        <PlatformChip key={t} platform={t} decorative={false} />
                      ))}
                    </span>
                  </div>
                  {deletable(post.status) && (
                    <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                      <Link
                        href={`/posts/${post.id}/edit`}
                        aria-label={`Editar post: ${label}`}
                        className={buttonClasses({ variant: "secondary", size: "sm" })}
                      >
                        <Icon.edit className="size-4 shrink-0" />
                        Editar
                      </Link>
                      <DeletePostButton postId={post.id} postLabel={label} status={post.status} variant="text" />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </PostsSelection>

      {totalPages > 1 && (
        <PostsPagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} />
      )}
    </div>
  );
}
