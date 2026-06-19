import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/api-auth";
import { auth } from "@/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["admin", "staff"]).optional(),
  password: z.string().min(8).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { password, ...rest } = parsed.data;
  const data: Prisma.UserUpdateInput = { ...rest };
  if (password) data.passwordHash = await bcrypt.hash(password, 12);

  try {
    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true },
    });
    return Response.json(user);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return Response.json({ error: "Usuário não encontrado" }, { status: 404 });
    }
    throw e;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const session = await auth();

  // never let a user delete their own account (avoids lockout)
  if (session?.user && (session.user as { id?: string }).id === id) {
    return Response.json(
      { error: "Você não pode excluir o próprio usuário" },
      { status: 400 }
    );
  }

  // never delete the last admin
  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!target) return Response.json({ error: "Usuário não encontrado" }, { status: 404 });
  if (target.role === "admin") {
    const admins = await prisma.user.count({ where: { role: "admin" } });
    if (admins <= 1) {
      return Response.json(
        { error: "Não é possível excluir o último administrador" },
        { status: 400 }
      );
    }
  }

  await prisma.user.delete({ where: { id } });
  return Response.json({ ok: true });
}
