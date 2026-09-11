import { prisma } from "@/lib/prisma";
import { Logo } from "@/components/Logo";
import { monthLabel } from "@/lib/approval";
import { formatDateTime, spDayTime, TZ } from "@/lib/format-date";
import ApprovalView from "./ApprovalView";

export const dynamic = "force-dynamic";

/** "quinta-feira, 2 de outubro de 2026 · 18:00" — com ano, para não confundir
 *  cronogramas de meses futuros. */
function fullWhen(d: Date): string {
  const date = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${date} · ${time}`;
}

export default async function ApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const schedule = await prisma.schedule.findUnique({
    where: { approvalToken: token },
    include: {
      client: { select: { name: true, logoUrl: true, brandColor: true } },
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
      fullWhen: fullWhen(p.scheduledAt),
      day,
      time,
      aiEditsUsed: p.aiEditsUsed,
      clientNote: p.clientNote,
      slides: Array.isArray(p.slides)
        ? (p.slides as { text?: string }[]).map((s) => s?.text ?? "").filter(Boolean)
        : [],
    };
  });

  return (
    <ApprovalView
      token={token}
      clientName={schedule.client.name}
      clientLogoUrl={schedule.client.logoUrl}
      clientBrandColor={schedule.client.brandColor}
      monthLabel={monthLabel(schedule.monthRef)}
      year={schedule.monthRef.getUTCFullYear()}
      month={schedule.monthRef.getUTCMonth()}
      posts={posts}
      readOnly={approved}
      changesAsked={schedule.status === "em_revisao" && !!schedule.changesAskedAt}
      scheduleNote={schedule.clientNote}
    />
  );
}
