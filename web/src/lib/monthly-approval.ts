import type { Prisma } from "@/generated/prisma/client";
import { capitalizeFirst, spDayTime, TZ } from "@/lib/format-date";

/**
 * Link MENSAL de aprovação (/aprovar/[token]) — fase cronograma.
 *
 * Decisão do usuário (07/10, "Só tema e explicação"): o cliente vê tema, explicação,
 * data/hora, formato, redes e a arte. NUNCA a legenda nem o roteiro das telas (slides):
 * a legenda completa é revisada no link SEMANAL (/aprovar-semana/[token]).
 *
 * As legendas já existem nesta fase (são geradas em segundo plano junto com o cronograma),
 * por isso o corte é feito aqui, no servidor: o `select` não lê caption/captions/slides e
 * o objeto que vai para o navegador (payload RSC do ApprovalView) é montado campo a campo.
 */
export const MONTHLY_POST_SELECT = {
  id: true,
  theme: true,
  explanation: true,
  format: true,
  mediaUrl: true,
  mediaItems: true,
  targets: true,
  scheduledAt: true,
  clientNote: true,
  // status: só no servidor, para contar os posts ainda não publicados (não vai para o cliente)
  status: true,
  adjustments: {
    orderBy: { createdAt: "asc" },
    select: { id: true, comment: true, status: true, reply: true },
  },
} satisfies Prisma.PostSelect;

export type MonthlyAdjustment = {
  id: string;
  comment: string;
  status: string; // pendente | resolvido
  reply: string | null;
};

/** Linha do banco como o `MONTHLY_POST_SELECT` a traz. */
export type MonthlyPostRow = {
  id: string;
  theme: string | null;
  explanation: string | null;
  format: string;
  mediaUrl: string | null;
  mediaItems: unknown;
  targets: string[];
  scheduledAt: Date;
  clientNote: string | null;
  adjustments: MonthlyAdjustment[];
};

/** O que o navegador recebe de cada post no link mensal (sem legenda, sem slides). */
export type MonthlyApprovalPost = {
  id: string;
  theme: string;
  explanation: string;
  format: string;
  mediaUrl: string | null;
  mediaItems: { url: string; type?: string }[] | null;
  targets: string[];
  /** "Quinta-feira, 2 de outubro de 2026 · 18:00" */
  fullWhen: string;
  day: number;
  time: string;
  clientNote: string | null;
  adjustments: MonthlyAdjustment[];
};

/** "Quinta-feira, 2 de outubro de 2026 · 18:00" — com ano, para não confundir
 *  cronogramas de meses futuros. */
export function fullWhen(d: Date): string {
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

/** Só url + tipo de cada mídia (o JSON pode guardar ids internos do Drive). */
export function mediaItemsOf(value: unknown): { url: string; type?: string }[] | null {
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

/** Post do link mensal, montado campo a campo (lista branca): mesmo que a linha traga
 *  caption/captions/slides ou outro campo, nada além disto chega ao navegador. */
export function toMonthlyApprovalPost(p: MonthlyPostRow): MonthlyApprovalPost {
  const { day, time } = spDayTime(p.scheduledAt);
  return {
    id: p.id,
    theme: p.theme ?? "",
    explanation: p.explanation ?? "",
    format: p.format,
    mediaUrl: p.mediaUrl,
    mediaItems: mediaItemsOf(p.mediaItems),
    targets: p.targets,
    fullWhen: fullWhen(p.scheduledAt),
    day,
    time,
    clientNote: p.clientNote,
    adjustments: p.adjustments.map((a) => ({ id: a.id, comment: a.comment, status: a.status, reply: a.reply })),
  };
}
