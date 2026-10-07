import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PublicHeader } from "@/components/Logo";
import { monthLabel } from "@/lib/approval";
import { formatMonthLabel } from "@/lib/format-date";
import { getInstagramProfilePreview } from "@/lib/ig-profile";
import { MONTHLY_POST_SELECT, mediaItemsOf, toMonthlyApprovalPost } from "@/lib/monthly-approval";
import ApprovalView from "./ApprovalView";

export const dynamic = "force-dynamic";

/**
 * Cronograma do link público. Página SEM sessão: o `select` traz só o que o
 * cliente pode ver (nada de nota interna, redatora, e-mails ou status de fila).
 * Fase cronograma: sem legenda e sem slides — o cliente revisa a legenda no link
 * semanal (MONTHLY_POST_SELECT / toMonthlyApprovalPost em lib/monthly-approval).
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
        select: MONTHLY_POST_SELECT,
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

  const posts = schedule.posts.map(toMonthlyApprovalPost);

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
