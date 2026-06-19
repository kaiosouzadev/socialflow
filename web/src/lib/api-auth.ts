import { auth } from "@/auth";

/**
 * Guards dashboard API routes. Returns a 401 Response if there is no
 * authenticated session, or null if the request is authorized.
 */
export async function requireAuth(): Promise<Response | null> {
  const session = await auth();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = (session.user as { role?: string } | undefined)?.role;
  if (role !== "admin") {
    return Response.json({ error: "Acesso restrito a administradores" }, { status: 403 });
  }
  return null;
}
