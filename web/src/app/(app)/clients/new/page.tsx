import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { NewClientForm } from "../[id]/ClientInfoEditor";

export const dynamic = "force-dynamic";

// Componente de servidor: GET /api/users é só para admin, então a lista de
// redatoras é lida aqui e passada ao formulário (que é "use client").
// O título da aba vem do layout.tsx do segmento.
export default async function NewClientPage() {
  const users = await prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });

  return (
    <div className="page page--narrow">
      <PageHeader title="Novo cliente" back="/clients" backLabel="Voltar para clientes" />
      <NewClientForm users={users} />
    </div>
  );
}
