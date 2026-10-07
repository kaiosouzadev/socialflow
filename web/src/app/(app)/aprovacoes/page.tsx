import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader, EmptyState } from "@/components/ui";
import { buttonClasses } from "@/components/Button";
import { approvalLink } from "@/lib/approval";
import { clientRecipients } from "@/lib/client-emails";
import { spDateKey } from "@/lib/deadlines";
import { formatMonthLabel, TZ } from "@/lib/format-date";
import { approvalDeadline } from "@/lib/production";
import SchedulesManager, { type ScheduleRow } from "./SchedulesManager";
import AdjustmentsPanel, { type AdjustmentRow } from "./AdjustmentsPanel";
import WeeklyRunButton from "./WeeklyRunButton";
import { freshnessOf, lastActivity, parseScheduleFilters } from "./schedules-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Aprovações" };

/** Cronograma aberto para o cliente: ajuste pedido aqui bloqueia a aprovação do cronograma. */
const OPEN_FOR_CLIENT = ["enviado_cliente", "em_revisao"];

/** Aprovados carregados (os mais recentes); os demais status vêm todos — são o trabalho em aberto. */
const APPROVED_LIMIT = 100;

const DAY = 86_400_000;

/** Dias civis (fuso SP) entre duas chaves "AAAA-MM-DD". */
function civilDaysBetween(fromKey: string, toKey: string): number {
  const utc = (k: string) => Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));
  return Math.round((utc(toKey) - utc(fromKey)) / DAY);
}

const YEAR = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, year: "numeric" });
const DAY_MONTH = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const TIME = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "12/10" no fuso SP; com o ano quando não é o ano corrente ("12/10/2025"). */
function shortDate(d: Date, currentYear: string): string {
  return YEAR.format(d) === currentYear ? DAY_MONTH.format(d) : DAY_MONTH_YEAR.format(d);
}

/** "12/10 às 14:18" no fuso SP. */
function shortDateTime(d: Date, currentYear: string): string {
  return `${shortDate(d, currentYear)} às ${TIME.format(d)}`;
}

/** Mês do cronograma (@db.Date, meia-noite UTC): usa a chave civil, nunca o Date (N-03). */
function scheduleMonthKey(monthRef: Date): string {
  return monthRef.toISOString().slice(0, 7);
}

function hasArt(p: { mediaUrl: string | null; mediaItems: unknown }): boolean {
  return !!p.mediaUrl || (Array.isArray(p.mediaItems) && p.mediaItems.length > 0);
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const scheduleInclude = {
  client: {
    select: { name: true, plan: true, agencyPublishes: true, email: true, extraEmails: true },
  },
  // só o necessário para as contagens das linhas, dos diálogos e da última atividade — sem legendas/thumbs
  posts: { select: { status: true, mediaUrl: true, mediaItems: true, clientNote: true, createdAt: true } },
} as const;

export default async function AprovacoesPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseScheduleFilters(await searchParams);

  const [open, approved, pendingAdjustments] = await Promise.all([
    // em aberto: todos (é o trabalho da equipe; nenhum pode sumir por limite)
    prisma.schedule.findMany({
      where: { status: { not: "aprovado_cliente" } },
      orderBy: { createdAt: "desc" },
      include: scheduleInclude,
    }),
    prisma.schedule.findMany({
      where: { status: "aprovado_cliente" },
      orderBy: [{ approvedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: APPROVED_LIMIT,
      include: scheduleInclude,
    }),
    prisma.postAdjustment.findMany({
      where: { status: "pendente" },
      orderBy: { createdAt: "asc" },
      include: {
        post: {
          select: {
            id: true,
            theme: true,
            scheduledAt: true,
            scheduleId: true,
            client: { select: { name: true } },
            schedule: { select: { monthRef: true, status: true } },
          },
        },
      },
    }),
  ]);
  const schedules = [...open, ...approved];

  const now = new Date();
  const currentYear = YEAR.format(now);
  const todayKey = spDateKey(now);

  // ajustes abertos por cronograma: o "Ver ajustes (N)" da linha leva ao painel
  const pendingBySchedule = new Map<string, number>();
  for (const a of pendingAdjustments) {
    const id = a.post.scheduleId;
    if (id) pendingBySchedule.set(id, (pendingBySchedule.get(id) ?? 0) + 1);
  }

  const rows: ScheduleRow[] = schedules.map((s) => {
    const drafts = s.posts.filter((p) => p.status === "draft");
    // U-09: com o cliente (enviado e sem resposta) → idade do envio e prazo do cliente (dia 25 do mês
    // anterior, a mesma regra do /producao). O cronograma não tem data de post: scheduledAt só cumpre o
    // tipo, pois sem weeklyReviewId o prazo vem do cronograma.
    const waiting = s.status === "enviado_cliente" && s.sentAt !== null;
    const deadline = waiting
      ? approvalDeadline({ scheduledAt: s.monthRef, schedule: { status: s.status, monthRef: s.monthRef } })
      : null;
    // última atividade (F13): o post mais novo conta — calendário salvo num cronograma antigo sobe
    const latestPostAt = s.posts.reduce<Date | null>(
      (max, p) => (!max || p.createdAt.getTime() > max.getTime() ? p.createdAt : max),
      null
    );
    const activity = {
      createdAt: s.createdAt,
      sentAt: s.sentAt,
      approvedAt: s.approvedAt,
      changesAskedAt: s.changesAskedAt,
      latestPostAt,
    };
    const monthKey = scheduleMonthKey(s.monthRef);
    return {
      id: s.id,
      client: s.client.name,
      plan: s.client.plan,
      agencyPublishes: s.client.agencyPublishes,
      monthKey,
      month: formatMonthLabel(monthKey),
      status: s.status,
      posts: s.posts.length,
      withMedia: s.posts.filter(hasArt).length,
      drafts: drafts.length,
      draftsWithoutArt: drafts.filter((p) => !hasArt(p)).length,
      queued: s.posts.filter((p) => p.status === "scheduled").length,
      published: s.posts.filter((p) => p.status === "published" || p.status === "publishing").length,
      notedPosts: s.posts.filter((p) => p.clientNote).length,
      pendingAdjustments: pendingBySchedule.get(s.id) ?? 0,
      recipients: clientRecipients(s.client).length,
      clientNote: s.clientNote,
      changesAskedAt: s.changesAskedAt ? shortDateTime(s.changesAskedAt, currentYear) : null,
      sentAt: s.sentAt ? shortDateTime(s.sentAt, currentYear) : null,
      waitingDays: waiting && s.sentAt ? Math.max(0, civilDaysBetween(spDateKey(s.sentAt), todayKey)) : null,
      clientDeadline: deadline ? shortDate(deadline, currentYear) : null,
      overdue: !!deadline && now.getTime() > deadline.getTime(),
      approvedAt: s.approvedAt ? shortDate(s.approvedAt, currentYear) : null,
      createdAt: shortDate(s.createdAt, currentYear),
      lastActivity: lastActivity(activity).getTime(),
      freshness: freshnessOf(activity, now),
      link: s.approvalToken ? approvalLink(s.approvalToken) : null,
    };
  });

  const adjustmentRows: AdjustmentRow[] = pendingAdjustments.map((a) => ({
    id: a.id,
    comment: a.comment,
    createdAt: shortDateTime(a.createdAt, currentYear),
    postId: a.post.id,
    postTheme: a.post.theme ?? "",
    clientName: a.post.client.name,
    month: a.post.schedule
      ? formatMonthLabel(scheduleMonthKey(a.post.schedule.monthRef))
      : formatMonthLabel(a.post.scheduledAt),
    scheduleId: a.post.scheduleId,
    phase: a.post.schedule && OPEN_FOR_CLIENT.includes(a.post.schedule.status) ? "cronograma" : "post",
  }));

  return (
    <div className="page">
      <PageHeader
        title="Aprovações"
        subtitle="Cronogramas, ajustes e envios semanais"
        action={<WeeklyRunButton />}
      />
      <AdjustmentsPanel rows={adjustmentRows} />
      {rows.length === 0 ? (
        <section aria-labelledby="cronogramas-titulo">
          <h2 id="cronogramas-titulo" className="mb-3 text-base font-semibold text-fg">
            Cronogramas
          </h2>
          <EmptyState
            title="Nenhum cronograma ainda"
            description="Gere o cronograma com IA ou importe o documento do mês na página do cliente."
            action={
              <Link href="/clients" className={buttonClasses({ variant: "secondary" })}>
                Ver clientes
              </Link>
            }
            headingLevel={3}
          />
        </section>
      ) : (
        <SchedulesManager rows={rows} initialFilters={filters} approvedCapped={approved.length === APPROVED_LIMIT} />
      )}
    </div>
  );
}
