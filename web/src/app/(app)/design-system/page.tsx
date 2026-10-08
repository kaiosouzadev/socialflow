import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/api-auth";
import DesignSystemCatalog from "./DesignSystemCatalog";

/*
 * /design-system — catálogo dos componentes (bancada de testes da equipe de desenvolvimento).
 * Fora do menu e sem dado real. Em produção não existe (404), a não ser que
 * DESIGN_SYSTEM_ENABLED=1; fora dela, só administradoras (as demais recebem 404).
 * O papel é o do banco (getSessionUser → sessão revalidada).
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Design system" };

function designSystemEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.DESIGN_SYSTEM_ENABLED === "1";
}

export default async function DesignSystemPage() {
  if (!designSystemEnabled()) notFound();
  const user = await getSessionUser();
  if (user?.role !== "admin") notFound();
  return <DesignSystemCatalog />;
}
