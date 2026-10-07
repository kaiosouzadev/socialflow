import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { readTextModelInfo } from "@/lib/ai-models";
import AiModelSettings from "./AiModelSettings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Modelos de IA" };

export default async function AiModelsPage() {
  const session = await auth();
  // configuração do sistema: exclusiva de administradores (como Usuários e Conexões Meta)
  if ((session?.user as { role?: string } | undefined)?.role !== "admin") {
    redirect("/");
  }

  const info = await readTextModelInfo();

  return (
    <div className="page page--narrow">
      <AiModelSettings initial={info} />
    </div>
  );
}
