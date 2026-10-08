import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireAdminUser } from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { checkPasswordPolicy } from "@/lib/password-policy";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  // a política (tamanho, senhas comuns, nome/e-mail) é conferida depois, com mensagem pt-BR
  password: z.string().max(1024),
  role: z.enum(["admin", "staff"]).default("staff"),
});

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  return Response.json(users);
}

export async function POST(req: NextRequest) {
  const { user: actor, denied } = await requireAdminUser();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { password, ...rest } = parsed.data;
  const policy = checkPasswordPolicy(password, { email: rest.email, name: rest.name });
  if (!policy.ok) {
    return Response.json({ error: policy.message, field: "password" }, { status: 400 });
  }
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const user = await prisma.user.create({
      data: { ...rest, passwordHash },
      select: { id: true, name: true, email: true, role: true },
    });
    await audit(
      { action: "user.create", targetType: "user", targetId: user.id, meta: { role: user.role, email: user.email } },
      { req, actor: { id: actor.id, email: actor.email } }
    );
    return Response.json(user, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return Response.json({ error: "Já existe um usuário com este email" }, { status: 409 });
    }
    throw e;
  }
}
