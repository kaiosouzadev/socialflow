import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import UsersManager from "./UsersManager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Usuários" };

export default async function UsersPage() {
  const session = await auth();
  // gestão de usuários é exclusiva de administradores
  if ((session?.user as { role?: string } | undefined)?.role !== "admin") {
    redirect("/");
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      // para dizer no ConfirmDialog o que fica sem responsável ao excluir
      _count: { select: { responsibleClients: true, writtenPosts: true, responsiblePendingItems: true } },
    },
  });

  const currentUserId = (session?.user as { id?: string })?.id ?? "";

  const initial = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
    clients: u._count.responsibleClients,
    posts: u._count.writtenPosts,
    pending: u._count.responsiblePendingItems,
  }));

  return (
    <div className="page">
      {/* o PageHeader (com "Novo usuário") fica no UsersManager, que abre o diálogo */}
      <UsersManager initialUsers={initial} currentUserId={currentUserId} />
    </div>
  );
}
