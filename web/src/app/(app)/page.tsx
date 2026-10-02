import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { PageHeader, StatusBadge, PlatformChip, EmptyState, ToneBadge } from "@/components/ui";
import { buttonClasses } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { Icon } from "@/components/Icons";
import { formatDateTime } from "@/lib/format-date";
import { getCachedSummary, getTodayPosts, type TodayPost } from "@/lib/daily-summary";
import { getQueueHealth, STUCK_MINUTES } from "@/lib/queue-health";
import { QUEUEABLE_CLIENT } from "@/lib/publish-guard";
import type { Tone } from "@/lib/status-meta";
import DailySummaryCard from "./DailySummaryCard";
import QueueHealthCard from "./QueueHealthCard";
import RetryPostButton from "./RetryPostButton";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Dashboard" };

const TZ = "America/Sao_Paulo";
const fmtHora = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);
/** "02/10 às 14:30" (datas curtas, DESIGN "Conteúdo"). */
const fmtDiaHora = (d: Date) => {
  const dia = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(d);
  return `${dia} às ${fmtHora(d)}`;
};

/** Link solto (fora de frase) com alvo ≥ 40 px (DESIGN, A11y "Alvos"). */
const LOOSE_LINK = "inline-flex min-h-11 items-center text-sm font-medium text-link hover:text-link-hover hover:underline sm:min-h-10";

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

/**
 * Quantos posts as ações em massa realmente recolocam na fila: o servidor pula
 * os clientes só produção (S13), então o resumo do ConfirmDialog os desconta.
 */
async function getRequeueable() {
  const stuckBefore = new Date(Date.now() - STUCK_MINUTES * 60_000);
  const [stuck, failed] = await Promise.all([
    prisma.post.count({
      where: { status: "publishing", scheduledAt: { lt: stuckBefore }, client: QUEUEABLE_CLIENT },
    }),
    prisma.post.count({ where: { status: "failed", client: QUEUEABLE_CLIENT } }),
  ]);
  return { stuck, failed };
}

/**
 * Posts de hoje que mostram "Reenviar": com falha ou presos em publicação (mesmo
 * limite do WF-03) e de cliente que publica — o critério do detalhe do post (S25).
 * Publicando há menos de 20 min fica de fora: ainda pode estar saindo agora.
 */
async function getRetryableToday(todayPosts: TodayPost[]): Promise<Set<string>> {
  const stuckBefore = Date.now() - STUCK_MINUTES * 60_000;
  const candidates = todayPosts
    .filter((p) => p.status === "failed" || (p.status === "publishing" && p.scheduledAt.getTime() < stuckBefore))
    .map((p) => p.id);
  if (candidates.length === 0) return new Set();
  const rows = await prisma.post.findMany({
    where: { id: { in: candidates }, client: QUEUEABLE_CLIENT },
    select: { id: true },
  });
  return new Set(rows.map((p) => p.id));
}

/* Mapa estático de classes (H-03): tom → ícone do KPI. */
const KPI_ICON: Record<Extract<Tone, "accent" | "info" | "success" | "danger">, string> = {
  accent: "bg-brand-bg text-brand-solid",
  info: "bg-info-bg text-info-solid",
  success: "bg-success-bg text-success-solid",
  danger: "bg-danger-bg text-danger-solid",
};

function StatCard({
  label,
  value,
  href,
  icon,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  icon: React.ReactNode;
  tone: keyof typeof KPI_ICON;
}) {
  return (
    <Link href={href} className="card glass-hover flex items-start justify-between gap-3 p-4 sm:p-5">
      <span className="min-w-0">
        <span className="block text-sm text-fg-muted">{label}</span>
        <span className="mt-2 block font-display text-3xl font-semibold tracking-display tabular-nums text-fg">
          {value}
        </span>
      </span>
      <span aria-hidden="true" className={`grid size-11 shrink-0 place-items-center rounded-control ${KPI_ICON[tone]}`}>
        {icon}
      </span>
    </Link>
  );
}

function getRecentAlerts() {
  return prisma.alert.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) } },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
}

const ALERT_KIND: Record<string, { label: string; tone: Tone }> = {
  prazo_cronograma: { label: "Prazo", tone: "warning" },
  ajuste_solicitado: { label: "Ajuste", tone: "danger" },
  ajuste_resolvido: { label: "Ajuste resolvido", tone: "success" },
  cronograma_auto_aprovado: { label: "Auto-aprovado", tone: "success" },
  cronograma_aprovado: { label: "Aprovado", tone: "success" },
  sem_resposta: { label: "Sem resposta", tone: "warning" },
  sem_arte: { label: "Sem arte", tone: "warning" },
  semanal_enviado: { label: "Semanal", tone: "success" },
};
const UNKNOWN_ALERT = { label: "Aviso", tone: "neutral" as Tone };

export default async function DashboardPage() {
  const [stats, posts, summary, todayPosts, queue, requeueable, alerts] = await Promise.all([
    getStats(),
    prisma.post.findMany({
      take: 8,
      orderBy: { scheduledAt: "desc" },
      include: { client: { select: { name: true } } },
    }),
    getCachedSummary(),
    getTodayPosts(),
    getQueueHealth(),
    getRequeueable(),
    getRecentAlerts(),
  ]);

  const todayPending = todayPosts.filter(
    (p) => p.status === "scheduled" || p.status === "draft"
  ).length;

  const retryable = await getRetryableToday(todayPosts);

  const newPostLink = (
    <Link href="/posts/new" className={buttonClasses({ variant: "primary" })}>
      <Icon.plus className="size-4.5 shrink-0" />
      Novo post
    </Link>
  );

  return (
    <div className="page animate-fade-up">
      <PageHeader title="Dashboard" subtitle="Visão geral da automação" action={newPostLink} />

      <DailySummaryCard
        content={summary?.content ?? null}
        generatedAt={summary ? formatDateTime(summary.updatedAt) : null}
        postCount={summary?.postCount ?? todayPosts.length}
      />

      <QueueHealthCard
        stuck={queue.stuck}
        overdue={queue.overdue}
        exhausted={queue.exhausted}
        failed={queue.failed}
        stuckRequeueable={requeueable.stuck}
        failedRequeueable={requeueable.failed}
        lastPublishedLabel={queue.lastPublishedAt ? formatDateTime(queue.lastPublishedAt) : null}
        healthy={queue.healthy}
      />

      <section aria-label="Números gerais" className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Clientes" value={stats.clients} href="/clients" tone="accent" icon={<Icon.users className="size-5" />} />
        <StatCard
          label="Agendados"
          value={stats.postsScheduled}
          href="/posts?status=scheduled"
          tone="info"
          icon={<Icon.clock className="size-5" />}
        />
        <StatCard
          label="Publicados"
          value={stats.postsPublished}
          href="/posts?status=published"
          tone="success"
          icon={<Icon.check className="size-5" />}
        />
        <StatCard
          label="Falharam"
          value={stats.postsFailed}
          href="/posts?status=failed"
          tone="danger"
          icon={<Icon.alert className="size-5" />}
        />
      </section>

      {stats.expiringTokens > 0 && (
        <Callout tone="warning" className="mb-6">
          {stats.expiringTokens === 1
            ? "1 conta com token expirando em menos de 7 dias."
            : `${stats.expiringTokens} contas com tokens expirando em menos de 7 dias.`}{" "}
          A renovação automática roda a cada 12 horas.
        </Callout>
      )}

      {/* trilha de notificações do fluxo de aprovação — nada passa despercebido */}
      {alerts.length > 0 && (
        <section aria-labelledby="notificacoes-titulo" className="card mb-6 overflow-hidden">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-line px-4 py-3 sm:px-5">
            <h2 id="notificacoes-titulo" className="text-base font-semibold text-fg">
              Notificações do fluxo de aprovação
            </h2>
            <span className="text-xs text-fg-muted">últimos 14 dias</span>
          </div>
          {/* contêiner de rolagem: focável pelo teclado */}
          <div role="region" aria-label="Lista de notificações" tabIndex={0} className="max-h-72 overflow-y-auto">
            <ul className="divide-y divide-line">
              {alerts.map((a) => {
                const kind = ALERT_KIND[a.kind] ?? UNKNOWN_ALERT;
                return (
                  <li key={a.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3 sm:flex-nowrap sm:px-5">
                    <span className="shrink-0 sm:w-36">
                      <ToneBadge tone={kind.tone}>{kind.label}</ToneBadge>
                    </span>
                    <p className="min-w-0 flex-1 basis-full text-sm leading-snug text-fg sm:basis-auto">{a.message}</p>
                    <span className="shrink-0 text-xs tabular-nums text-fg-muted">
                      {fmtDiaHora(a.createdAt)}
                      {!a.emailed && a.audience === "cliente" ? " · sem e-mail" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      <section aria-labelledby="hoje-titulo" className="card mb-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-x-4 border-b border-line px-4 py-1 sm:px-5">
          <h2 id="hoje-titulo" className="py-2 text-base font-semibold text-fg">
            Hoje{" "}
            <span className="text-sm font-normal text-fg-muted">
              · {todayPosts.length} {todayPosts.length === 1 ? "post" : "posts"}
              {todayPending > 0 && `, ${todayPending} pendente${todayPending === 1 ? "" : "s"}`}
            </span>
          </h2>
          <Link href="/calendar" className={LOOSE_LINK}>
            Ver calendário
          </Link>
        </div>

        {todayPosts.length === 0 ? (
          <EmptyState
            size="inline"
            headingLevel={3}
            icon={<Icon.calendar />}
            title="Nada agendado para hoje"
            description="Nenhum post tem data para hoje. Veja os próximos dias no calendário ou crie um post novo."
          />
        ) : (
          <ul className="divide-y divide-line">
            {todayPosts.map((p) => {
              const missingMedia = !p.hasMedia && p.status !== "published";
              const missingCaption = !p.hasCaption && p.status !== "published";
              return (
                <li
                  key={p.id}
                  className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:items-center sm:px-5"
                >
                  <span className="pt-0.5 text-sm font-medium tabular-nums text-fg-muted sm:pt-0">
                    {fmtHora(p.scheduledAt)}
                  </span>
                  <div className="min-w-0">
                    <p
                      className="line-clamp-2 text-sm font-medium text-fg wrap-break-word sm:line-clamp-1"
                      title={`${p.clientName} · ${p.theme ?? "sem tema"}`}
                    >
                      {p.clientName}
                      <span className="font-normal text-fg-muted"> · {p.theme ?? "sem tema"}</span>
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="flex gap-1">
                        {p.targets.map((t) => (
                          <PlatformChip key={t} platform={t} decorative={false} />
                        ))}
                      </span>
                      {/* alertas só fazem sentido antes de publicar */}
                      {missingMedia && (
                        <ToneBadge tone="warning" icon={<Icon.alert />}>
                          Sem arte
                        </ToneBadge>
                      )}
                      {missingCaption && (
                        <ToneBadge tone="warning" icon={<Icon.alert />}>
                          Sem legenda
                        </ToneBadge>
                      )}
                    </div>
                  </div>
                  <div className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-2 sm:col-start-auto sm:justify-end">
                    {retryable.has(p.id) && <RetryPostButton postId={p.id} />}
                    <StatusBadge kind="post" status={p.status} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="recentes-titulo" className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-x-4 border-b border-line px-4 py-1 sm:px-5">
          <h2 id="recentes-titulo" className="py-2 text-base font-semibold text-fg">
            Posts recentes
          </h2>
          <Link href="/posts" className={LOOSE_LINK}>
            Ver todos
          </Link>
        </div>

        {posts.length === 0 ? (
          <EmptyState
            size="inline"
            headingLevel={3}
            title="Nenhum post ainda"
            description="Crie um post aqui ou gere o cronograma do mês na página do cliente."
            action={newPostLink}
          />
        ) : (
          <>
            {/* ≥ lg: tabela */}
            <table className="hidden w-full text-sm lg:table">
              <thead className="bg-sunken">
                <tr>
                  {["Cliente", "Tema", "Redes", "Agendado para", "Status"].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-overline text-fg-muted"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.id} className="border-t border-line">
                    <td className="px-5 py-3 font-medium text-fg">{post.client.name}</td>
                    <td className="max-w-xs truncate px-5 py-3 text-fg-muted" title={post.theme ?? undefined}>
                      {post.theme ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1">
                        {post.targets.map((t) => (
                          <PlatformChip key={t} platform={t} decorative={false} />
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 tabular-nums text-fg-muted">
                      {formatDateTime(post.scheduledAt)}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge kind="post" status={post.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* < lg: lista */}
            <ul className="divide-y divide-line lg:hidden">
              {posts.map((post) => (
                <li key={post.id} className="grid gap-1.5 px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 truncate text-sm font-medium text-fg">{post.client.name}</span>
                    <StatusBadge kind="post" status={post.status} />
                  </div>
                  <p className="line-clamp-2 text-sm text-fg-muted wrap-break-word" title={post.theme ?? undefined}>
                    {post.theme ?? "Sem tema"}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
                    <span className="tabular-nums">{formatDateTime(post.scheduledAt)}</span>
                    <span className="flex gap-1">
                      {post.targets.map((t) => (
                        <PlatformChip key={t} platform={t} decorative={false} />
                      ))}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
