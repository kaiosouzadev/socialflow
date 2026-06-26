import { prisma } from "@/lib/prisma";
import { PageHeader, EmptyState } from "@/components/ui";
import { monthLabel, approvalLink } from "@/lib/approval";
import { formatDateTime } from "@/lib/format-date";
import SchedulesManager from "./SchedulesManager";

export const dynamic = "force-dynamic";

export default async function AprovacoesPage() {
  const schedules = await prisma.schedule.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      client: { select: { name: true, plan: true } },
      _count: { select: { posts: true } },
    },
  });

  const rows = schedules.map((s) => ({
    id: s.id,
    client: s.client.name,
    plan: s.client.plan,
    month: monthLabel(s.monthRef),
    status: s.status,
    posts: s._count.posts,
    sentAt: s.sentAt ? formatDateTime(s.sentAt) : null,
    link: s.approvalToken ? approvalLink(s.approvalToken) : null,
  }));

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-up">
      <PageHeader title="Aprovações" subtitle="Cronogramas e fluxo de aprovação do cliente" />
      {rows.length === 0 ? (
        <EmptyState
          title="Nenhum cronograma ainda"
          description="Gere um calendário com IA no cliente para criar um cronograma."
        />
      ) : (
        <SchedulesManager rows={rows} />
      )}
    </div>
  );
}
