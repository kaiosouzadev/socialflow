import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader, EmptyState } from "@/components/ui";
import { buttonClasses } from "@/components/Button";
import { approvalLink } from "@/lib/approval";
import { clientRecipients } from "@/lib/client-emails";
import { formatMonthLabel, TZ } from "@/lib/format-date";
import SchedulesManager, { type ScheduleRow } from "./SchedulesManager";
import AdjustmentsPanel, { type AdjustmentRow } from "./AdjustmentsPanel";
import WeeklyRunButton from "./WeeklyRunButton";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Aprovações" };

/** Cronograma aberto para o cliente: ajuste pedido aqui bloqueia a aprovação do cronograma. */
const OPEN_FOR_CLIENT = ["enviado_cliente", "em_revisao"];

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
function scheduleMonth(monthRef: Date): string {
  return formatMonthLabel(monthRef.toISOString().slice(0, 7));
}

function hasArt(p: { mediaUrl: string | null; mediaItems: unknown }): boolean {
  return !!p.mediaUrl || (Array.isArray(p.mediaItems) && p.mediaItems.length > 0);
}

export default async function AprovacoesPage() {
  const [schedules, pendingAdjustments] = await Promise.all([
    prisma.schedule.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        client: {
          select: { name: true, plan: true, agencyPublishes: true, email: true, extraEmails: true },
        },
        // só o necessário para as contagens das linhas e dos diálogos — sem legendas/thumbs
        posts: { select: { status: true, mediaUrl: true, mediaItems: true, clientNote: true } },
      },
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

  const currentYear = YEAR.format(new Date());

  // ajustes abertos por cronograma: o "Ver ajustes (N)" da linha leva ao painel
  const pendingBySchedule = new Map<string, number>();
  for (const a of pendingAdjustments) {
    const id = a.post.scheduleId;
    if (id) pendingBySchedule.set(id, (pendingBySchedule.get(id) ?? 0) + 1);
  }

  const rows: ScheduleRow[] = schedules.map((s) => {
    const drafts = s.posts.filter((p) => p.status === "draft");
    return {
      id: s.id,
      client: s.client.name,
      plan: s.client.plan,
      agencyPublishes: s.client.agencyPublishes,
      month: scheduleMonth(s.monthRef),
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
      approvedAt: s.approvedAt ? shortDate(s.approvedAt, currentYear) : null,
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
    month: a.post.schedule ? scheduleMonth(a.post.schedule.monthRef) : formatMonthLabel(a.post.scheduledAt),
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
      <section aria-labelledby="cronogramas-titulo">
        <h2 id="cronogramas-titulo" className="mb-3 text-base font-semibold text-fg">
          Cronogramas
        </h2>
        {rows.length === 0 ? (
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
        ) : (
          <SchedulesManager rows={rows} />
        )}
      </section>
    </div>
  );
}
