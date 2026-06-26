import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { PageHeader, StatusBadge, PlatformChip } from "@/components/ui";
import { Icon } from "@/components/Icons";
import { formatDateTime } from "@/lib/format-date";
import { getCachedSummary, getTodayPosts } from "@/lib/daily-summary";
import DailySummaryCard from "./DailySummaryCard";

export const dynamic = "force-dynamic";

const TZ = "America/Sao_Paulo";
const fmtHora = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);

async function getStats() {
  const [clients, postsScheduled, postsPublished, postsFailed, expiringTokens] =
    await Promise.all([
      prisma.client.count(),
      prisma.post.count({ where: { status: "scheduled" } }),
      prisma.post.count({ where: { status: "published" } }),
      prisma.post.count({ where: { status: "failed" } }),
      prisma.socialAccount.count({
        where: {
          status: "active",
          tokenExpiresAt: { lt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

  return { clients, postsScheduled, postsPublished, postsFailed, expiringTokens };
}

function StatCard({
  label,
  value,
  href,
  icon,
  accent,
}: {
  label: string;
  value: number;
  href: string;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <Link href={href} className="card glass-hover p-5 group relative overflow-hidden">
      {/* accent glow */}
      <div
        className="absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-20 group-hover:opacity-40 transition-opacity blur-2xl pointer-events-none"
        style={{ background: accent }}
      />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-sm text-[var(--color-text-muted)]">{label}</p>
          <p className="text-4xl font-semibold mt-2 tracking-tight tabular-nums">{value}</p>
        </div>
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: `${accent}1f`,
            border: `1px solid ${accent}40`,
            color: accent,
            boxShadow: `0 6px 18px -8px ${accent}80`,
          }}
        >
          {icon}
        </div>
      </div>
    </Link>
  );
}

export default async function DashboardPage() {
  const [stats, posts, summary, todayPosts] = await Promise.all([
    getStats(),
    prisma.post.findMany({
      take: 8,
      orderBy: { scheduledAt: "desc" },
      include: { client: { select: { name: true } } },
    }),
    getCachedSummary(),
    getTodayPosts(),
  ]);

  const todayPending = todayPosts.filter(
    (p) => p.status === "scheduled" || p.status === "draft"
  ).length;

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-up">
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral da automação"
        action={
          <Link href="/posts/new" className="btn-primary">
            <Icon.plus className="w-4 h-4" />
            Novo post
          </Link>
        }
      />

      <DailySummaryCard
        content={summary?.content ?? null}
        generatedAt={summary ? formatDateTime(summary.updatedAt) : null}
        postCount={summary?.postCount ?? todayPosts.length}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Clientes"
          value={stats.clients}
          href="/clients"
          accent="#7c5cff"
          icon={<Icon.users className="w-5 h-5" />}
        />
        <StatCard
          label="Agendados"
          value={stats.postsScheduled}
          href="/posts?status=scheduled"
          accent="#38bdf8"
          icon={<Icon.clock className="w-5 h-5" />}
        />
        <StatCard
          label="Publicados"
          value={stats.postsPublished}
          href="/posts?status=published"
          accent="#34d399"
          icon={<Icon.check className="w-5 h-5" />}
        />
        <StatCard
          label="Falharam"
          value={stats.postsFailed}
          href="/posts?status=failed"
          accent="#f87171"
          icon={<Icon.alert className="w-5 h-5" />}
        />
      </div>

      {stats.expiringTokens > 0 && (
        <div className="mb-6 flex items-center gap-3 rounded-xl px-4 py-3 bg-amber-500/[0.07] border border-amber-500/20">
          <Icon.alert className="w-5 h-5 text-amber-400 shrink-0" />
          <p className="text-sm text-amber-200/90">
            <span className="font-semibold">{stats.expiringTokens}</span>{" "}
            {stats.expiringTokens === 1 ? "conta com token expirando" : "contas com tokens expirando"}{" "}
            em menos de 7 dias. O WF-02 renova automaticamente a cada 12h.
          </p>
        </div>
      )}

      <div className="card overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <h2 className="font-semibold">
            Hoje{" "}
            <span className="text-[var(--color-text-faint)] font-normal text-sm">
              · {todayPosts.length} {todayPosts.length === 1 ? "post" : "posts"}
              {todayPending > 0 && `, ${todayPending} pendente${todayPending === 1 ? "" : "s"}`}
            </span>
          </h2>
          <Link href="/calendar" className="text-sm text-[var(--color-accent)] hover:underline">
            Ver calendário
          </Link>
        </div>

        {todayPosts.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[var(--color-text-muted)]">
            Nada agendado para hoje.
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {todayPosts.map((p) => (
              <div key={p.id} className="flex items-center gap-4 px-6 py-3.5">
                <div className="w-14 shrink-0 text-sm font-medium tabular-nums text-[var(--color-text-muted)]">
                  {fmtHora(p.scheduledAt)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {p.clientName}
                    <span className="text-[var(--color-text-faint)] font-normal">
                      {" "}· {p.theme ?? "sem tema"}
                    </span>
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex gap-1">
                      {p.targets.map((t) => (
                        <PlatformChip key={t} platform={t} />
                      ))}
                    </div>
                    {!p.hasMedia && (
                      <span className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
                        sem mídia
                      </span>
                    )}
                    {!p.hasCaption && (
                      <span className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
                        sem legenda
                      </span>
                    )}
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <h2 className="font-semibold">Posts recentes</h2>
          <Link href="/posts" className="text-sm text-[var(--color-accent)] hover:underline">
            Ver todos
          </Link>
        </div>

        {posts.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[var(--color-text-muted)]">
            Nenhum post ainda.{" "}
            <Link href="/posts/new" className="text-[var(--color-accent)] hover:underline">
              Criar o primeiro
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {["Cliente", "Tema", "Redes", "Agendado para", "Status"].map((h) => (
                  <th
                    key={h}
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
                  className="border-b border-[var(--color-border)] last:border-0 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-6 py-3.5 font-medium">{post.client.name}</td>
                  <td className="px-6 py-3.5 text-[var(--color-text-muted)] max-w-xs truncate">
                    {post.theme ?? "—"}
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
