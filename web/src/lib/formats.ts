/**
 * Formatos de post (puro): fonte única de rótulo e tom de cor — substitui as
 * definições repetidas em FormatPicker, PostPreview, calendar, ApprovalView,
 * WeeklyView e CalendarReviewModal.
 *
 * `tone` é a chave do token de cor de formato do design system
 * (ex.: "format-feed" → var(--color-format-feed)).
 */

export const POST_FORMATS = ["feed", "story", "carrossel", "reels"] as const;
export type PostFormat = (typeof POST_FORMATS)[number];

export type FormatTone = `format-${PostFormat}`;

export type FormatMeta = { id: PostFormat; label: string; tone: FormatTone };

export const FORMAT: Record<PostFormat, FormatMeta> = {
  feed: { id: "feed", label: "Feed", tone: "format-feed" },
  story: { id: "story", label: "Story", tone: "format-story" },
  carrossel: { id: "carrossel", label: "Carrossel", tone: "format-carrossel" },
  reels: { id: "reels", label: "Reels", tone: "format-reels" },
};

/** Na ordem de exibição dos seletores. */
export const FORMAT_OPTIONS: readonly FormatMeta[] = POST_FORMATS.map((f) => FORMAT[f]);

export function isPostFormat(value: string | null | undefined): value is PostFormat {
  return (POST_FORMATS as readonly string[]).includes(value ?? "");
}

/** Metadados do formato; valor desconhecido cai em "Feed" com o rótulo original. */
export function formatMeta(value: string | null | undefined): FormatMeta {
  if (isPostFormat(value)) return FORMAT[value];
  return { ...FORMAT.feed, label: value || FORMAT.feed.label };
}

export function formatLabel(value: string | null | undefined): string {
  return formatMeta(value).label;
}
