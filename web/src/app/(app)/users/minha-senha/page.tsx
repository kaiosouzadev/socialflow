import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import OwnPasswordForm from "./OwnPasswordForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Minha senha" };

/** A própria usuária troca a senha (qualquer papel). O layout já barra sessão inválida. */
export default async function OwnPasswordPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const isAdmin = (session.user as { role?: string }).role === "admin";

  return (
    <div className="page">
      <PageHeader
        title="Minha senha"
        subtitle={session.user.email ?? undefined}
        back={isAdmin ? "/users" : undefined}
        backLabel="Voltar para Usuários"
      />
      <OwnPasswordForm email={session.user.email ?? ""} name={session.user.name ?? ""} />
    </div>
  );
}
