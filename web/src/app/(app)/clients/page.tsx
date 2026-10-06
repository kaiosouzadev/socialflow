import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader, EmptyState } from "@/components/ui";
import { buttonClasses } from "@/components/Button";
import { Icon } from "@/components/Icons";
import ClientsTable, { type ClientRow } from "./ClientsTable";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Clientes" };

function countLabel(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export default async function ClientsPage() {
  const [clients, users] = await Promise.all([
    prisma.client.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        extraEmails: true,
        logoUrl: true,
        brandColor: true,
        plan: true,
        tier: true,
        agencyPublishes: true,
        status: true,
        segment: true,
        responsibleUserId: true,
        designerUserId: true,
      },
    }),
    // GET /api/users é só para admin: a lista de redatoras e designers vem do servidor
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const byStatus = { ativo: 0, pausado: 0, encerrado: 0 } as Record<string, number>;
  for (const c of clients) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  const subtitle = [
    countLabel(byStatus.ativo ?? 0, "ativo", "ativos"),
    byStatus.pausado ? countLabel(byStatus.pausado, "pausado", "pausados") : null,
    byStatus.encerrado ? countLabel(byStatus.encerrado, "encerrado", "encerrados") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const rows: ClientRow[] = clients;

  return (
    <div className="page">
      <PageHeader
        title="Clientes"
        subtitle={clients.length === 0 ? "Nenhum cliente cadastrado" : subtitle}
        action={
          <Link href="/clients/new" className={buttonClasses({ variant: "primary" })}>
            <span aria-hidden="true" className="inline-flex size-4.5 [&>svg]:size-full">
              <Icon.plus />
            </span>
            Novo cliente
          </Link>
        }
      />

      {clients.length === 0 ? (
        <EmptyState
          title="Nenhum cliente ainda"
          description="Cadastre o primeiro cliente para começar a produzir e agendar posts."
          headingLevel={2}
          action={
            <Link href="/clients/new" className={buttonClasses({ variant: "primary" })}>
              Novo cliente
            </Link>
          }
        />
      ) : (
        <ClientsTable clients={rows} users={users} />
      )}
    </div>
  );
}
