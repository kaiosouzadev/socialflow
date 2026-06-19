import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import UsersManager from "./UsersManager";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await auth();
  // gestão de usuários é exclusiva de administradores
  if ((session?.user as { role?: string } | undefined)?.role !== "admin") {
    redirect("/");
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  const currentUserId = (session?.user as { id?: string })?.id ?? "";

  const initial = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
  }));

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-up">
      <PageHeader title="Usuários" subtitle="Quem tem acesso ao painel" />
      <UsersManager initialUsers={initial} currentUserId={currentUserId} />
    </div>
  );
}
