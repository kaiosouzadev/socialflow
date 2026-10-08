import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuthUser } from "@/lib/api-auth";
import { audit } from "@/lib/audit";
import { checkPasswordPolicy } from "@/lib/password-policy";
import { rateLimit } from "@/lib/rate-limit";
import { invalidateSessionCache } from "@/lib/session-guard";

export const dynamic = "force-dynamic";

const MSG = {
  body: "Informe a senha atual e a nova senha.",
  wrongCurrent: "A senha atual não confere.",
  same: "A nova senha precisa ser diferente da atual.",
  tooMany: "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
  gone: "Sua sessão expirou. Entre de novo.",
} as const;

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().max(1024),
});

/**
 * A própria usuária troca a senha (qualquer papel). Pede a senha atual; aplica a política
 * de senha; sobe a versão de sessão (todas as sessões abertas, inclusive esta, deixam de
 * valer: a pessoa entra de novo com a senha nova). Limite: 5 tentativas a cada 15 min.
 *
 * Corpo `{ currentPassword, newPassword }`. 200 `{ ok: true }`; 400 `{ error, field }`
 * (field = currentPassword | newPassword); 401 sem sessão; 429 limite.
 */
export async function POST(req: Request) {
  const { user: me, denied } = await requireAuthUser();
  if (denied) return denied;

  const limit = rateLimit(`own-password:${me.id.toLowerCase()}`, 5, 15 * 60_000);
  if (!limit.ok) {
    return Response.json({ error: MSG.tooMany }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: MSG.body }, { status: 400 });
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: me.id },
    select: { id: true, name: true, email: true, passwordHash: true },
  });
  if (!user) return Response.json({ error: MSG.gone }, { status: 401 });

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return Response.json({ error: MSG.wrongCurrent, field: "currentPassword" }, { status: 400 });
  }
  if (newPassword === currentPassword) {
    return Response.json({ error: MSG.same, field: "newPassword" }, { status: 400 });
  }
  const policy = checkPasswordPolicy(newPassword, { email: user.email, name: user.name });
  if (!policy.ok) return Response.json({ error: policy.message, field: "newPassword" }, { status: 400 });

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, sessionVersion: { increment: 1 } },
    select: { id: true },
  });
  invalidateSessionCache(user.id);
  await audit(
    { action: "user.password_change", targetType: "user", targetId: user.id, meta: { by: "self" } },
    { req, actor: { id: user.id, email: user.email } }
  );
  return Response.json({ ok: true });
}
