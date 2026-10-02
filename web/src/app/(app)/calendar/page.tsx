import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import Link from "next/link";
import { EmptyState, PageHeader, PlatformChip, StatusBadge } from "@/components/ui";
import { buttonClasses } from "@/components/Button";
import { Icon } from "@/components/Icons";
import { clientColor } from "@/lib/client-color";
import { addDaysKey, dateWindow, rangeLabel, shiftRef, spDateKey } from "@/lib/date-range";
import { capitalizeFirst, formatMonthLabel, spDayTime, TZ } from "@/lib/format-date";
import { formatMeta, type PostFormat } from "@/lib/formats";
import { POST_STATUSES } from "@/lib/status-meta";
import CalendarFilters from "./CalendarFilters";

export const dynamic = "force-dynamic";

type View = "month" | "week";
type SearchParams = Promise<{ view?: string; ref?: string; clientId?: string; q?: string; status?: string }>;

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
/** Cards por dia na grade do mês; o resto vai para "+N mais" (lista do dia em /posts). */
const MONTH_CAP = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Cor do formato (lib/formats → tokens format-*, DESIGN a.6). Mapas estáticos para o Tailwind (H-03). */
const FORMAT_STRIPE: Record<PostFormat, string> = {
  feed: "bg-format-feed",
  carrossel: "bg-format-carrossel",
  reels: "bg-format-reels",
  story: "bg-format-story",
};
const FORMAT_TEXT: Record<PostFormat, string> = {
  feed: "text-format-feed-fg",
  carrossel: "text-format-carrossel-fg",
  reels: "text-format-reels-fg",
  story: "text-format-story-fg",
};

/* Mês/Semana: visual do SegmentedControl sm, com links (estado na URL) — igual ao período de /posts. */
const SEGMENT =
  "inline-flex min-h-10 min-w-10 items-center justify-center rounded-chip px-3 text-sm font-medium transition-colors duration-(--sf-dur-fast) focus-visible:outline-offset-1 sm:min-h-7";
const SEGMENT_ON = "bg-selected text-on-selected";
const SEGMENT_OFF = "text-fg-muted hover:bg-hover hover:text-fg";

/** Período pedido na URL, já validado (data inválida → hoje em SP). */
function parsePeriod(sp: { view?: string; ref?: string }): { view: View; ref: string } {
  const view: View = sp.view === "week" ? "week" : "month";
  const valid = !!sp.ref && /^\d{4}-\d{2}-\d{2}$/.test(sp.ref) && addDaysKey(sp.ref, 0) === sp.ref;
  return { view, ref: valid ? sp.ref! : spDateKey() };
}

/** Rótulo do período para o título (h2) e a aba: "Outubro de 2026" ou "27 de set. – 03 de out.". */
function periodTitle(view: View, ref: string): string {
  return view === "month" ? formatMonthLabel(ref.slice(0, 7)) : rangeLabel("week", ref);
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const { view, ref } = parsePeriod(await searchParams);
  return { title: `Calendário · ${periodTitle(view, ref)}` };
}

function weekdayOf(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
}

/** "Quinta-feira, 1 de outubro" (inicial maiúscula sem CSS; A-019). */
function dayLabel(key: string): string {
  return capitalizeFirst(
    new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(
      new Date(`${key}T12:00:00-03:00`)
    )
  );
}

type CalPost = {
  id: string;
  status: string;
  scheduledAt: Date;
  targets: string[];
  theme: string | null;
  format: string;
  clientId: string;
  client: { name: string; brandColor: string | null };
};

/** Um card: o post principal e os stories do mesmo cliente + dia + tema ("+ Story 18:15"; A-029). */
type Group = { primary: CalPost; stories: CalPost[] };

/**
 * Agrupa os posts de UM dia. Cada post que não é story é um card; o story entra no
 * card do primeiro post não-story do mesmo cliente com o mesmo tema. Story sem
 * post principal (ou sem tema) continua sendo um card próprio — nunca some da tela.
 */
function groupDay(posts: CalPost[]): Group[] {
  const themeKey = (p: CalPost) => {
    const t = p.theme?.trim().toLowerCase();
    return t ? `${p.clientId}::${t}` : null;
  };
  const groups: Group[] = [];
  const byTheme = new Map<string, Group>();
  for (const p of posts) {
    if (p.format === "story") continue;
    const g: Group = { primary: p, stories: [] };
    groups.push(g);
    const k = themeKey(p);
    if (k && !byTheme.has(k)) byTheme.set(k, g);
  }
  for (const p of posts) {
    if (p.format !== "story") continue;
    const k = themeKey(p);
    const owner = k ? byTheme.get(k) : undefined;
    if (owner) owner.stories.push(p);
    else groups.push({ primary: p, stories: [] });
  }
  return groups.sort((a, b) => a.primary.scheduledAt.getTime() - b.primary.scheduledAt.getTime());
}

type Density = "month" | "week" | "agenda";

function PostCard({ group, density }: { group: Group; density: Density }) {
  const { primary, stories } = group;
  const fmt = formatMeta(primary.format);
  const theme = primary.theme?.trim() || "Sem tema";
  const withNetworks = density !== "month";
  const failed = primary.status === "failed" || stories.some((s) => s.status === "failed");
  return (
    <div
      data-card=""
      className={`relative rounded-control border bg-surface transition-colors duration-(--sf-dur-fast) hover:border-line-strong ${
        failed ? "border-danger-line" : "border-line"
      }`}
    >
      {/* faixa com a cor do formato (a cor do cliente fica no ponto ao lado do nome) */}
      <span aria-hidden="true" className={`absolute inset-y-1 left-0.5 w-0.75 rounded-full ${FORMAT_STRIPE[fmt.id]}`} />
      <Link
        href={`/posts/${primary.id}`}
        title={primary.theme?.trim() || undefined}
        className={`block rounded-control pl-3 pr-2 hover:bg-hover ${density === "agenda" ? "py-2.5" : "py-1.5"}`}
      >
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            // cor-de-dado: cor fixa do cliente (lib/client-color), só como ponto (DESIGN a.8)
            style={{ backgroundColor: clientColor(primary.clientId, primary.client.brandColor) }}
          />
          <span className={`min-w-0 flex-1 truncate font-semibold text-fg ${density === "agenda" ? "text-sm" : "text-xs"}`}>
            {primary.client.name}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-fg-muted">{spDayTime(primary.scheduledAt).time}</span>
        </span>
        <span className={`mt-0.5 line-clamp-2 leading-snug ${density === "agenda" ? "text-sm" : "text-xs"}`}>
          <span className={`font-semibold ${FORMAT_TEXT[fmt.id]}`}>{fmt.label}</span>
          <span className="text-fg-muted"> · {theme}</span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1">
          <StatusBadge kind="post" status={primary.status} />
          {withNetworks && (
            <span className="flex gap-0.5">
              {primary.targets.map((t) => (
                <PlatformChip key={t} platform={t} decorative={false} />
              ))}
            </span>
          )}
        </span>
      </Link>
      {stories.map((s) => (
        <Link
          key={s.id}
          href={`/posts/${s.id}`}
          className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-control pl-3 pr-2 text-xs text-fg-muted hover:bg-hover hover:text-fg ${
            density === "agenda" ? "min-h-11 py-1 sm:min-h-10" : "min-h-6 py-0.5"
          }`}
        >
          <span>
            + {formatMeta(s.format).label} {spDayTime(s.scheduledAt).time}
            <span className="sr-only">
              {` de ${theme}${s.status !== primary.status ? "," : ""}`}
            </span>
          </span>
          {/* status do story só quando difere do principal (ex.: falhou) — nunca escondido */}
          {s.status !== primary.status && <StatusBadge kind="post" status={s.status} />}
        </Link>
      ))}
    </div>
  );
}

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { view, ref } = parsePeriod(sp);
  const q = sp.q?.trim() ?? "";
  const status = sp.status && (POST_STATUSES as readonly string[]).includes(sp.status) ? sp.status : undefined;

  const clients = await prisma.client.findMany({
    select: { id: true, name: true, agencyPublishes: true },
    orderBy: { name: "asc" },
  });
  // id fora do padrão ou de cliente inexistente é ignorado (antes virava erro do banco)
  const client = sp.clientId && UUID.test(sp.clientId) ? clients.find((c) => c.id === sp.clientId) : undefined;
  const clientId = client?.id;

  // período exato no fuso de SP: o mês (ou a semana) — mesma regra do filtro de período de /posts
  const win = dateWindow(view, ref)!;

  // Busca por tema OU cliente (A-031); com um cliente escolhido no select, só pelo tema.
  const contains = { contains: q, mode: "insensitive" as const };
  const search: Prisma.PostWhereInput | null = !q
    ? null
    : clientId
      ? { theme: contains }
      : { OR: [{ theme: contains }, { client: { is: { name: contains } } }] };
  const base: Prisma.PostWhereInput = {
    scheduledAt: { gte: win.gte, lt: win.lt },
    ...(clientId ? { clientId } : {}),
    ...(search ?? {}),
  };

  const [posts, failedInPeriod] = await Promise.all([
    prisma.post.findMany({
      where: { ...base, ...(status ? { status } : {}) },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
      // só o que o card usa — sem legendas/mídia (pesadas) na grade
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        targets: true,
        theme: true,
        format: true,
        clientId: true,
        client: { select: { name: true, brandColor: true } },
      },
    }),
    // contagem para o atalho "só os que falharam"
    prisma.post.count({ where: { ...base, status: "failed" } }),
  ]);

  const postsByDay = new Map<string, CalPost[]>();
  for (const p of posts) {
    const k = spDateKey(p.scheduledAt);
    postsByDay.set(k, [...(postsByDay.get(k) ?? []), p]);
  }
  const groupsByDay = new Map<string, Group[]>();
  for (const [k, list] of postsByDay) groupsByDay.set(k, groupDay(list));

  // células visíveis: semanas do mês (4 a 6 linhas) ou os 7 dias da semana
  const [ry, rm] = ref.split("-").map(Number);
  const monthPrefix = ref.slice(0, 7);
  let cells: string[];
  if (view === "month") {
    const first = `${monthPrefix}-01`;
    const offset = weekdayOf(first);
    const daysInMonth = new Date(Date.UTC(ry, rm, 0)).getUTCDate();
    const rows = Math.ceil((offset + daysInMonth) / 7);
    cells = Array.from({ length: rows * 7 }, (_, i) => addDaysKey(first, i - offset));
  } else {
    const start = addDaysKey(ref, -weekdayOf(ref));
    cells = Array.from({ length: 7 }, (_, i) => addDaysKey(start, i));
  }
  const today = spDateKey();
  const inPeriod = (key: string) => view === "week" || key.startsWith(monthPrefix);
  const agendaDays = cells.filter((k) => inPeriod(k) && groupsByDay.has(k));

  function href(over: Partial<Record<"view" | "ref" | "clientId" | "q" | "status", string | undefined>>) {
    const merged = { view, ref, clientId, q: q || undefined, status, ...over };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/calendar?${params}`;
  }
  // "+N mais": a lista do dia em /posts, com os mesmos filtros
  function dayListHref(key: string) {
    const params = new URLSearchParams({ range: "day", ref: key });
    if (clientId) params.set("clientId", clientId);
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    return `/posts?${params}`;
  }

  const step =
    view === "month" ? { prev: "Mês anterior", next: "Próximo mês" } : { prev: "Semana anterior", next: "Próxima semana" };
  const title = periodTitle(view, ref);
  // no meio da frase, em minúsculas: "em outubro de 2026" / "na semana de 27 de set. – 03 de out."
  const periodText = view === "month" ? `em ${rangeLabel("month", ref)}` : `na semana de ${rangeLabel("week", ref)}`;

  const newPostLink = (
    <Link
      href={clientId ? `/posts/new?clientId=${clientId}` : "/posts/new"}
      className={buttonClasses({ variant: "primary" })}
    >
      <Icon.plus className="size-4.5 shrink-0" />
      Novo post
    </Link>
  );

  let empty: React.ReactNode = null;
  if (posts.length === 0) {
    if (client && !q && !status) {
      empty = (
        <EmptyState
          headingLevel={3}
          icon={<Icon.calendar />}
          title={`Nenhum post de ${client.name} ${periodText}`}
          description={
            client.agencyPublishes
              ? "Gere o cronograma do mês na página do cliente ou crie um post."
              : "Gere o cronograma do mês na página do cliente ou crie um post. Este cliente é só produção: os posts ficam como rascunho."
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link href={`/clients/${client.id}`} className={buttonClasses({ variant: "secondary" })}>
                Abrir página do cliente
              </Link>
              {newPostLink}
            </div>
          }
        />
      );
    } else if (client || q || status) {
      empty = (
        <EmptyState
          headingLevel={3}
          icon={<Icon.calendar />}
          title="Nenhum post com esses filtros"
          description={
            q
              ? `Nada encontrado para “${q}” ${periodText}. Confira a grafia ou limpe os filtros.`
              : `Nenhum post ${periodText} com esses filtros. Limpe os filtros para ver todos.`
          }
          action={
            <Link href={`/calendar?view=${view}&ref=${ref}`} className={buttonClasses({ variant: "secondary" })}>
              Limpar filtros
            </Link>
          }
        />
      );
    } else {
      empty = (
        <EmptyState
          headingLevel={3}
          icon={<Icon.calendar />}
          title={`Nenhum post ${periodText}`}
          description="Crie um post ou gere o cronograma do mês na página do cliente."
          action={newPostLink}
        />
      );
    }
  }

  return (
    <div className="page page--wide animate-fade-up">
      <PageHeader
        title="Calendário"
        subtitle={view === "month" ? "Posts do mês: rascunhos e agendados" : "Posts da semana: rascunhos e agendados"}
        badges={client && !client.agencyPublishes ? <StatusBadge kind="agencyPublishes" status="nao" /> : undefined}
        action={newPostLink}
      />

      <CalendarFilters
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        view={view}
        refKey={ref}
        currentClientId={clientId}
        currentQuery={q}
        currentStatus={status}
      />

      {/* Navegação do período + atalho de falhas + Mês/Semana */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={href({ ref: shiftRef(view, ref, -1) })}
            aria-label={step.prev}
            title={step.prev}
            className={buttonClasses({ variant: "secondary", size: "sm", iconOnly: true })}
          >
            <Icon.chevronLeft className="size-4" />
          </Link>
          <Link
            href={href({ ref: shiftRef(view, ref, 1) })}
            aria-label={step.next}
            title={step.next}
            className={buttonClasses({ variant: "secondary", size: "sm", iconOnly: true })}
          >
            <Icon.chevronRight className="size-4" />
          </Link>
          <Link href={href({ ref: today })} className={buttonClasses({ variant: "secondary", size: "sm" })}>
            Hoje
          </Link>
          <h2 aria-live="polite" className="ml-1 font-display text-lg font-semibold text-fg">
            {title}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(failedInPeriod > 0 || status === "failed") &&
            (status === "failed" ? (
              <Link
                href={href({ status: undefined })}
                aria-current="true"
                title="Mostrar todos os posts"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-control border border-danger-solid bg-danger-solid px-3 text-sm font-medium text-on-danger transition-colors duration-(--sf-dur-fast) hover:bg-danger-hover sm:min-h-8"
              >
                <Icon.alert className="size-4 shrink-0" />
                Só falhas ({failedInPeriod})
                <Icon.x className="size-4 shrink-0" />
              </Link>
            ) : (
              <Link
                href={href({ status: "failed" })}
                title="Mostrar só os posts que falharam"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-control border border-danger-line bg-danger-bg px-3 text-sm font-medium text-danger-fg transition-colors duration-(--sf-dur-fast) hover:border-danger-solid sm:min-h-8"
              >
                <Icon.alert className="size-4 shrink-0" />
                {failedInPeriod} {failedInPeriod === 1 ? "falhou" : "falharam"}
              </Link>
            ))}

          <div
            role="group"
            aria-label="Visualização"
            className="inline-flex gap-0.5 rounded-control border border-line-strong bg-surface p-0.5"
          >
            {(
              [
                { value: "month", label: "Mês" },
                { value: "week", label: "Semana" },
              ] as const
            ).map((v) => (
              <Link
                key={v.value}
                href={href({ view: v.value })}
                aria-current={view === v.value ? "true" : undefined}
                className={`${SEGMENT} ${view === v.value ? SEGMENT_ON : SEGMENT_OFF}`}
              >
                {v.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {empty ?? (
        <>
          {/* ≥ xl: grade de 7 colunas (largura total da página — pedido do usuário) */}
          <div className="card hidden overflow-hidden xl:block">
            <div aria-hidden="true" className="grid grid-cols-7 border-b border-line bg-sunken">
              {WEEKDAYS.map((w) => (
                <div
                  key={w}
                  className="px-2 py-2.5 text-center text-xs font-semibold uppercase tracking-overline text-fg-muted"
                >
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((key, i) => {
                const active = inPeriod(key);
                const isToday = key === today;
                const dayGroups = active ? (groupsByDay.get(key) ?? []) : [];
                const shown = view === "month" ? dayGroups.slice(0, MONTH_CAP) : dayGroups;
                const hidden = dayGroups.length - shown.length;
                const lastRow = i >= cells.length - 7;
                const lastCol = i % 7 === 6;
                return (
                  <div
                    key={key}
                    aria-current={isToday && active ? "date" : undefined}
                    className={`min-w-0 border-line p-1.5 ${view === "month" ? "min-h-32" : "min-h-72"} ${
                      lastRow ? "" : "border-b"
                    } ${lastCol ? "" : "border-r"} ${!active ? "bg-sunken" : isToday ? "bg-today" : ""}`}
                  >
                    <div aria-hidden="true" className="mb-1 flex h-6 items-center px-0.5">
                      <span
                        className={`text-xs font-semibold tabular-nums ${
                          !active
                            ? "text-fg-faint"
                            : isToday
                              ? "rounded-chip bg-brand px-1.5 py-0.5 text-on-brand"
                              : "text-fg-muted"
                        }`}
                      >
                        {Number(key.slice(8))}
                      </span>
                    </div>
                    {dayGroups.length > 0 && (
                      <>
                        <h3 className="sr-only">
                          {dayLabel(key)}
                          {isToday ? " (hoje)" : ""}
                        </h3>
                        <ul className="grid grid-cols-1 gap-1">
                          {shown.map((g) => (
                            <li key={g.primary.id} className="min-w-0">
                              <PostCard group={g} density={view} />
                            </li>
                          ))}
                        </ul>
                        {hidden > 0 && (
                          <Link
                            href={dayListHref(key)}
                            className="mt-0.5 inline-flex min-h-6 items-center rounded-control px-1 text-xs font-medium text-link hover:text-link-hover hover:underline"
                          >
                            +{hidden} mais
                            <span className="sr-only"> em {dayLabel(key)}</span>
                          </Link>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* < xl: agenda (só os dias com posts), sem rolagem horizontal (A-001) */}
          <ol className="grid grid-cols-1 gap-3 xl:hidden">
            {agendaDays.map((key) => {
              const isToday = key === today;
              return (
                <li key={key} aria-current={isToday ? "date" : undefined} className="card min-w-0 p-3 sm:p-4">
                  <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                    {dayLabel(key)}
                    {isToday && (
                      <span className="rounded-chip bg-brand px-1.5 py-0.5 text-xs font-semibold text-on-brand">Hoje</span>
                    )}
                  </h3>
                  <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(groupsByDay.get(key) ?? []).map((g) => (
                      <li key={g.primary.id} className="min-w-0">
                        <PostCard group={g} density="agenda" />
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
