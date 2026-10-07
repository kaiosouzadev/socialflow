/**
 * Lógica pura da página /aprovacoes (F13): grupos da lista, ordem pela última atividade,
 * selo "Novo"/"Atualizado hoje", filtros da URL e a separação dos cronogramas sem posts.
 * Sem React, sem Prisma: serve ao componente de servidor, ao de cliente e aos testes
 * (tests/unit/aprovacoes-view.test.ts).
 */
import { spDateKey } from "../../../lib/deadlines.ts";
import { SCHEDULE_STATUS, SCHEDULE_STATUSES } from "../../../lib/status-meta.ts";

/* ------------------------------------------------------------------ *
 * Grupos
 * ------------------------------------------------------------------ */

export type ScheduleGroup = "acao" | "cliente" | "aprovados";
export const GROUP_ORDER: readonly ScheduleGroup[] = ["acao", "cliente", "aprovados"];
export const GROUP_META: Record<ScheduleGroup, { title: string; hint: string }> = {
  acao: {
    title: "Precisa de ação",
    hint: "Rascunhos para enviar ou aprovar e cronogramas com ajustes pedidos pelo cliente.",
  },
  cliente: {
    title: "Aguardando o cliente",
    hint: "Enviados para aprovação. O cliente ainda não respondeu.",
  },
  aprovados: {
    title: "Aprovados",
    hint: "Aprovados pelo cliente ou pela equipe.",
  },
};

/** Aprovados visíveis antes do "Ver todos" (sem filtro ativo). */
export const APPROVED_PREVIEW = 5;

/** Grupo do status: enviado → com o cliente; aprovado → aprovados; o resto pede ação da equipe. */
export function groupOf(status: string): ScheduleGroup {
  if (status === "enviado_cliente") return "cliente";
  if (status === "aprovado_cliente") return "aprovados";
  return "acao";
}

/* ------------------------------------------------------------------ *
 * Última atividade e selo de recência
 * ------------------------------------------------------------------ */

export const DAY_MS = 86_400_000;

export type ActivityInput = {
  createdAt: Date;
  sentAt: Date | null;
  approvedAt: Date | null;
  changesAskedAt: Date | null;
  /** createdAt do post mais novo do cronograma (null = sem posts) */
  latestPostAt: Date | null;
};

/** Máximo entre a criação do cronograma, envio, aprovação, pedido de ajuste e o post mais novo. */
export function lastActivity(a: ActivityInput): Date {
  let max = a.createdAt.getTime();
  for (const d of [a.sentAt, a.approvedAt, a.changesAskedAt, a.latestPostAt]) {
    if (d && d.getTime() > max) max = d.getTime();
  }
  return new Date(max);
}

/**
 * "novo": cronograma criado há menos de 24 h, ou com posts novos (criados há menos de 24 h) —
 * é o calendário que acabou de ser salvo, mesmo quando entrou num cronograma antigo do mês.
 * "atualizado": outra atividade (envio, aprovação, pedido de ajuste) hoje, no fuso de SP.
 */
export type Freshness = "novo" | "atualizado" | null;

export function freshnessOf(a: ActivityInput, now: Date): Freshness {
  const within24h = (d: Date | null) => !!d && now.getTime() - d.getTime() < DAY_MS && d.getTime() <= now.getTime() + 60_000;
  if (within24h(a.createdAt) || within24h(a.latestPostAt)) return "novo";
  return spDateKey(lastActivity(a)) === spDateKey(now) ? "atualizado" : null;
}

export const FRESHNESS_LABEL: Record<Exclude<Freshness, null>, string> = {
  novo: "Novo",
  atualizado: "Atualizado hoje",
};

/* ------------------------------------------------------------------ *
 * Filtros da URL (?q=&mes=&status=)
 * ------------------------------------------------------------------ */

export type ScheduleFilters = {
  /** busca por cliente (texto livre) */
  q: string;
  /** "AAAA-MM" ou "" */
  mes: string;
  /** um de SCHEDULE_STATUSES ou "" */
  status: string;
};

export const NO_FILTERS: ScheduleFilters = { q: "", mes: "", status: "" };
const MAX_QUERY = 80;

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Valores inválidos viram "sem filtro" (nunca erro). */
export function parseScheduleFilters(sp: SearchParams): ScheduleFilters {
  const q = first(sp.q).trim().slice(0, MAX_QUERY);
  const mes = first(sp.mes);
  const status = first(sp.status);
  return {
    q,
    mes: /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? mes : "",
    status: (SCHEDULE_STATUSES as readonly string[]).includes(status) ? status : "",
  };
}

/** "?q=…&mes=…&status=…" sem os vazios; "" sem filtro. */
export function filtersQuery(f: ScheduleFilters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.mes) p.set("mes", f.mes);
  if (f.status) p.set("status", f.status);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function hasActiveFilters(f: ScheduleFilters): boolean {
  return !!(f.q.trim() || f.mes || f.status);
}

/** Minúsculas e sem acento: "José" casa com "jose". */
export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

export function matchesFilters(row: { client: string; monthKey: string; status: string }, f: ScheduleFilters): boolean {
  if (f.mes && row.monthKey !== f.mes) return false;
  if (f.status && row.status !== f.status) return false;
  const q = normalizeText(f.q);
  if (q && !normalizeText(row.client).includes(q)) return false;
  return true;
}

export const STATUS_OPTIONS: readonly { value: string; label: string }[] = SCHEDULE_STATUSES.map((s) => ({
  value: s,
  label: SCHEDULE_STATUS[s].label,
}));

/** Meses que existem na lista, do mais novo para o mais antigo ({ "2026-11", "Novembro de 2026" }). */
export function monthOptions(rows: readonly { monthKey: string; month: string }[]): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const r of rows) if (!seen.has(r.monthKey)) seen.set(r.monthKey, r.month);
  return [...seen.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([value, label]) => ({ value, label }));
}

/* ------------------------------------------------------------------ *
 * Montagem da lista
 * ------------------------------------------------------------------ */

export type ViewRow = {
  id: string;
  client: string;
  monthKey: string;
  status: string;
  posts: number;
  /** ms da última atividade (lastActivity) */
  lastActivity: number;
};

/** Mais recente primeiro pela última atividade; empate: cliente (A→Z), depois mês mais novo. */
export function compareByActivity(a: ViewRow, b: ViewRow): number {
  return (
    b.lastActivity - a.lastActivity ||
    a.client.localeCompare(b.client, "pt-BR", { sensitivity: "base" }) ||
    b.monthKey.localeCompare(a.monthKey)
  );
}

export type ScheduleView<T extends ViewRow> = {
  /** só os grupos com cronogramas, na ordem de GROUP_ORDER */
  groups: { id: ScheduleGroup; rows: T[] }[];
  /** cronogramas sem posts que passam nos filtros (seção recolhida no fim) */
  empty: T[];
  /** com posts, antes dos filtros */
  total: number;
  /** com posts, depois dos filtros */
  shown: number;
};

/** Separa os vazios, aplica os filtros, agrupa e ordena cada grupo pela última atividade. */
export function buildScheduleView<T extends ViewRow>(rows: readonly T[], f: ScheduleFilters): ScheduleView<T> {
  const withPosts = rows.filter((r) => r.posts > 0);
  const visible = withPosts.filter((r) => matchesFilters(r, f));
  const groups = GROUP_ORDER.map((id) => ({
    id,
    rows: visible.filter((r) => groupOf(r.status) === id).sort(compareByActivity),
  })).filter((g) => g.rows.length > 0);
  const empty = rows.filter((r) => r.posts === 0 && matchesFilters(r, f)).sort(compareByActivity);
  return { groups, empty, total: withPosts.length, shown: visible.length };
}

/** "1 cronograma" · "N cronogramas"; com filtro: "3 de 12 cronogramas". */
export function countLabel(shown: number, total: number, filtered: boolean): string {
  const noun = (n: number) => (n === 1 ? "cronograma" : "cronogramas");
  return filtered && shown !== total ? `${shown} de ${total} ${noun(total)}` : `${shown} ${noun(shown)}`;
}
