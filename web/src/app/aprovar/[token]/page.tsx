import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PublicHeader } from "@/components/Logo";
import { monthLabel } from "@/lib/approval";
import { capitalizeFirst, formatMonthLabel, spDayTime, TZ } from "@/lib/format-date";
import { getInstagramProfilePreview } from "@/lib/ig-profile";
import ApprovalView from "./ApprovalView";

export const dynamic = "force-dynamic";

/**
 * Cronograma do link público. Página SEM sessão: o `select` traz só o que o
 * cliente pode ver (nada de nota interna, redatora, e-mails ou status de fila).
 * `cache` faz a página e o generateMetadata dividirem UMA consulta por request.
 */
const loadSchedule = cache((token: string) =>
  prisma.schedule.findUnique({
    where: { approvalToken: token },
    select: {
      status: true,
      monthRef: true,
      clientNote: true,
      changesAskedAt: true,
      // id: só no servidor (prévia do Instagram); não vai para o ApprovalView
      client: { select: { id: true, name: true, logoUrl: true } },
      posts: {
        orderBy: { scheduledAt: "asc" },
        select: {
          id: true,
          theme: true,
          explanation: true,
          format: true,
          caption: true,
          captions: true,
          mediaUrl: true,
          mediaItems: true,
          slides: true,
          targets: true,
          scheduledAt: true,
          clientNote: true,
          // status: só no servidor, para contar os posts ainda não publicados (não vai para o cliente)
          status: true,
          adjustments: {
            orderBy: { createdAt: "asc" },
            select: { id: true, comment: true, status: true, reply: true },
          },
        },
      },
    },
  })
);

/**
 * Perfil do Instagram (ou do cadastro) para "Ver como feed": uma chamada por
 * request. A página NÃO espera por ele — a promessa vai para o ApprovalView e
 * só a prévia do feed aguarda (Suspense); a lib nunca rejeita e tem timeout de 3 s.
 */
const loadInstagramProfile = cache((clientId: string) => getInstagramProfilePreview(clientId));

/** "Outubro de 2026" — monthRef é @db.Date (meia-noite UTC): usa a chave civil (N-03). */
function monthTitle(monthRef: Date): string {
  return formatMonthLabel(monthRef.toISOString().slice(0, 7));
}

/** "Quinta-feira, 2 de outubro de 2026 · 18:00" — com ano, para não confundir
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
  return capitalizeFirst(`${date} · ${time}`);
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
  const schedule = await loadSchedule(token);
  if (!schedule) return { title: "Link indisponível" };
  return { title: `Cronograma de ${monthTitle(schedule.monthRef)} · ${schedule.client.name}` };
}

export default async function ApprovalPage({ params }: Params) {
  const { token } = await params;
  const schedule = await loadSchedule(token);
  // antes de qualquer streaming: a resposta sai com HTTP 404 (not-found.tsx do segmento)
  if (!schedule) notFound();

  const posts = schedule.posts.map((p) => {
    const { day, time } = spDayTime(p.scheduledAt);
    return {
      id: p.id,
      theme: p.theme ?? "",
      explanation: p.explanation ?? "",
      format: p.format,
      // legado: o importador grava só `caption`; a tela cai para ele quando `captions` está vazio (N-18)
      caption: p.caption,
      captions: captionsOf(p.captions),
      mediaUrl: p.mediaUrl,
      mediaItems: mediaItemsOf(p.mediaItems),
      targets: p.targets,
      fullWhen: fullWhen(p.scheduledAt),
      day,
      time,
      clientNote: p.clientNote,
      slides: Array.isArray(p.slides)
        ? (p.slides as { text?: string }[]).map((s) => s?.text ?? "").filter(Boolean)
        : [],
      adjustments: p.adjustments,
    };
  });

  // "Ver como feed" só aparece quando já há arte de feed: sem isso, nem consulta o Instagram
  const feedPosts = schedule.posts.filter((p) => p.format !== "story");
  const hasFeedArt = feedPosts.some((p) => !!p.mediaUrl || !!mediaItemsOf(p.mediaItems));
  const igProfile = hasFeedArt ? loadInstagramProfile(schedule.client.id) : null;
  // nº de posts do perfil = media_count real + os posts de feed deste cronograma ainda não publicados
  const plannedFeedCount = feedPosts.filter((p) => p.status !== "published").length;

  return (
    <>
      <PublicHeader maxWidth="3xl" />
      <main id="conteudo">
        <ApprovalView
          token={token}
          clientName={schedule.client.name}
          clientLogoUrl={schedule.client.logoUrl}
          monthTitle={monthTitle(schedule.monthRef)}
          monthText={monthLabel(schedule.monthRef)}
          year={schedule.monthRef.getUTCFullYear()}
          month={schedule.monthRef.getUTCMonth()}
          posts={posts}
          readOnly={schedule.status === "aprovado_cliente"}
          changesAsked={schedule.status === "em_revisao" && !!schedule.changesAskedAt}
          scheduleNote={schedule.clientNote}
          igProfile={igProfile}
          plannedFeedCount={plannedFeedCount}
        />
      </main>
    </>
  );
}
