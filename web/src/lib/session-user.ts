import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { uuidString } from "@/lib/validators";

type SessionUser = { id?: string; email?: string | null } | undefined;

/**
 * Usuária da sessão no banco (id) — pelo id do token; sem ele, pelo e-mail. null se não existir mais.
 * (A sessão já chega revalidada por `auth()` — lib/session-guard —; a releitura aqui só garante
 * a FK de quem grava, como `app_settings.updated_by`.)
 */
export async function sessionUserId(): Promise<string | null> {
  const session = await auth();
  const user = session?.user as SessionUser;
  if (user?.id && uuidString.safeParse(user.id).success) {
    const found = await prisma.user.findUnique({ where: { id: user.id }, select: { id: true } });
    if (found) return found.id;
  }
  if (user?.email) {
    const found = await prisma.user.findUnique({ where: { email: user.email }, select: { id: true } });
    return found?.id ?? null;
  }
  return null;
}
