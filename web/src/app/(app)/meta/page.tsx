import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import MetaConnectionsManager from "./MetaConnectionsManager";

export const dynamic = "force-dynamic";

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
    <div className="p-8 max-w-6xl mx-auto animate-fade-up">
      <PageHeader
        title="Conexões Meta"
        subtitle="Business Manager → Páginas e Instagram dos clientes"
      />
      <MetaConnectionsManager initial={initial} />
    </div>
  );
}
