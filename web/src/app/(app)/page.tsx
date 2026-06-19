import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { PageHeader, StatusBadge, PlatformChip, EmptyState } from "@/components/ui";
import { Icon } from "@/components/Icons";
import { formatDateTime } from "@/lib/format-date";

export const dynamic = "force-dynamic";

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
  const [stats, posts] = await Promise.all([
    getStats(),
    prisma.post.findMany({
      take: 8,
      orderBy: { scheduledAt: "desc" },
      include: { client: { select: { name: true } } },
    }),
  ]);

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
