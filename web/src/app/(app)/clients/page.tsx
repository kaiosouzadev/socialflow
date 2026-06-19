import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/ui";
import { Icon } from "@/components/Icons";

export const dynamic = "force-dynamic";

const planLabel: Record<string, string> = {
  sem_aprovacao: "Auto-publicação",
  aprovacao_cliente: "Com aprovação",
};

export default async function ClientsPage() {
  const clients = await prisma.client.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { socialAccounts: true, posts: true } } },
  });

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-up">
      <PageHeader
        title="Clientes"
        subtitle={`${clients.length} cliente${clients.length !== 1 ? "s" : ""} cadastrado${clients.length !== 1 ? "s" : ""}`}
        action={
          <Link href="/clients/new" className="btn-primary">
            <Icon.plus className="w-4 h-4" />
            Novo cliente
          </Link>
        }
      />

      {clients.length === 0 ? (
        <EmptyState
          title="Nenhum cliente ainda"
          description="Cadastre o primeiro cliente para começar a agendar posts."
          action={
            <Link href="/clients/new" className="btn-primary">
              <Icon.plus className="w-4 h-4" />
              Cadastrar cliente
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {clients.map((c) => (
            <Link
              key={c.id}
              href={`/clients/${c.id}`}
              className="card glass-hover p-5 group"
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-base font-semibold text-white shrink-0"
                  style={{ background: "linear-gradient(135deg,#7c5cff,#ec4899)" }}
                >
                  {c.name[0]?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate group-hover:text-white transition-colors">
                    {c.name}
                  </p>
                  <p className="text-xs text-[var(--color-text-faint)] truncate">{c.email}</p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs px-2 py-1 rounded-md bg-white/[0.04] border border-[var(--color-border)] text-[var(--color-text-muted)]">
                  {planLabel[c.plan] ?? c.plan}
                </span>
                <div className="flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
                  <span className="flex items-center gap-1.5">
                    <Icon.link className="w-3.5 h-3.5" />
                    {c._count.socialAccounts}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Icon.calendar className="w-3.5 h-3.5" />
                    {c._count.posts}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
