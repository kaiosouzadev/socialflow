import { auth } from "@/auth";
import { requireAdmin } from "@/lib/api-auth";

/**
 * Papel mínimo das ações destrutivas e de alto impacto (decisão "Só admin + registro", OWASP AC-07)
 * e quem fez a ação (para a trilha de auditoria). As guardas de sessão continuam as de
 * `lib/api-auth` (requireAuth/requireAdmin); aqui só se troca o texto do 403 por um que explica
 * o motivo e se lê o autor da sessão.
 */

export type SessionActor = { id: string | null; email: string | null; role: string | null };

/** Textos do 403 (pt-BR, N-14): dizem o que só a administradora pode fazer. */
export const ADMIN_ONLY = {
  deleteClient: "Só administradoras podem excluir clientes. Peça a uma administradora.",
  accounts: "Só administradoras podem adicionar, trocar ou excluir contas de publicação. Peça a uma administradora.",
  metaLink: "Só administradoras podem vincular Páginas do Meta a clientes. Peça a uma administradora.",
  linkedin: "Só administradoras podem conectar o LinkedIn de um cliente. Peça a uma administradora.",
  deletePublished: "Só administradoras podem excluir posts já publicados.",
} as const;

/** Autor da sessão atual (id, e-mail, papel) ou null sem sessão. Nunca lança. */
export async function sessionActor(): Promise<SessionActor | null> {
  try {
    const session = await auth();
    if (!session) return null;
    const user = session.user as { id?: string; email?: string | null; role?: string } | undefined;
    return { id: user?.id ?? null, email: user?.email ?? null, role: user?.role ?? null };
  } catch {
    return null;
  }
}

export const isAdmin = (actor: SessionActor | null | undefined): boolean => actor?.role === "admin";

/**
 * Guarda de rota só para administradoras: 401 sem sessão (texto do requireAdmin), 403 com
 * `message` para quem não é admin, null se liberado.
 */
export async function requireAdminFor(message: string): Promise<Response | null> {
  const denied = await requireAdmin();
  if (!denied) return null;
  if (denied.status === 403) return Response.json({ error: message }, { status: 403 });
  return denied;
}

/** Cabeçalhos das respostas com dados sensíveis (credenciais, cadastro de clientes, auditoria). */
export const NO_STORE = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" } as const;
