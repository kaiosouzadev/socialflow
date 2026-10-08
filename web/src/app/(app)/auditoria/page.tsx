import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { buttonClasses } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { Icon } from "@/components/Icons";
import { EmptyState, PageHeader, ToneBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/format-date";
import type { Tone } from "@/lib/status-meta";
import {
  AUDIT_ACTION_LABELS,
  listAuditEvents,
  parseAuditFilters,
  type AuditFilters,
  type AuditItem,
} from "@/lib/audit-query";
import AuditFiltersForm from "./AuditFilters";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Registro de ações" };

/** Tom do selo da ação: exclusão = perigo; senhas = atenção; configuração = informação. */
function actionTone(action: string): Tone {
  if (action.endsWith("delete")) return "danger";
  if (action.startsWith("credential.")) return "warning";
  if (action.startsWith("settings.") || action.startsWith("user.")) return "info";
  return "neutral";
}

/** /auditoria com os filtros atuais e `over` por cima (página volta à 1 se não vier). */
function pageHref(f: AuditFilters, page: number) {
  const params = new URLSearchParams();
  const entries: [string, string | undefined][] = [
    ["acao", f.action],
    ["pessoa", f.actorId],
    ["cliente", f.clientId],
    ["de", f.from],
    ["ate", f.to],
    ["pagina", page > 1 ? String(page) : undefined],
  ];
  for (const [k, v] of entries) if (v) params.set(k, v);
  return `/auditoria${params.size ? `?${params}` : ""}`;
}

function Actor({ item }: { item: AuditItem }) {
  if (item.actorName) return <span className="font-medium text-fg">{item.actorName}</span>;
  if (item.actorEmail) {
    return (
      <span className="text-fg">
        {item.actorEmail} <span className="text-fg-muted">(usuário excluído)</span>
      </span>
    );
  }
  return <span className="text-fg-muted">Sistema</span>;
}

function ClientCell({ item }: { item: AuditItem }) {
  if (!item.clientId) return <span className="text-fg-muted">—</span>;
  if (item.clientDeleted) {
    return (
      <span className="text-fg">
        {item.clientName ?? "Cliente"} <span className="text-fg-muted">(excluído)</span>
      </span>
    );
  }
  return (
    <Link
      href={`/clients/${item.clientId}`}
      className="inline-flex min-h-11 items-center font-medium text-link hover:text-link-hover hover:underline sm:min-h-10"
    >
      {item.clientName ?? "Cliente"}
    </Link>
  );
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  // registro de segurança: exclusivo de administradores (como Usuários e Modelos de IA)
  if ((session?.user as { role?: string } | undefined)?.role !== "admin") {
    redirect("/");
  }

  const { filters, invalid } = parseAuditFilters(await searchParams);

  let data: Awaited<ReturnType<typeof listAuditEvents>> | null = null;
  let users: { id: string; name: string }[] = [];
  let clients: { id: string; name: string }[] = [];
  try {
    [data, users, clients] = await Promise.all([
      listAuditEvents(filters),
      prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);
    // página além da última (ex.: link antigo): mostra a última
    if (data && data.total > 0 && data.items.length === 0 && filters.page > data.totalPages) {
      data = await listAuditEvents({ ...filters, page: data.totalPages });
    }
  } catch (e) {
    console.error("[auditoria] falha ao carregar", (e as { code?: unknown } | null)?.code ?? "erro");
    data = null;
  }

  const filtered = !!(filters.action || filters.actorId || filters.clientId || filters.from || filters.to);
  const actions = Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => ({ value, label }));
  const page = data?.page ?? 1;
  const from = data && data.total > 0 ? (page - 1) * data.pageSize + 1 : 0;
  const to = data ? from + data.items.length - 1 : 0;

  const subtitle = !data
    ? "Quem fez o quê e quando nas ações sensíveis."
    : data.total === 0
      ? filtered
        ? "Nenhuma ação com esses filtros"
        : "Nenhuma ação registrada ainda"
      : `${data.total.toLocaleString("pt-BR")} ${data.total === 1 ? "ação registrada" : "ações registradas"}${
          filtered ? " com esses filtros" : ""
        } · mais recentes primeiro`;

  return (
    <div className="page animate-fade-up">
      <PageHeader title="Registro de ações" subtitle={subtitle} />

      <p className="mb-4 max-w-prose text-sm text-fg-muted">
        Ações sensíveis ficam registradas aqui: revelar ou alterar senhas de clientes, excluir clientes e posts publicados,
        trocar contas de publicação, aprovar cronograma sem o cliente e mudanças de usuários e de IA. Senhas e tokens
        nunca são gravados.
      </p>

      <AuditFiltersForm
        actions={actions}
        users={users}
        clients={clients}
        current={{
          action: filters.action ?? "",
          actorId: filters.actorId ?? "",
          clientId: filters.clientId ?? "",
          from: filters.from ?? "",
          to: filters.to ?? "",
        }}
      />

      {invalid.length > 0 && (
        <Callout tone="warning" className="mb-4">
          Alguns filtros do endereço não eram válidos e foram ignorados.
        </Callout>
      )}

      {!data ? (
        <EmptyState
          tone="error"
          headingLevel={2}
          icon={<Icon.alert />}
          title="Não foi possível carregar o registro"
          description="Tente de novo em instantes. Se continuar, avise o responsável pelo servidor."
        />
      ) : data.items.length === 0 ? (
        <EmptyState
          headingLevel={2}
          icon={<Icon.clock />}
          title={filtered ? "Nenhuma ação com esses filtros" : "Nenhuma ação registrada ainda"}
          description={
            filtered
              ? "Mude os filtros ou limpe todos para ver as últimas ações."
              : "Quando alguém revelar senhas, excluir um cliente ou trocar uma conta, a ação aparece aqui."
          }
          action={
            filtered ? (
              <Link href="/auditoria" className={buttonClasses({ variant: "ghost" })}>
                Limpar filtros
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* ≥ lg: tabela */}
          <div className="card hidden overflow-hidden lg:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Ações registradas, das mais recentes para as mais antigas</caption>
              <thead className="bg-sunken">
                <tr>
                  {["Quando", "Quem", "Ação", "Cliente", "Detalhes"].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-overline text-fg-muted"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} className="border-t border-line align-top">
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-fg-muted">
                      <time dateTime={item.at}>{formatDateTime(item.at)}</time>
                      {item.ip && <div className="mt-0.5 text-xs">IP {item.ip}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <Actor item={item} />
                    </td>
                    <td className="px-4 py-3">
                      <ToneBadge tone={actionTone(item.action)}>{item.actionLabel}</ToneBadge>
                    </td>
                    <td className="px-4 py-3">
                      <ClientCell item={item} />
                    </td>
                    <td className="max-w-md px-4 py-3 wrap-break-word text-fg">{item.summary || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* < lg: cartões */}
          <ul className="grid gap-3 lg:hidden">
            {data.items.map((item) => (
              <li key={item.id} className="card grid gap-2 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ToneBadge tone={actionTone(item.action)}>{item.actionLabel}</ToneBadge>
                  <time dateTime={item.at} className="tabular-nums text-fg-muted">
                    {formatDateTime(item.at)}
                  </time>
                </div>
                <p>
                  <span className="text-fg-muted">Quem: </span>
                  <Actor item={item} />
                </p>
                {item.clientId && (
                  <p className="flex flex-wrap items-center gap-x-1">
                    <span className="text-fg-muted">Cliente: </span>
                    <ClientCell item={item} />
                  </p>
                )}
                {item.summary && <p className="wrap-break-word text-fg">{item.summary}</p>}
                {item.ip && <p className="text-xs text-fg-muted">IP {item.ip}</p>}
              </li>
            ))}
          </ul>

          {data.totalPages > 1 && (
            <nav aria-label="Paginação" className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm tabular-nums text-fg-muted">
                Mostrando <span className="font-medium text-fg">{from}</span>–<span className="font-medium text-fg">{to}</span>{" "}
                de <span className="font-medium text-fg">{data.total}</span>
              </p>
              <div className="flex items-center gap-2">
                {page > 1 && (
                  <Link href={pageHref(filters, page - 1)} className={buttonClasses({ variant: "secondary" })}>
                    <Icon.chevronLeft className="size-4 shrink-0" />
                    Mais recentes
                  </Link>
                )}
                {page < data.totalPages && (
                  <Link href={pageHref(filters, page + 1)} className={buttonClasses({ variant: "secondary" })}>
                    Mais antigas
                    <Icon.chevronRight className="size-4 shrink-0" />
                  </Link>
                )}
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
