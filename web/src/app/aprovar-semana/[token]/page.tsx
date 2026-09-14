import { prisma } from "@/lib/prisma";
import { Logo } from "@/components/Logo";
import { spDayTime, formatDateTime } from "@/lib/format-date";
import { postResponseDeadline, shortLabel } from "@/lib/deadlines";
import WeeklyView from "./WeeklyView";

export const dynamic = "force-dynamic";

function isOverdue(deadline: Date): boolean {
  return Date.now() > deadline.getTime();
}

export default async function WeeklyApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const review = await prisma.weeklyReview.findUnique({
    where: { token },
    include: {
      client: { select: { name: true } },
      posts: {
        orderBy: { scheduledAt: "asc" },
        include: {
          adjustments: {
            orderBy: { createdAt: "asc" },
            select: { id: true, comment: true, status: true, reply: true },
          },
        },
      },
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

  if (!review) {
    return shell(
      <div className="card p-8 max-w-md text-center">
        <p className="text-[var(--color-text-muted)]">Link inválido ou expirado.</p>
      </div>
    );
  }

  const posts = review.posts.map((p) => {
    const { day, time } = spDayTime(p.scheduledAt);
    const deadline = postResponseDeadline(p.scheduledAt);
    const caps = (p.captions as Record<string, string> | null) ?? {};
    return {
      id: p.id,
      theme: p.theme ?? "",
      explanation: p.explanation ?? "",
      format: p.format,
      caption: caps.instagram ?? caps.facebook ?? "",
      mediaUrl: p.mediaUrl,
      mediaItems: (p.mediaItems as { url: string; type?: string }[] | null) ?? null,
      slides: Array.isArray(p.slides)
        ? (p.slides as { text?: string }[]).map((s) => s?.text ?? "").filter(Boolean)
        : [],
      targets: p.targets,
      when: formatDateTime(p.scheduledAt),
      day,
      time,
      approved: p.clientApproval === "aprovado",
      deadlineLabel: shortLabel(deadline),
      overdue: isOverdue(deadline),
      adjustments: p.adjustments,
    };
  });

  const weekLabel = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "long",
  }).format(review.weekStart);

  return shell(
    <WeeklyView
      token={token}
      clientName={review.client.name}
      weekLabel={weekLabel}
      posts={posts}
    />
  );
}
