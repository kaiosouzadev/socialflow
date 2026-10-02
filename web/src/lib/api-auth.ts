import { auth } from "@/auth";

/** Textos pt-BR do 401 e do 403 (formato `{ error }`; as telas decidem pelo status). */
const SESSION_EXPIRED = "Sua sessão expirou. Entre de novo.";
const ADMIN_ONLY = "Acesso restrito a administradores";

/**
 * Guards dashboard API routes. Returns a 401 Response if there is no
 * authenticated session, or null if the request is authorized.
 */
export async function requireAuth(): Promise<Response | null> {
  const session = await auth();
  if (!session) {
    return Response.json({ error: SESSION_EXPIRED }, { status: 401 });
  }
  return null;
}

/**
 * Guards admin-only routes (gestão de usuários). Returns 401 if not logged in,
 * 403 if logged in without the admin role, or null if authorized.
 */
export async function requireAdmin(): Promise<Response | null> {
  const session = await auth();
  if (!session) {
    return Response.json({ error: SESSION_EXPIRED }, { status: 401 });
  }
  const role = (session.user as { role?: string } | undefined)?.role;
  if (role !== "admin") {
    return Response.json({ error: ADMIN_ONLY }, { status: 403 });
  }
  return null;
}
