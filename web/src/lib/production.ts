/**
 * Estágio de produção de um post (puro) — o equivalente às cores da planilha
 * "Controle da Gestão", derivado dos dados (não é pintado à mão):
 *
 *   post_aprovado ← clientApproval = "aprovado" (aprovação semanal do post completo)
 *   sem_texto     ← sem legenda (efetiva, `effectiveCaption`) e sem texto em nenhum slide
 *   texto_ok      ← cliente sem aprovação (estado final, como na planilha)
 *   em_aprovacao  ← no link semanal (weeklyReviewId) ou cronograma enviado/em revisão
 *   tema_aprovado ← cronograma do mês aprovado pelo cliente (tema + explicação)
 *   texto_ok      ← demais casos (rascunho, aprovado interno, sem cronograma)
 *
 * Atraso: "sem texto" com data em até 3 dias (fuso SP, inclui datas passadas)
 * ou "em aprovação" com o prazo de resposta vencido (lib/deadlines.ts).
 *
 * Arte (independente do estágio): `hasArt` / `artStatus` — marcada como feita
 * pela designer (Post.artDoneAt), com mídia ou já publicado.
 */
import {
  addDaysToKey,
  postResponseDeadline,
  scheduleClientDeadline,
  spDateKey,
} from "./deadlines.ts";

export type ProductionStage = "sem_texto" | "texto_ok" | "em_aprovacao" | "tema_aprovado" | "post_aprovado";

export type StageMeta = {
  id: ProductionStage;
  /** rótulo pt-BR no sistema */
  label: string;
  /** letra exibida no marcador (a cor nunca é o único indicador) */
  letter: string;
  /** equivale a (planilha): item da legenda e cor */
  sheetLabel: string;
  sheetColor: "vermelho" | "verde" | "amarelo" | "azul" | "magenta";
};

/** Em ordem de avanço. */
export const STAGES: readonly StageMeta[] = [
  { id: "sem_texto", label: "Sem texto", letter: "S", sheetLabel: "Sem texto", sheetColor: "vermelho" },
  { id: "texto_ok", label: "Texto ok", letter: "T", sheetLabel: "Texto ok", sheetColor: "verde" },
  { id: "em_aprovacao", label: "Em aprovação", letter: "E", sheetLabel: "Envio para aprovação", sheetColor: "amarelo" },
  { id: "tema_aprovado", label: "Tema aprovado", letter: "A", sheetLabel: "Texto aprovação ok", sheetColor: "azul" },
  { id: "post_aprovado", label: "Post aprovado", letter: "P", sheetLabel: "Arte aprovação ok", sheetColor: "magenta" },
];

export const STAGE_META = Object.fromEntries(STAGES.map((s) => [s.id, s])) as Record<ProductionStage, StageMeta>;

/** "Sem texto" fica atrasado quando a data está a até N dias (SP). */
export const LATE_NO_TEXT_DAYS = 3;

/** Redes com legenda própria em `Post.captions`, na ordem em que valem como legenda efetiva. */
const CAPTION_NETWORKS = ["instagram", "facebook", "linkedin"] as const;

/**
 * Legenda efetiva de um post — a regra única do sistema (N-18): `caption` (legenda única,
 * legado/importador) quando tem texto; senão o 1º texto de `captions` na ordem instagram →
 * facebook → linkedin. Chave vazia (ou só com espaços) não conta. null = post sem legenda.
 */
export function effectiveCaption(post: { caption?: string | null; captions?: unknown }): string | null {
  if (typeof post.caption === "string" && post.caption.trim() !== "") return post.caption;
  const captions = post.captions;
  if (captions && typeof captions === "object" && !Array.isArray(captions)) {
    for (const network of CAPTION_NETWORKS) {
      const value = (captions as Record<string, unknown>)[network];
      if (typeof value === "string" && value.trim() !== "") return value;
    }
  }
  return null;
}

export type ProductionInput = {
  /** legenda efetiva do post (`effectiveCaption`) */
  caption: string | null | undefined;
  /** Post.slides (Json): [{ text }] */
  slides?: unknown;
  /** cronograma do post (Post.schedule), se houver */
  schedule?: { status: string } | null;
  /** Client.plan: sem_aprovacao | aprovacao_cliente */
  plan: string;
  weeklyReviewId?: string | null;
  clientApproval?: string | null;
};

function hasSlideText(slides: unknown): boolean {
  if (!Array.isArray(slides)) return false;
  return slides.some(
    (s) =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as { text?: unknown }).text === "string" &&
      (s as { text: string }).text.trim() !== ""
  );
}

/** Estágio de produção de um post. */
export function productionStage(input: ProductionInput): ProductionStage {
  if (input.clientApproval === "aprovado") return "post_aprovado";
  const hasText = (input.caption ?? "").trim() !== "" || hasSlideText(input.slides);
  if (!hasText) return "sem_texto";
  if (input.plan !== "aprovacao_cliente") return "texto_ok";
  if (input.weeklyReviewId) return "em_aprovacao";
  const status = input.schedule?.status;
  if (status === "enviado_cliente" || status === "em_revisao") return "em_aprovacao";
  if (status === "aprovado_cliente") return "tema_aprovado";
  return "texto_ok";
}

/** Situação da arte de um post: regra única do sistema (Quadro de Produção e fila /design). */
export type ArtStatus = "feita" | "a_fazer";

/** O que a regra da arte lê do post (campos do Prisma; todos opcionais para aceitar selects parciais). */
export type ArtInput = {
  /** Post.artDoneAt: a designer marcou a arte como feita */
  artDoneAt?: Date | string | null;
  mediaUrl?: string | null;
  /** Post.mediaItems (Json): itens do carrossel */
  mediaItems?: unknown;
  status?: string | null;
};

/**
 * O post tem arte? Regra única (Quadro de Produção, fila de artes, contagens):
 * - a designer marcou a arte como feita (`artDoneAt`), OU
 * - o post já tem mídia (`mediaUrl` com texto ou `mediaItems` lista não vazia), OU
 * - o post foi publicado (a mídia sai do R2 depois de 30 dias e fica só a lembrança).
 */
export function hasArt(post: ArtInput): boolean {
  if (post.artDoneAt) return true;
  if (typeof post.mediaUrl === "string" && post.mediaUrl.trim() !== "") return true;
  if (Array.isArray(post.mediaItems) && post.mediaItems.length > 0) return true;
  return post.status === "published";
}

/** "feita" quando `hasArt`; senão "a_fazer". */
export function artStatus(post: ArtInput): ArtStatus {
  return hasArt(post) ? "feita" : "a_fazer";
}

function asDate(d: Date | string): Date {
  return typeof d === "string" ? new Date(d) : d;
}

/**
 * Prazo de resposta do cliente para um post "em aprovação":
 * no link semanal → prazo do post (`postResponseDeadline`);
 * cronograma enviado/em revisão → dia 25 do mês anterior (`scheduleClientDeadline`).
 * Fora desses casos → null.
 */
export function approvalDeadline(input: {
  scheduledAt: Date | string;
  weeklyReviewId?: string | null;
  schedule?: { status: string; monthRef: Date | string } | null;
}): Date | null {
  if (input.weeklyReviewId) return postResponseDeadline(asDate(input.scheduledAt));
  const s = input.schedule;
  if (s && (s.status === "enviado_cliente" || s.status === "em_revisao")) {
    return scheduleClientDeadline(asDate(s.monthRef));
  }
  return null;
}

/**
 * O post está atrasado?
 * - sem_texto: data (dia civil SP) até hoje + 3 dias, inclusive datas passadas;
 * - em_aprovacao: `responseDeadline` informado e já vencido;
 * - demais estágios: nunca.
 */
export function isLate(
  stage: ProductionStage,
  scheduledAt: Date | string,
  now: Date,
  responseDeadline?: Date | null
): boolean {
  if (stage === "sem_texto") {
    const limit = addDaysToKey(spDateKey(now), LATE_NO_TEXT_DAYS);
    return spDateKey(asDate(scheduledAt)) <= limit;
  }
  if (stage === "em_aprovacao") {
    return !!responseDeadline && now.getTime() > responseDeadline.getTime();
  }
  return false;
}
