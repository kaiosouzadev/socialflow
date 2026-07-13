import { prisma } from "@/lib/prisma";
import { Logo } from "@/components/Logo";
import { monthLabel } from "@/lib/approval";
import { formatDateTime, spDayTime } from "@/lib/format-date";
import ApprovalView from "./ApprovalView";

export const dynamic = "force-dynamic";

export default async function ApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const schedule = await prisma.schedule.findUnique({
    where: { approvalToken: token },
    include: {
      client: { select: { name: true } },
      posts: { orderBy: { scheduledAt: "asc" } },
    },
  });

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex flex-col items-center px-4 py-10">
      <div className="flex items-center gap-2.5 mb-8">
        <Logo size={30} />
        <span className="font-semibold tracking-tight">
          Social<span className="gradient-text">Flow</span>
        </span>
      </div>
      {children}
    </div>
  );

  if (!schedule) {
    return shell(
      <div className="card p-8 max-w-md text-center">
        <p className="text-[var(--color-text-muted)]">Link inválido ou expirado.</p>
      </div>
    );
  }

  const approved = schedule.status === "aprovado_cliente";

  const posts = schedule.posts.map((p) => {
    const { day, time } = spDayTime(p.scheduledAt);
    return {
      id: p.id,
      theme: p.theme ?? "",
      format: p.format,
      mediaUrl: p.mediaUrl,
      mediaItems: (p.mediaItems as { url: string; type?: string }[] | null) ?? null,
      captions: (p.captions as Record<string, string> | null) ?? {},
      targets: p.targets,
      when: formatDateTime(p.scheduledAt),
      day,
      time,
      aiEditsUsed: p.aiEditsUsed,
    };
  });

  return shell(
    <ApprovalView
      token={token}
      clientName={schedule.client.name}
      monthLabel={monthLabel(schedule.monthRef)}
      year={schedule.monthRef.getUTCFullYear()}
      month={schedule.monthRef.getUTCMonth()}
      posts={posts}
      readOnly={approved}
    />
  );
}
