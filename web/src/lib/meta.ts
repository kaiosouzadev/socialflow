/**
 * Cliente mínimo da Graph API (Meta) para um System User token.
 * Lê Páginas + contas Instagram que o Business administra, e reúne o que é
 * comum às chamadas à Graph (usado também por lib/meta-publish):
 *
 * - token SÓ no header `Authorization: Bearer` — nunca na URL/query string
 *   (CLAUDE.md; OWASP CR-07). O `appsecret_proof` (HMAC, não é segredo) segue
 *   como parâmetro;
 * - ids da Graph (Página, conta IG, container, foto, vídeo) só com dígitos
 *   antes de entrar num caminho (`/{id}/...`);
 * - mensagens de erro sem token nem segredo (`redactSecrets`).
 */

import { createHmac } from "crypto";

export const GRAPH_BASE = "https://graph.facebook.com/v21.0";

/** Uma chamada pendurada não pode travar a rota inteira. */
export const GRAPH_TIMEOUT_MS = 20_000;

/** Texto do timeout (o `toUserMessage` traduz para "A Meta demorou demais…"). */
export const GRAPH_TIMEOUT_ERROR = "Graph API demorou demais para responder (timeout)";

/**
 * Quando o App tem "Exigir proof de segredo do app" ligado, toda chamada
 * precisa do appsecret_proof = HMAC-SHA256(token, app_secret).
 */
export function appSecretProof(token: string): string | null {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(token).digest("hex");
}

// ------------------------------------------------------------ ids e caminhos

/** Ids numéricos da Graph: Página, conta do Instagram, container, foto, vídeo. */
const GRAPH_ID = /^\d{1,32}$/;

/** Caminho só com segmentos [A-Za-z0-9_] (sem `?`, `#`, `%`, `..`, `//`). */
const GRAPH_PATH = /^(\/[A-Za-z0-9_]+)+$/;

export function isGraphId(value: unknown): value is string {
  return typeof value === "string" && GRAPH_ID.test(value);
}

/**
 * Garante que um id vindo do banco ou da própria Graph é só dígitos antes de
 * montar `/{id}/...`. Lança com texto pt-BR (vai para o histórico do post).
 */
export function assertGraphId(value: unknown, what: string): string {
  if (!isGraphId(value)) throw new Error(`Identificador inválido da Meta (${what}). Reconecte a conta e tente de novo.`);
  return value;
}

// ------------------------------------------------------------ segredos fora de mensagens

/**
 * Tira de um texto (erro, log) os segredos informados e qualquer coisa com
 * cara de token/segredo da Meta. Usado antes de gravar no banco, logar ou
 * devolver ao chamador.
 */
export function redactSecrets(text: string, ...secrets: (string | null | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("***");
  return out
    .replace(/\b(access_token|client_secret|fb_exchange_token|appsecret_proof|input_token)=[^&\s"']+/gi, "$1=***")
    .replace(/\b(Bearer|OAuth)\s+[A-Za-z0-9._~+/=-]{12,}/g, "$1 ***")
    .replace(/\bEAA[A-Za-z0-9]{16,}/g, "***");
}

// ------------------------------------------------------------ chamada à Graph

type GraphErrorBody = { error?: { message?: unknown } } | null;

/**
 * GET/POST na Graph com o token no header. Em POST os parâmetros vão no corpo
 * (form-urlencoded); em GET, na query (nunca o token). Erro → `Error` com o
 * `message` da Graph (já sem segredos) ou `HTTP <status>`; demora →
 * GRAPH_TIMEOUT_ERROR.
 */
export async function graphRequest<T = Record<string, unknown>>(
  method: "GET" | "POST",
  path: string,
  token: string,
  params: Record<string, string> = {},
  opts: { timeoutMs?: number } = {}
): Promise<T> {
  if (!GRAPH_PATH.test(path)) throw new Error("Caminho inválido para a Graph API.");
  const url = new URL(`${GRAPH_BASE}${path}`);
  if (method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const proof = appSecretProof(token);
  if (proof) url.searchParams.set("appsecret_proof", proof);

  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const init: RequestInit = { method, headers, cache: "no-store" };
  if (method === "POST") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(params);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? GRAPH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted || (e instanceof Error && e.name === "AbortError")) throw new Error(GRAPH_TIMEOUT_ERROR);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const raw = (data as GraphErrorBody)?.error?.message;
    const msg = typeof raw === "string" && raw.trim() ? raw : `HTTP ${res.status}`;
    throw new Error(redactSecrets(msg, token).slice(0, 500));
  }
  return (data ?? {}) as T;
}

// ------------------------------------------------------------ ativos do Business

export type MetaAsset = {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  instagramId: string | null;
  instagramUsername: string | null;
};

/** Valida o token chamando /me. Retorna o nome do ator (business/usuário). */
export async function validateToken(token: string): Promise<{ id: string; name: string }> {
  return graphRequest<{ id: string; name: string }>("GET", "/me", token, { fields: "id,name" });
}

type PageNode = {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
};

function toAsset(p: PageNode): MetaAsset {
  return {
    pageId: p.id,
    pageName: p.name,
    pageAccessToken: p.access_token,
    instagramId: p.instagram_business_account?.id ?? null,
    instagramUsername: p.instagram_business_account?.username ?? null,
  };
}

/**
 * Lista as Páginas do Business + a conta IG vinculada a cada uma.
 * O vínculo IG vem por field expansion na PRÓPRIA chamada /me/accounts
 * (1 requisição por lote de 100 páginas) — antes era 1 requisição extra
 * por página, o que deixava BMs grandes com 15-30s de espera.
 */
export async function listAssets(token: string): Promise<MetaAsset[]> {
  const assets: MetaAsset[] = [];
  let after: string | undefined;

  do {
    const page = await graphRequest<{
      data: PageNode[];
      paging?: { cursors?: { after?: string }; next?: string };
    }>("GET", "/me/accounts", token, {
      fields: "id,name,access_token,instagram_business_account{id,username}",
      limit: "100",
      ...(after ? { after } : {}),
    });

    for (const p of page.data ?? []) assets.push(toAsset(p));

    after = page.paging?.next ? page.paging?.cursors?.after : undefined;
  } while (after);

  return assets;
}

/**
 * Acha um ativo (Página) específico pelo pageId — busca direta no nó, sem
 * varrer o Business inteiro. O page access token vem na própria resposta
 * quando consultado com o System User token. `pageId` que não é só dígitos
 * → null sem chamar a Graph (não vira caminho como `me/...` ou `1/../x`).
 */
export async function getAsset(token: string, pageId: string): Promise<MetaAsset | null> {
  if (!isGraphId(pageId)) return null;
  try {
    const p = await graphRequest<PageNode>("GET", `/${pageId}`, token, {
      fields: "id,name,access_token,instagram_business_account{id,username}",
    });
    if (!p?.id || !p.access_token) return null;
    return toAsset(p);
  } catch (e) {
    // página inexistente/fora do Business: null (como o antigo scan). Erros de
    // permissão/token sobem — mascará-los viraria um "não encontrada" enganoso.
    const msg = e instanceof Error ? e.message : "";
    if (/does not exist|cannot be loaded|Unsupported get request/i.test(msg)) {
      return null;
    }
    throw e;
  }
}

// ------------------------------------------------------------ renovação de token (WF-02)

export type ExchangedToken = { accessToken: string; expiresIn: number | null };

/**
 * Troca um token da Meta por um de longa duração (`fb_exchange_token`).
 * Feito DENTRO do sistema (o n8n só dispara): `client_secret` e os tokens vão
 * no CORPO do POST, nunca na URL, e o erro sai sem token nem segredo.
 * `expiresIn` null = a Meta não informou validade (token sem expiração).
 */
export async function exchangeForLongLivedToken(
  token: string,
  appId: string,
  appSecret: string,
  opts: { timeoutMs?: number } = {}
): Promise<ExchangedToken> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? GRAPH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${GRAPH_BASE}/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: token,
      }),
      cache: "no-store",
      signal: ctrl.signal,
    });
  } catch (e) {
    if (ctrl.signal.aborted || (e instanceof Error && e.name === "AbortError")) throw new Error(GRAPH_TIMEOUT_ERROR);
    throw new Error(redactSecrets(e instanceof Error ? e.message : "falha de rede", token, appSecret));
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => null)) as
    | { access_token?: unknown; expires_in?: unknown; error?: { message?: unknown } }
    | null;
  if (!res.ok) {
    const raw = data?.error?.message;
    const msg = typeof raw === "string" && raw.trim() ? raw : `HTTP ${res.status}`;
    throw new Error(redactSecrets(msg, token, appSecret).slice(0, 300));
  }
  const accessToken = data?.access_token;
  if (typeof accessToken !== "string" || accessToken.length < 20 || /\s/.test(accessToken)) {
    throw new Error("A Meta não devolveu um token válido na renovação.");
  }
  const exp = data?.expires_in;
  const expiresIn = typeof exp === "number" && Number.isFinite(exp) && exp > 0 ? Math.floor(exp) : null;
  return { accessToken, expiresIn };
}
