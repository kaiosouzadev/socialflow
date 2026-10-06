import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { dateWindow, isRangeKind, spDateKey, type RangeKind } from "@/lib/date-range";
import { OVERDUE_MINUTES, STUCK_MINUTES } from "@/lib/queue-health";
import { QUEUEABLE_CLIENT } from "@/lib/publish-guard";

/**
 * Consulta da lista /posts, compartilhada pela página e por GET /api/posts/ids (U-19, U-37).
 *
 * Períodos: os do lib/date-range (dia, semana, mês, todas) + "upcoming" = "Próximos", o padrão:
 * de hoje em diante (00:00 de SP), em ordem crescente, com um grupo FIXO NO TOPO de posts que
 * precisam de atenção — os que falharam (qualquer data) e os agendados que passaram da hora sem
 * sair (mesmos limites do Dashboard/WF-03; só clientes que publicam pela agência).
 *
 * A página fica em duas consultas por grupo (topo e resto) fatiadas por `planPage`, o que mantém
 * a paginação estável e a ordem "topo → resto" igual na tela e na seleção "todos deste filtro".
 */

export type ListRange = RangeKind | "upcoming";

export const PAGE_SIZE = 25;

/** Máximo da seleção "todos deste filtro" (o mesmo limite do POST /api/posts/bulk-delete). */
export const BULK_LIMIT = 500;

export type RawListParams = Partial<
  Record<"clientId" | "status" | "q" | "range" | "ref" | "scheduleId" | "noted", string | undefined>
>;

export type ListParams = {
  clientId?: string;
  status?: string;
  q: string;
  range: ListRange;
  /** YYYY-MM-DD de referência de dia/semana/mês (hoje em SP quando falta ou é inválida) */
  ref: string;
  scheduleId?: string;
  /** vindo de Aprovações: só os posts que o cliente comentou */
  onlyNoted: boolean;
};

export function isListRange(v: string | undefined): v is ListRange {
  return v === "upcoming" || isRangeKind(v);
}

/**
 * Sem `range` na URL: "Próximos". A exceção é o atalho de Aprovações (scheduleId/noted): ali o
 * recorte já é o cronograma inteiro, então o padrão é "Todas" (senão os dias passados sumiriam).
 */
export function defaultRange(sp: Pick<RawListParams, "scheduleId" | "noted">): ListRange {
  return sp.scheduleId || sp.noted === "1" ? "all" : "upcoming";
}

export function parseListParams(sp: RawListParams, today = spDateKey()): ListParams {
  return {
    clientId: sp.clientId || undefined,
    status: sp.status || undefined,
    q: sp.q?.trim() ?? "",
    range: isListRange(sp.range) ? sp.range : defaultRange(sp),
    ref: sp.ref && /^\d{4}-\d{2}-\d{2}$/.test(sp.ref) ? sp.ref : today,
    scheduleId: sp.scheduleId || undefined,
    onlyNoted: sp.noted === "1",
  };
}

/** Query string que reproduz a lista (para GET /api/posts/ids); o período vai sempre explícito. */
export function listQueryString(p: ListParams): string {
  const params = new URLSearchParams();
  if (p.clientId) params.set("clientId", p.clientId);
  if (p.status) params.set("status", p.status);
  if (p.q) params.set("q", p.q);
  params.set("range", p.range);
  if (p.range !== "all" && p.range !== "upcoming") params.set("ref", p.ref);
  if (p.scheduleId) params.set("scheduleId", p.scheduleId);
  if (p.onlyNoted) params.set("noted", "1");
  return params.toString();
}

export type ListQuery = {
  /** grupo fixo no topo (só em "Próximos"); null nos outros períodos */
  pinned: Prisma.PostWhereInput | null;
  /** o resto da lista, depois do grupo fixo */
  main: Prisma.PostWhereInput;
  orderBy: Prisma.PostOrderByWithRelationInput[];
};

/** Precisa de atenção: falhou, ou agendado/em publicação que passou da hora sem sair. */
export function attentionWhere(now: Date): Prisma.PostWhereInput {
  return {
    OR: [
      { status: "failed" },
      {
        status: "scheduled",
        scheduledAt: { lt: new Date(now.getTime() - OVERDUE_MINUTES * 60_000) },
        client: { is: QUEUEABLE_CLIENT },
      },
      {
        status: "publishing",
        scheduledAt: { lt: new Date(now.getTime() - STUCK_MINUTES * 60_000) },
        client: { is: QUEUEABLE_CLIENT },
      },
    ],
  };
}

/** O mesmo critério de `attentionWhere`, para marcar a linha ("Atrasado"). */
export function isOverdue(
  post: { status: string; scheduledAt: Date; client?: { agencyPublishes?: boolean } | null },
  now: Date
): boolean {
  if (post.client?.agencyPublishes === false) return false;
  const late = now.getTime() - post.scheduledAt.getTime();
  if (post.status === "scheduled") return late > OVERDUE_MINUTES * 60_000;
  if (post.status === "publishing") return late > STUCK_MINUTES * 60_000;
  return false;
}

export function buildListQuery(p: ListParams, now = new Date()): ListQuery {
  // Busca por tema OU cliente (A-031). Com um cliente já escolhido no select, o nome do
  // cliente casaria todos os posts dele: aí a busca é só pelo tema.
  const contains = { contains: p.q, mode: "insensitive" as const };
  const search: Prisma.PostWhereInput | null = !p.q
    ? null
    : p.clientId
      ? { theme: contains }
      : { OR: [{ theme: contains }, { client: { is: { name: contains } } }] };

  const base: Prisma.PostWhereInput = {
    ...(p.clientId ? { clientId: p.clientId } : {}),
    ...(p.status ? { status: p.status } : {}),
    ...(p.scheduleId ? { scheduleId: p.scheduleId } : {}),
    ...(p.onlyNoted ? { clientNote: { not: null } } : {}),
    ...(search ?? {}),
  };

  // id como desempate: posts no mesmo horário não trocam de página entre uma carga e outra
  if (p.range === "all") {
    return { pinned: null, main: base, orderBy: [{ scheduledAt: "desc" }, { id: "asc" }] };
  }
  const asc: Prisma.PostOrderByWithRelationInput[] = [{ scheduledAt: "asc" }, { id: "asc" }];

  if (p.range === "upcoming") {
    const attention = attentionWhere(now);
    const startOfToday = dateWindow("day", spDateKey(now))!.gte;
    return {
      pinned: { AND: [base, attention] },
      main: { AND: [base, { scheduledAt: { gte: startOfToday } }, { NOT: attention }] },
      orderBy: asc,
    };
  }

  const win = dateWindow(p.range, p.ref)!;
  return { pinned: null, main: { AND: [base, { scheduledAt: { gte: win.gte, lt: win.lt } }] }, orderBy: asc };
}

export type Slice = { skip: number; take: number };

/**
 * Fatias de uma página quando a lista tem um grupo fixo no topo com `pinnedTotal` posts:
 * o que sai do grupo fixo e o que sai do resto (null = nada daquele grupo nesta página).
 */
export function planPage(pinnedTotal: number, page: number, pageSize = PAGE_SIZE): { pinned: Slice | null; main: Slice | null } {
  const start = (Math.max(1, page) - 1) * pageSize;
  const end = start + pageSize;
  const pinned = start < pinnedTotal ? { skip: start, take: Math.min(end, pinnedTotal) - start } : null;
  const mainTake = end - Math.max(start, pinnedTotal);
  const main = mainTake > 0 ? { skip: Math.max(0, start - pinnedTotal), take: mainTake } : null;
  return { pinned, main };
}

/** Totais dos dois grupos. */
export async function countList(q: ListQuery): Promise<{ pinned: number; main: number }> {
  const [pinned, main] = await Promise.all([
    q.pinned ? prisma.post.count({ where: q.pinned }) : Promise.resolve(0),
    prisma.post.count({ where: q.main }),
  ]);
  return { pinned, main };
}

/** Linhas de uma página, na ordem da tela; `pinned` marca as do grupo fixo no topo. */
export async function fetchListPage(q: ListQuery, pinnedTotal: number, page: number) {
  const plan = planPage(q.pinned ? pinnedTotal : 0, page);
  const find = (where: Prisma.PostWhereInput, s: Slice) =>
    prisma.post.findMany({
      where,
      orderBy: q.orderBy,
      skip: s.skip,
      take: s.take,
      include: { client: { select: { name: true, agencyPublishes: true } } },
    });
  const [top, rest] = await Promise.all([
    q.pinned && plan.pinned ? find(q.pinned, plan.pinned) : Promise.resolve([]),
    plan.main ? find(q.main, plan.main) : Promise.resolve([]),
  ]);
  return [...top.map((post) => ({ post, pinned: true })), ...rest.map((post) => ({ post, pinned: false }))];
}

/** "Todos os M deste filtro": id e status, na ordem da lista, no máximo BULK_LIMIT. */
export async function fetchFilterItems(q: ListQuery, limit = BULK_LIMIT): Promise<{ id: string; status: string }[]> {
  const select = { id: true, status: true } as const;
  const top = q.pinned ? await prisma.post.findMany({ where: q.pinned, orderBy: q.orderBy, take: limit, select }) : [];
  const left = limit - top.length;
  const rest = left > 0 ? await prisma.post.findMany({ where: q.main, orderBy: q.orderBy, take: left, select }) : [];
  return [...top, ...rest];
}
