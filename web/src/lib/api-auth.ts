import { auth } from "@/auth";

/** Textos pt-BR do 401 e do 403 (formato `{ error }`; as telas decidem pelo status). */
const SESSION_EXPIRED = "Sua sessão expirou. Entre de novo.";
const ADMIN_ONLY = "Acesso restrito a administradores";

/** Usuária da sessão, já conferida no banco. */
export type SessionUser = { id: string; role: string | null; name: string | null; email: string | null };

/**
 * Usuária da sessão atual, ou null.
 *
 * `auth()` revalida a sessão no banco a cada chamada (callback `jwt` → lib/session-guard):
 * usuária excluída, versão de sessão antiga (papel/senha trocados, saiu) ou login com mais
 * de 30 dias → null. O papel devolvido é o do BANCO. Exige uma identidade (`user.id`), e
 * não só "existe um objeto de sessão" (CF-01: um objeto de erro não passa por sessão).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  let session: unknown;
  try {
    session = await auth();
  } catch (e) {
    console.error("[sessão] falha ao ler a sessão", e instanceof Error ? e.message : e);
    return null;
  }
  const user = (session as { user?: { id?: unknown; role?: unknown; name?: unknown; email?: unknown } } | null)?.user;
  if (!user || typeof user.id !== "string" || user.id.length === 0) return null;
  return {
    id: user.id,
    role: typeof user.role === "string" ? user.role : null,
    name: typeof user.name === "string" ? user.name : null,
    email: typeof user.email === "string" ? user.email : null,
  };
}

/**
 * Guards dashboard API routes. Returns a 401 Response if there is no valid
 * session (revalidated in the database), or null if the request is authorized.
 */
export async function requireAuth(): Promise<Response | null> {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: SESSION_EXPIRED }, { status: 401 });
  }
  return null;
}

/**
 * Guards admin-only routes (gestão de usuários). Returns 401 if not logged in,
 * 403 if the CURRENT role in the database is not admin, or null if authorized.
 */
export async function requireAdmin(): Promise<Response | null> {
  return (await requireAdminUser()).denied;
}

/** Como `requireAdmin`, devolvendo também a admin (para a trilha de auditoria). */
export async function requireAdminUser(): Promise<
  { user: SessionUser; denied: null } | { user: null; denied: Response }
> {
  const user = await getSessionUser();
  if (!user) {
    return { user: null, denied: Response.json({ error: SESSION_EXPIRED }, { status: 401 }) };
  }
  if (user.role !== "admin") {
    return { user: null, denied: Response.json({ error: ADMIN_ONLY }, { status: 403 }) };
  }
  return { user, denied: null };
}

/** Como `requireAuth`, devolvendo também a usuária da sessão. */
export async function requireAuthUser(): Promise<
  { user: SessionUser; denied: null } | { user: null; denied: Response }
> {
  const user = await getSessionUser();
  if (!user) {
    return { user: null, denied: Response.json({ error: SESSION_EXPIRED }, { status: 401 }) };
  }
  return { user, denied: null };
}
