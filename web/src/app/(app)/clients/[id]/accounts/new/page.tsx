import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { NewAccountForm } from "../../AccountsManager";

// Componente de servidor só para o título da aba (CC8); o formulário é client (AccountsManager.tsx).
export const metadata: Metadata = { title: "Adicionar conta social" };

export default async function NewAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;

  return (
    <div className="page page--narrow animate-fade-up">
      <PageHeader title="Adicionar conta social" back={`/clients/${clientId}`} backLabel="Voltar para o cliente" />
      <NewAccountForm clientId={clientId} />
    </div>
  );
}
