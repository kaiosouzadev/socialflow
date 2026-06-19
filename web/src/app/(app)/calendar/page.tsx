import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import Link from "next/link";
import { PageHeader, PlatformChip } from "@/components/ui";
import { Icon } from "@/components/Icons";
import CalendarFilters from "./CalendarFilters";

export const dynamic = "force-dynamic";

const TZ = "America/Sao_Paulo";
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const statusDot: Record<string, string> = {
  draft: "bg-violet-400",
  scheduled: "bg-sky-400",
  publishing: "bg-amber-400",
  published: "bg-emerald-400",
  failed: "bg-red-400",
};

// civil date helpers (UTC arithmetic = no DST surprises)
function pad(n: number) {
  return String(n).padStart(2, "0");
}
function keyOf(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}
function spDateKey(date: Date) {
  // YYYY-MM-DD as seen in São Paulo
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
function todaySpKey() {
  return spDateKey(new Date());
}
function addDaysKey(key: string, days: number) {
  const [y, m, d] = key.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  const dt = new Date(t);
  return keyOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
function weekdayOf(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; ref?: string; clientId?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === "week" ? "week" : "month";
  const ref = sp.ref && /^\d{4}-\d{2}-\d{2}$/.test(sp.ref) ? sp.ref : todaySpKey();
  const clientId = sp.clientId;
  const q = sp.q?.trim() ?? "";
  const [ry, rm] = ref.split("-").map(Number);

  // build the visible cells
  let cells: string[] = [];
  if (view === "month") {
    const first = keyOf(ry, rm, 1);
    const start = addDaysKey(first, -weekdayOf(first));
    cells = Array.from({ length: 42 }, (_, i) => addDaysKey(start, i));
  } else {
    const start = addDaysKey(ref, -weekdayOf(ref));
    cells = Array.from({ length: 7 }, (_, i) => addDaysKey(start, i));
  }

  // query window (generous; precise bucketing happens by SP date key)
  const winStart = new Date(addDaysKey(cells[0], -1) + "T00:00:00Z");
  const winEnd = new Date(addDaysKey(cells[cells.length - 1], 2) + "T00:00:00Z");

  const where: Prisma.PostWhereInput = {
    scheduledAt: { gte: winStart, lt: winEnd },
    ...(clientId ? { clientId } : {}),
    ...(q ? { client: { is: { name: { contains: q, mode: "insensitive" } } } } : {}),
  };

  const [posts, clients] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy: { scheduledAt: "asc" },
      include: { client: { select: { name: true } } },
    }),
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const byDay = new Map<string, typeof posts>();
  for (const p of posts) {
    const k = spDateKey(p.scheduledAt);
    const arr = byDay.get(k) ?? [];
    arr.push(p);
    byDay.set(k, arr);
  }

  const today = todaySpKey();

  // navigation refs
  const prevRef = view === "month" ? keyOf(rm === 1 ? ry - 1 : ry, rm === 1 ? 12 : rm - 1, 1) : addDaysKey(ref, -7);
  const nextRef = view === "month" ? keyOf(rm === 12 ? ry + 1 : ry, rm === 12 ? 1 : rm + 1, 1) : addDaysKey(ref, 7);

  const title =
    view === "month"
      ? new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, month: "long", year: "numeric" }).format(
          new Date(Date.UTC(ry, rm - 1, 15))
        )
      : (() => {
          const start = addDaysKey(ref, -weekdayOf(ref));
          const end = addDaysKey(start, 6);
          const f = (k: string) =>
            new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" }).format(
              new Date(k + "T12:00:00Z")
            );
          return `${f(start)} – ${f(end)}`;
        })();

  function navHref(v: string, r: string) {
    const params = new URLSearchParams({ view: v, ref: r });
    if (clientId) params.set("clientId", clientId);
    if (q) params.set("q", q);
    return `/calendar?${params}`;
  }

  // link to the day's posts list (used by the "+N mais" overflow indicator)
  function dayListHref(key: string) {
    const params = new URLSearchParams({ range: "day", ref: key });
    if (clientId) params.set("clientId", clientId);
    if (q) params.set("q", q);
    return `/posts?${params}`;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-up">
      <PageHeader
        title="Calendário"
        subtitle="Posts agendados"
        action={
          <Link href="/posts/new" className="btn-primary">
            <Icon.plus className="w-4 h-4" />
            Novo post
          </Link>
        }
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Link
            href={navHref(view, prevRef)}
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-white hover:border-[var(--color-border-strong)] transition-colors"
          >
            <Icon.chevronLeft className="w-4 h-4" />
          </Link>
          <Link
            href={navHref(view, nextRef)}
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-white hover:border-[var(--color-border-strong)] transition-colors"
          >
            <Icon.chevronRight className="w-4 h-4" />
          </Link>
          <Link href={navHref(view, today)} className="btn-ghost !py-2 ml-1">
            Hoje
          </Link>
          <span className="ml-3 text-lg font-semibold capitalize">{title}</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <CalendarFilters
            clients={clients}
            view={view}
            refKey={ref}
            currentClientId={clientId}
            currentQuery={q}
          />

          <div className="flex items-center rounded-lg border border-[var(--color-border)] overflow-hidden text-sm">
            <Link
              href={navHref("month", ref)}
              className={`px-3.5 py-1.5 font-medium transition-colors ${
                view === "month" ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-text-muted)] hover:text-white"
              }`}
            >
              Mês
            </Link>
            <Link
              href={navHref("week", ref)}
              className={`px-3.5 py-1.5 font-medium transition-colors ${
                view === "week" ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-text-muted)] hover:text-white"
              }`}
            >
              Semana
            </Link>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-[var(--color-border)]">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              className="px-3 py-2.5 text-xs font-medium text-[var(--color-text-faint)] uppercase tracking-wider text-center"
            >
              {w}
            </div>
          ))}
        </div>

        <div className={`grid grid-cols-7 ${view === "month" ? "grid-rows-6" : ""}`}>
          {cells.map((key) => {
            const [, mm, dd] = key.split("-").map(Number);
            const inMonth = view === "week" || mm === rm;
            const isToday = key === today;
            const dayPosts = byDay.get(key) ?? [];

            return (
              <div
                key={key}
                className={`relative border-b border-r border-[var(--color-border)] p-2 ${
                  view === "month" ? "min-h-[7rem]" : "min-h-[18rem]"
                } ${inMonth ? "" : "opacity-40"}`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className={`inline-flex items-center justify-center text-xs font-medium ${
                      isToday
                        ? "w-6 h-6 rounded-full text-white"
                        : "text-[var(--color-text-muted)]"
                    }`}
                    style={
                      isToday ? { background: "linear-gradient(135deg,#8b6dff,#a855f7)" } : undefined
                    }
                  >
                    {dd}
                  </span>
                </div>

                {/* Month: cap at 3 + "+N mais" link to the day list.
                    Week: taller cell, scroll internally when busy. */}
                <div
                  className={`space-y-1 ${
                    view === "week" ? "max-h-[14rem] overflow-y-auto pr-0.5" : ""
                  }`}
                >
                  {(view === "month" ? dayPosts.slice(0, 3) : dayPosts).map((p) => (
                    <Link
                      key={p.id}
                      href={`/posts/${p.id}`}
                      className="block rounded-md px-1.5 py-1 bg-white/[0.04] hover:bg-white/[0.08] border border-[var(--color-border)] transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot[p.status] ?? "bg-zinc-400"}`} />
                        <span className="text-[11px] font-medium truncate flex-1">
                          {p.client.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5 pl-2.5">
                        <span className="text-[10px] text-[var(--color-text-faint)]">
                          {new Intl.DateTimeFormat("pt-BR", {
                            timeZone: TZ,
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(p.scheduledAt)}
                        </span>
                        <div className="flex gap-0.5">
                          {p.targets.map((t) => (
                            <PlatformChip key={t} platform={t} />
                          ))}
                        </div>
                      </div>
                    </Link>
                  ))}
                  {view === "month" && dayPosts.length > 3 && (
                    <Link
                      href={dayListHref(key)}
                      className="block text-[10px] font-medium text-[var(--color-accent)] hover:underline pl-1 pt-0.5"
                    >
                      +{dayPosts.length - 3} mais
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
