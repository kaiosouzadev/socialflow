import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PublicHeader } from "@/components/Logo";
import { TZ } from "@/lib/format-date";
import { postResponseDeadline } from "@/lib/deadlines";
import { EXPIRED_PAGE_TITLE, PUBLIC_PAGE_ROBOTS, isTokenShaped, weeklyLinkState } from "@/lib/approval";
import WeeklyView from "./WeeklyView";

export const dynamic = "force-dynamic";

/**
 * Link semanal. Página SEM sessão: o `select` traz só o que o cliente pode ver
 * (nada de nota interna, redatora, status de fila, erro de publicação ou e-mails).
 * `cache` faz a página e o generateMetadata dividirem UMA consulta por request.
 * Ciclo de vida (lib/approval): 60 dias após o envio o link expira → mesma página amigável do
 * link inexistente (HTTP 404); semana concluída → só leitura.
 */
const loadReview = cache(async (token: string) => {
  // formato impossível: nem consulta o banco
  if (!isTokenShaped(token)) return null;
  const review = await prisma.weeklyReview.findUnique({
    where: { token },
    select: {
      weekStart: true,
      status: true,
      sentAt: true,
      client: { select: { name: true, logoUrl: true } },
      posts: {
        orderBy: { scheduledAt: "asc" },
        select: {
          id: true,
          theme: true,
          format: true,
          caption: true,
          captions: true,
          mediaUrl: true,
          mediaItems: true,
          slides: true,
          targets: true,
          scheduledAt: true,
          clientApproval: true,
          adjustments: {
            orderBy: { createdAt: "asc" },
            select: { id: true, comment: true, status: true, reply: true },
          },
        },
      },
    },
  });
  if (!review) return null;
  const state = weeklyLinkState(review);
  return state === "expirado" ? null : { ...review, state };
});

const DAY = 86_400_000;
const MONTH_NAME = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long" });

/** "12 a 18 de outubro" (weekStart é @db.Date: meia-noite UTC do domingo, chave civil). */
function weekRange(start: Date): string {
  const end = new Date(start.getTime() + 6 * DAY);
  const [d1, m1, y1] = [start.getUTCDate(), MONTH_NAME.format(start), start.getUTCFullYear()];
  const [d2, m2, y2] = [end.getUTCDate(), MONTH_NAME.format(end), end.getUTCFullYear()];
  if (y1 !== y2) return `${d1} de ${m1} de ${y1} a ${d2} de ${m2} de ${y2}`;
  if (m1 !== m2) return `${d1} de ${m1} a ${d2} de ${m2}`;
  return `${d1} a ${d2} de ${m2}`;
}

/** Partes de data/hora no fuso de São Paulo. */
function spParts(d: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: TZ,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
}

/** "qui, 15/10" */
function shortDay(d: Date): string {
  const p = spParts(d);
  return `${p.weekday.replace(".", "")}, ${p.day}/${p.month}`;
}

/** "sex, 16/10 às 18:00" */
function shortWhen(d: Date): string {
  const p = spParts(d);
  return `${shortDay(d)} às ${p.hour}:${p.minute}`;
}

function isOverdue(deadline: Date): boolean {
  return Date.now() > deadline.getTime();
}

/** Só as legendas em texto ({ instagram, facebook, linkedin }). */
function captionsOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (typeof v === "string") out[k] = v;
  return out;
}

/** Só url + tipo de cada mídia (o JSON pode guardar ids internos do Drive). */
function mediaItemsOf(value: unknown): { url: string; type?: string }[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.flatMap((m) =>
    m && typeof m === "object" && typeof (m as { url?: unknown }).url === "string"
      ? [
          {
            url: (m as { url: string }).url,
            ...(typeof (m as { type?: unknown }).type === "string" ? { type: (m as { type: string }).type } : {}),
          },
        ]
      : []
  );
  return items.length ? items : null;
}

type Params = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  const review = await loadReview(token);
  if (!review) return { title: EXPIRED_PAGE_TITLE, robots: PUBLIC_PAGE_ROBOTS };
  return {
    title: `Postagens da semana de ${weekRange(review.weekStart)} · ${review.client.name}`,
    robots: PUBLIC_PAGE_ROBOTS,
  };
}

export default async function WeeklyApprovalPage({ params }: Params) {
  const { token } = await params;
  const review = await loadReview(token);
  // inexistente ou expirado: antes de qualquer streaming a resposta sai com HTTP 404 e a mesma
  // página amigável (not-found.tsx do segmento)
  if (!review) notFound();

  const posts = review.posts.map((p) => {
    const deadline = postResponseDeadline(p.scheduledAt);
    return {
      id: p.id,
      theme: p.theme ?? "",
      format: p.format,
      // legado: o importador grava só `caption`; a tela cai para ele quando `captions` está vazio (N-18)
      caption: p.caption,
      captions: captionsOf(p.captions),
      mediaUrl: p.mediaUrl,
      mediaItems: mediaItemsOf(p.mediaItems),
      slides: Array.isArray(p.slides)
        ? (p.slides as { text?: string }[]).map((s) => s?.text ?? "").filter(Boolean)
        : [],
      targets: p.targets,
      when: shortWhen(p.scheduledAt),
      approved: p.clientApproval === "aprovado",
      deadlineLabel: shortDay(deadline),
      overdue: isOverdue(deadline),
      adjustments: p.adjustments,
    };
  });

  return (
    <>
      {/* seletor de tema com alvos de 44 px no celular (controles do link, CC7) */}
      <PublicHeader maxWidth="xl" className="max-sm:**:[[role=radio]]:h-11 max-sm:**:[[role=radio]]:min-w-11" />
      <main id="conteudo">
        <WeeklyView
          token={token}
          clientName={review.client.name}
          clientLogoUrl={review.client.logoUrl}
          weekRange={weekRange(review.weekStart)}
          posts={posts}
          readOnly={review.state === "concluido"}
        />
      </main>
    </>
  );
}
