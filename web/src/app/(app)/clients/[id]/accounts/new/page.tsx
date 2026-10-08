import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Callout } from "@/components/Callout";
import { uuidString } from "@/lib/validators";
import { PageHeader } from "@/components/ui";
import { NewAccountForm } from "../../AccountsManager";

// Componente de servidor para o título da aba (CC8) e o nome do cliente (U-14); o formulário é client (AccountsManager.tsx).
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/** Nome do cliente para o título da aba e o subtítulo (memorizado no mesmo render). */
const loadClient = cache(async (id: string) =>
  uuidString.safeParse(id).success
    ? prisma.client.findUnique({ where: { id }, select: { id: true, name: true } })
    : null,
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const client = await loadClient(id);
  return { title: client ? `Adicionar conta social · ${client.name}` : "Cliente não encontrado" };
}

export default async function NewAccountPage({ params }: Props) {
  const { id } = await params;
  const client = await loadClient(id);
  if (!client) notFound();
  // adicionar conta de publicação (com token) é só da admin (AC-07); a API também recusa
  const session = await auth();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";

  return (
    <div className="page page--narrow animate-fade-up">
      <PageHeader
        title="Adicionar conta social"
        subtitle={
          <>
            <p className="wrap-break-word font-medium text-fg">{client.name}</p>
            <p className="mt-1">
              Prefira <span className="font-medium text-fg">Importar do Meta</span> na{" "}
              <Link
                href={`/clients/${client.id}#contas`}
                className="text-link underline underline-offset-2 hover:text-link-hover"
              >
                página do cliente
              </Link>
              ; use este formulário só para casos manuais.
            </p>
          </>
        }
        back={`/clients/${client.id}`}
        backLabel="Voltar para o cliente"
      />
      {isAdmin ? (
        <NewAccountForm clientId={client.id} />
      ) : (
        <Callout
          tone="info"
          title="Só administradoras podem adicionar contas"
          action={
            <Link href={`/clients/${client.id}#contas`} className="inline-flex min-h-11 items-center font-medium sm:min-h-10">
              Voltar para o cliente
            </Link>
          }
        >
          Contas de publicação guardam o token de acesso à rede social. Para adicionar ou trocar uma conta, peça a uma
          administradora.
        </Callout>
      )}
    </div>
  );
}
