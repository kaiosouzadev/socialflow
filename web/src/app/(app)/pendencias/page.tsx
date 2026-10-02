import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { PENDING_KINDS, type PendingKind } from "@/lib/status-meta";
import { spDateKey } from "@/lib/deadlines";
import { TZ } from "@/lib/format-date";
import { formatLabel } from "@/lib/formats";
import PendingManager, { type PendingFilterValues, type PendingRow } from "./PendingManager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Pendências" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86_400_000;
/** Aberta há mais que isso → destaque "parada" [RD §2.2.5: stand-by de fevereiro ainda aberto em outubro]. */
const STALE_DAYS = 30;
/** Mesmo teto do GET /api/pending-items. */
const MAX_ITEMS = 500;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Dias civis (fuso SP) entre duas chaves "AAAA-MM-DD". */
function civilDaysBetween(fromKey: string, toKey: string): number {
  const utc = (k: string) => Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));
  return Math.round((utc(toKey) - utc(fromKey)) / DAY);
}

const DAY_MONTH = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });

/** "12/10" no fuso SP; com o ano quando não é o ano corrente ("12/10/2025"). */
function shortDate(d: Date, todayKey: string): string {
  return spDateKey(d).slice(0, 4) === todayKey.slice(0, 4) ? DAY_MONTH.format(d) : DAY_MONTH_YEAR.format(d);
}

function ageLabel(days: number): string {
  if (days <= 0) return "hoje";
  return days === 1 ? "há 1 dia" : `há ${days} dias`;
}

export default async function PendenciasPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  // Listas dos filtros e dos diálogos. Usuários: só id e nome (nunca e-mail/hash);
  // /api/users é só de admin, então a lista sai daqui para a redação (staff) também.
  const [clients, users] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  clients.sort(byName);
  users.sort(byName);

  // Filtros na URL; valor inválido ou desconhecido é ignorado.
  const rawCliente = first(sp.cliente);
  const rawTipo = first(sp.tipo);
  const rawResponsavel = first(sp.responsavel);
  const values: PendingFilterValues = {
    cliente: UUID_RE.test(rawCliente) && clients.some((c) => c.id === rawCliente) ? rawCliente : "",
    tipo: (PENDING_KINDS as readonly string[]).includes(rawTipo) ? (rawTipo as PendingKind) : "",
    responsavel: UUID_RE.test(rawResponsavel) && users.some((u) => u.id === rawResponsavel) ? rawResponsavel : "",
    situacao: first(sp.situacao) === "resolvidas" ? "resolvidas" : "abertas",
  };
  const resolvedView = values.situacao === "resolvidas";

  const where: Prisma.PendingItemWhereInput = {
    ...(values.cliente ? { clientId: values.cliente } : {}),
    ...(values.tipo ? { kind: values.tipo } : {}),
    ...(values.responsavel ? { responsibleUserId: values.responsavel } : {}),
    resolvedAt: resolvedView ? { not: null } : null,
  };

  const items = await prisma.pendingItem.findMany({
    where,
    // abertas: a mais antiga primeiro (a parada há mais tempo no topo); resolvidas: a mais recente primeiro
    orderBy: resolvedView ? [{ resolvedAt: "desc" }, { id: "desc" }] : [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_ITEMS,
    select: {
      id: true,
      kind: true,
      title: true,
      details: true,
      createdAt: true,
      resolvedAt: true,
      client: { select: { id: true, name: true } },
      responsible: { select: { id: true, name: true } },
      post: { select: { id: true, scheduledAt: true, format: true } },
    },
  });

  const todayKey = spDateKey(new Date());
  const rows: PendingRow[] = items.map((item) => {
    const ageDays = Math.max(0, civilDaysBetween(spDateKey(item.createdAt), todayKey));
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      details: item.details,
      client: item.client,
      responsible: item.responsible,
      post: item.post
        ? {
            id: item.post.id,
            dateLabel: shortDate(item.post.scheduledAt, todayKey),
            label: `${shortDate(item.post.scheduledAt, todayKey)} · ${formatLabel(item.post.format)}`,
          }
        : null,
      resolved: item.resolvedAt !== null,
      resolvedLabel: item.resolvedAt ? `Resolvida em ${shortDate(item.resolvedAt, todayKey)}` : null,
      ageDays,
      ageLabel: ageLabel(ageDays),
      stale: item.resolvedAt === null && ageDays > STALE_DAYS,
    };
  });

  return (
    <div className="page">
      <PendingManager
        rows={rows}
        values={values}
        clients={clients}
        users={users}
        truncated={items.length === MAX_ITEMS}
      />
    </div>
  );
}
