import { prisma } from "@/lib/prisma";
import { PageHeader, EmptyState } from "@/components/ui";
import { monthLabel, approvalLink } from "@/lib/approval";
import { formatDateTime } from "@/lib/format-date";
import SchedulesManager from "./SchedulesManager";
import AdjustmentsPanel from "./AdjustmentsPanel";
import WeeklyRunButton from "./WeeklyRunButton";

export const dynamic = "force-dynamic";

export default async function AprovacoesPage() {
  const [schedules, pendingAdjustments] = await Promise.all([
    prisma.schedule.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        client: { select: { name: true, plan: true } },
        _count: { select: { posts: true } },
        // só o necessário para contar prontidão de arte — sem legendas/thumbs
        posts: { select: { id: true, mediaUrl: true, mediaItems: true, clientNote: true } },
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
            client: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const rows = schedules.map((s) => {
    const withMedia = s.posts.filter((p) => {
      const items = Array.isArray(p.mediaItems) ? (p.mediaItems as unknown[]) : [];
      return !!p.mediaUrl || items.length > 0;
    }).length;

    return {
      id: s.id,
      client: s.client.name,
      plan: s.client.plan,
      month: monthLabel(s.monthRef),
      status: s.status,
      posts: s._count.posts,
      withMedia,
      notedPosts: s.posts.filter((p) => p.clientNote).length,
      clientNote: s.clientNote,
      changesAskedAt: s.changesAskedAt ? formatDateTime(s.changesAskedAt) : null,
      sentAt: s.sentAt ? formatDateTime(s.sentAt) : null,
      link: s.approvalToken ? approvalLink(s.approvalToken) : null,
    };
  });

  const adjustmentRows = pendingAdjustments.map((a) => ({
    id: a.id,
    comment: a.comment,
    createdAt: formatDateTime(a.createdAt),
    postId: a.post.id,
    postTheme: a.post.theme ?? "",
    clientName: a.post.client.name,
    month: monthLabel(a.post.scheduledAt),
  }));

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-up">
      <PageHeader
        title="Aprovações"
        subtitle="Cronogramas, ajustes e envios semanais"
        action={<WeeklyRunButton />}
      />
      <AdjustmentsPanel rows={adjustmentRows} />
      {rows.length === 0 ? (
        <EmptyState
          title="Nenhum cronograma ainda"
          description="Gere um cronograma com IA no cliente para começar."
        />
      ) : (
        <SchedulesManager rows={rows} />
      )}
    </div>
  );
}
