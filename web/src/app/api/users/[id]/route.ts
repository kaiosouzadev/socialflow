import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminUser } from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { checkPasswordPolicy } from "@/lib/password-policy";
import { invalidateSessionCache } from "@/lib/session-guard";
import { uuidString } from "@/lib/validators";
import { z } from "zod";

export const dynamic = "force-dynamic";

const NOT_FOUND = "Usuário não encontrado";
const SELF_DELETE = "Você não pode excluir o próprio usuário";
const LAST_ADMIN_DEMOTE =
  "Não é possível tirar o papel de administrador da última pessoa administradora. Promova outra pessoa antes.";
const LAST_ADMIN_DELETE = "Não é possível excluir o último administrador.";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["admin", "staff"]).optional(),
  // a política (tamanho, senhas comuns, nome/e-mail) é conferida depois, com mensagem pt-BR
  password: z.string().max(1024).optional(),
});

type LockedUser = { id: string; role: string; name: string; email: string };
type Tx = Prisma.TransactionClient;

/*
 * Guarda da última admin (AC-04), sem corrida: a transação trava (FOR UPDATE) as admins
 * atuais em ordem fixa de id ANTES de travar a usuária alvo. Duas mudanças simultâneas que
 * tiram admins (rebaixar/excluir) esperam uma pela outra; a segunda relê a lista já sem a
 * que saiu e recusa com 409 se sobraria nenhuma. A ordem fixa evita deadlock.
 */
async function lockAdmins(tx: Tx): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM users WHERE role = 'admin' ORDER BY id FOR UPDATE`;
  return rows.map((r) => r.id.toLowerCase());
}

async function lockUser(tx: Tx, id: string): Promise<LockedUser | null> {
  const rows = await tx.$queryRaw<LockedUser[]>`
    SELECT id::text AS id, role, name, email FROM users WHERE id = ${id}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

/** Sem nenhuma outra admin além da alvo. */
function isLastAdmin(admins: string[], id: string): boolean {
  return admins.filter((a) => a !== id).length === 0;
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user: actor, denied } = await requireAdminUser();
  if (denied) return denied;

  const { id: rawId } = await params;
  if (!uuidString.safeParse(rawId).success) return Response.json({ error: NOT_FOUND }, { status: 404 });
  const id = rawId.toLowerCase();

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, role, password } = parsed.data;

  // senha nova: política e hash ANTES da transação (o bcrypt leva ~0,3 s; não segura travas)
  let passwordHash: string | null = null;
  if (password !== undefined && password !== "") {
    const current = await prisma.user.findUnique({ where: { id }, select: { name: true, email: true } });
    if (!current) return Response.json({ error: NOT_FOUND }, { status: 404 });
    const policy = checkPasswordPolicy(password, { email: current.email, name: name ?? current.name });
    if (!policy.ok) return Response.json({ error: policy.message, field: "password" }, { status: 400 });
    passwordHash = await bcrypt.hash(password, 12);
  }

  const mayDemote = role !== undefined && role !== "admin";
  const result = await prisma.$transaction(async (tx) => {
    const admins = mayDemote ? await lockAdmins(tx) : [];
    const target = await lockUser(tx, id);
    if (!target) return { kind: "not_found" as const };

    const roleChanged = role !== undefined && role !== target.role;
    if (roleChanged && target.role === "admin" && isLastAdmin(admins, id)) return { kind: "last_admin" as const };

    const data: Prisma.UserUpdateInput = {};
    if (name !== undefined) data.name = name;
    if (roleChanged) data.role = role;
    if (passwordHash) data.passwordHash = passwordHash;
    // papel ou senha trocados: as sessões abertas dessa usuária deixam de valer na hora
    if (roleChanged || passwordHash) data.sessionVersion = { increment: 1 };

    const user = await tx.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true },
    });
    return { kind: "ok" as const, user, from: target.role, roleChanged, passwordChanged: passwordHash !== null };
  }, TX_OPTIONS);

  if (result.kind === "not_found") return Response.json({ error: NOT_FOUND }, { status: 404 });
  if (result.kind === "last_admin") return Response.json({ error: LAST_ADMIN_DEMOTE }, { status: 409 });

  invalidateSessionCache(id);
  const by = { id: actor.id, email: actor.email };
  if (result.roleChanged) {
    await audit(
      { action: "user.role_change", targetType: "user", targetId: id, meta: { from: result.from, to: result.user.role } },
      { req, actor: by }
    );
  }
  if (result.passwordChanged) {
    await audit(
      {
        action: "user.password_change",
        targetType: "user",
        targetId: id,
        meta: { by: actor.id.toLowerCase() === id ? "self" : "admin" },
      },
      { req, actor: by }
    );
  }
  return Response.json(result.user);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user: actor, denied } = await requireAdminUser();
  if (denied) return denied;

  const { id: rawId } = await params;
  if (!uuidString.safeParse(rawId).success) return Response.json({ error: NOT_FOUND }, { status: 404 });
  const id = rawId.toLowerCase();

  // never let a user delete their own account (avoids lockout)
  if (actor.id.toLowerCase() === id) {
    return Response.json({ error: SELF_DELETE }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const admins = await lockAdmins(tx);
    const target = await lockUser(tx, id);
    if (!target) return { kind: "not_found" as const };
    if (target.role === "admin" && isLastAdmin(admins, id)) return { kind: "last_admin" as const };
    await tx.user.delete({ where: { id } });
    return { kind: "ok" as const, target };
  }, TX_OPTIONS);

  if (result.kind === "not_found") return Response.json({ error: NOT_FOUND }, { status: 404 });
  if (result.kind === "last_admin") return Response.json({ error: LAST_ADMIN_DELETE }, { status: 409 });

  // a linha sumiu: qualquer sessão dela cai na próxima leitura (sem esperar o cache)
  invalidateSessionCache(id);
  await audit(
    {
      action: "user.delete",
      targetType: "user",
      targetId: id,
      meta: { role: result.target.role, name: result.target.name, email: result.target.email },
    },
    { req, actor: { id: actor.id, email: actor.email } }
  );
  return Response.json({ ok: true });
}
