import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import MetaConnectionsManager from "./MetaConnectionsManager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Conexões Meta" };

export default async function MetaPage() {
  const session = await auth();
  if ((session?.user as { role?: string } | undefined)?.role !== "admin") {
    redirect("/");
  }

  const connections = await prisma.metaConnection.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      businessId: true,
      status: true,
      createdAt: true,
      _count: { select: { socialAccounts: true } },
    },
  });

  const initial = connections.map((c) => ({
    id: c.id,
    name: c.name,
    businessId: c.businessId,
    status: c.status,
    accounts: c._count.socialAccounts,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <div className="page">
      {/* o PageHeader (com "Nova conexão") fica no MetaConnectionsManager, que abre o diálogo */}
      <MetaConnectionsManager initial={initial} />
    </div>
  );
}
