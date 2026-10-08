import { prisma } from "@/lib/prisma";
import { uuidString } from "@/lib/validators";

/**
 * Ciclo de vida da sessão (auditoria OWASP AC-01/CF-05/AC-11).
 *
 * A sessão é um JWT em cookie (Auth.js). A cada leitura da sessão — `auth()` nas rotas de
 * API (requireAuth/requireAdmin), no layout e nas páginas, e no proxy — o callback `jwt`
 * chama `revalidateSessionToken`, que confere no banco (com cache curto por usuária):
 *   - a usuária ainda existe;
 *   - `users.session_version` é a mesma gravada no token no login (a versão sobe ao trocar
 *     papel ou senha, ao excluir e ao sair: o cookie antigo deixa de valer na hora);
 *   - o login não passou do teto absoluto de 30 dias (a sessão renova com o uso por 7 dias).
 * O papel, o nome e o e-mail da sessão vêm do BANCO, não do token.
 * Qualquer falha (token antigo sem versão, banco fora do ar) → sem sessão (falha fechada).
 */

/** Sessão de 7 dias, renovada a cada uso (cookie e JWT com nova validade). */
export const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;
/**
 * Intervalo de renovação. O Auth.js só usa `updateAge` com sessão em banco: com JWT o
 * cookie é regravado a cada leitura da sessão (proxy e /api/auth/session).
 */
export const SESSION_UPDATE_AGE_S = 24 * 60 * 60;
/** Teto absoluto desde o login: mesmo usando todo dia, entra de novo depois de 30 dias. */
export const SESSION_ABSOLUTE_MAX_MS = 30 * 24 * 60 * 60 * 1000;
/** Cache da usuária por id (≤ 30 s). Mudanças feitas por este servidor limpam na hora. */
export const SESSION_CACHE_TTL_MS = 15_000;

export type SessionUserRow = { id: string; name: string; email: string; role: string; sessionVersion: number };
type CacheEntry = { row: SessionUserRow | null; at: number };

// no globalThis: o proxy, as páginas e as rotas de API compartilham o mesmo cache no processo
const store = globalThis as unknown as { __sfSessionUserCache?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> = (store.__sfSessionUserCache ??= new Map());
const MAX_CACHE = 5_000;

/** Esquece a usuária no cache (ou todas): a próxima leitura da sessão vai ao banco. */
export function invalidateSessionCache(id?: string | null): void {
  if (id) cache.delete(id.toLowerCase());
  else cache.clear();
}

/** Usuária da sessão no banco (com cache curto). null se não existir mais. */
export async function loadSessionUser(id: string, now = Date.now()): Promise<SessionUserRow | null> {
  const key = id.toLowerCase();
  const hit = cache.get(key);
  if (hit && now - hit.at < SESSION_CACHE_TTL_MS) return hit.row;
  const row = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, sessionVersion: true },
  });
  if (cache.size >= MAX_CACHE) {
    for (const [k, e] of cache) if (now - e.at >= SESSION_CACHE_TTL_MS) cache.delete(k);
    if (cache.size >= MAX_CACHE) cache.clear();
  }
  cache.set(key, { row: row ?? null, at: now });
  return row ?? null;
}

/** Campos que o login grava no token. */
export type SessionTokenFields = {
  id?: unknown;
  role?: unknown;
  name?: unknown;
  email?: unknown;
  /** users.session_version no momento do login */
  sv?: unknown;
  /** instante do login (ms) — base do teto absoluto */
  loginAt?: unknown;
};

/** Usuária devolvida pelo `authorize` do login. */
export type SignInUser = { id?: string; role?: string; sessionVersion?: number };

/**
 * Confere o token contra o banco. Devolve o token com papel/nome/e-mail atuais, ou null
 * quando a sessão não vale mais (o Auth.js então apaga o cookie e `auth()` devolve null).
 */
export async function revalidateSessionToken<T extends SessionTokenFields>(token: T, now = Date.now()): Promise<T | null> {
  const { id, sv, loginAt } = token;
  if (typeof id !== "string" || !uuidString.safeParse(id).success) return null;
  // token de antes desta versão (sem versão ou sem data de login): entra de novo
  if (typeof sv !== "number" || !Number.isInteger(sv)) return null;
  if (typeof loginAt !== "number" || !Number.isFinite(loginAt)) return null;
  if (now - loginAt > SESSION_ABSOLUTE_MAX_MS || loginAt > now + 5 * 60_000) return null;

  const user = await loadSessionUser(id, now);
  if (!user || user.sessionVersion !== sv) return null;

  token.role = user.role;
  token.name = user.name;
  token.email = user.email;
  return token;
}

/** Callback `jwt` do Auth.js: no login grava id/papel/versão/data; depois, revalida. */
export async function jwtCallback<T extends SessionTokenFields>({
  token,
  user,
}: {
  token: T;
  user?: SignInUser | null;
}): Promise<T | null> {
  if (user) {
    // login agora (o authorize acabou de ler a usuária no banco)
    if (typeof user.id !== "string" || typeof user.sessionVersion !== "number") return null;
    token.id = user.id;
    token.role = user.role;
    token.sv = user.sessionVersion;
    token.loginAt = Date.now();
    return token;
  }
  return revalidateSessionToken(token);
}

/** Copia para `session.user` o que as telas e as rotas usam (id e papel vêm do banco). */
export function applyTokenToSessionUser(
  user: { id?: string; name?: string | null; email?: string | null; role?: string } | undefined,
  token: SessionTokenFields
): void {
  if (!user) return;
  user.id = typeof token.id === "string" ? token.id : undefined;
  user.role = typeof token.role === "string" ? token.role : undefined;
  if (typeof token.name === "string") user.name = token.name;
  if (typeof token.email === "string") user.email = token.email;
}

/**
 * Evento `signOut` do Auth.js: "Sair" sobe a versão de sessão da usuária, então uma cópia
 * do cookie (outra aba, cookie roubado) deixa de valer. Só sobe se o token ainda era o
 * válido (um cookie velho saindo não derruba as sessões atuais da pessoa).
 */
export async function signOutEvent(message: { token?: SessionTokenFields | null } | { session?: unknown }): Promise<void> {
  const token = "token" in message ? message.token : null;
  if (!token || typeof token.id !== "string" || !uuidString.safeParse(token.id).success) return;
  if (typeof token.sv !== "number") return;
  try {
    await prisma.user.updateMany({
      where: { id: token.id, sessionVersion: token.sv },
      data: { sessionVersion: { increment: 1 } },
    });
  } catch (e) {
    console.error("[sessão] falha ao encerrar a sessão no banco", e instanceof Error ? e.message : e);
  } finally {
    invalidateSessionCache(token.id);
  }
}
