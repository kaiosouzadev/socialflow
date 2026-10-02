/**
 * Prévia do perfil do Instagram para a visão "Ver como feed" do link público
 * mensal (/aprovar/[token]). SÓ NO SERVIDOR: lê o token da conta no banco.
 *
 * - Conta: SocialAccount do cliente com platform "instagram" e status "active"
 *   (a mais recente). Token decifrado com decryptToken (lib/crypto).
 * - Graph: SÓ o perfil (username, nome, bio, site, foto, contadores). As mídias
 *   já publicadas não são buscadas: a grade mostra só os posts do cronograma
 *   (P4-F2). O token vai SÓ no header `Authorization: Bearer` — nunca na URL
 *   (regra do CLAUDE.md) — e nunca é logado.
 * - Cache em memória por conta: 6 h para sucesso, 5 min para falha. O token
 *   não entra na chave (a chave é o id da conta).
 * - Timeout de 3 s; qualquer erro → dados do cadastro (source "cadastro"),
 *   sem contadores e sem bio.
 * - Nada além dos campos de InstagramProfilePreview sai daqui (sem token e sem
 *   ids da conta).
 */

import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto";

export type InstagramProfilePreview = {
  source: "instagram" | "cadastro";
  /** sem "@"; null quando não há conta nem `instagramUrl` no cadastro */
  username: string | null;
  name: string;
  biography?: string;
  website?: string;
  avatarUrl?: string;
  mediaCount?: number;
  followers?: number;
  following?: number;
};

export const IG_GRAPH_DEFAULT_BASE = "https://graph.facebook.com/v21.0";
export const IG_TIMEOUT_MS = 3_000;
export const IG_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const IG_FAILURE_TTL_MS = 5 * 60 * 1000;

const PROFILE_FIELDS =
  "username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count";

/** O que vem da Graph (sem nada do cadastro). */
type IgData = {
  username: string;
  name?: string;
  biography?: string;
  website?: string;
  avatarUrl?: string;
  mediaCount?: number;
  followers?: number;
  following?: number;
};

type Entry = { data: IgData | null; expiresAt: number };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<IgData | null>>();

/** Limpa o cache (ex.: conta reconectada; e nos testes). */
export function clearInstagramProfileCache(): void {
  cache.clear();
  inflight.clear();
}

/* ------------------------------------------------------------ utilitários */

/**
 * Base da Graph. `META_GRAPH_BASE_URL` existe só para apontar para um stub
 * local nos testes: aceita https ou http em localhost/127.0.0.1; qualquer outra
 * coisa cai no padrão (o token nunca vai para um host http qualquer).
 */
export function graphBaseUrl(): string {
  const raw = process.env.META_GRAPH_BASE_URL?.trim();
  if (!raw) return IG_GRAPH_DEFAULT_BASE;
  try {
    const u = new URL(raw);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol === "https:" || (u.protocol === "http:" && local)) return raw.replace(/\/+$/, "");
  } catch {
    /* URL inválida → padrão */
  }
  return IG_GRAPH_DEFAULT_BASE;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function count(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
}

/** Só http(s) — evita `javascript:` e afins em src/href. */
function httpUrl(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Site da bio: aceita "dominio.com/x" (sem esquema) como https. */
function websiteUrl(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  return httpUrl(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
}

const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

/**
 * @ a partir do `instagramUrl` do cadastro: "https://www.instagram.com/grupo.coletivo/",
 * "instagram.com/grupo.coletivo?igsh=…", "@grupo.coletivo" ou "grupo.coletivo".
 */
export function usernameFromInstagramUrl(value: string | null | undefined): string | null {
  const s = value?.trim();
  if (!s) return null;
  let candidate = s.replace(/^@/, "");
  const m = s.match(/instagram\.com\/([^/?#\s]+)/i);
  if (m) candidate = m[1];
  else if (/[/:]/.test(candidate)) return null;
  candidate = candidate.replace(/^@/, "");
  if (["p", "reel", "reels", "stories", "explore"].includes(candidate.toLowerCase())) return null;
  return USERNAME_RE.test(candidate) ? candidate : null;
}

/** Mensagem de log sem token, sem URL e sem o texto da Graph (só status e código). */
class GraphError extends Error {}

async function readGraph(res: Response): Promise<unknown> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as { error?: { type?: unknown; code?: unknown } } | null)?.error;
    const type = typeof err?.type === "string" ? err.type : "";
    const code = typeof err?.code === "number" ? ` ${err.code}` : "";
    throw new GraphError(`HTTP ${res.status}${type || code ? ` (${type}${code})` : ""}`);
  }
  return body;
}

function parseProfile(body: unknown): IgData {
  const p = (body ?? {}) as Record<string, unknown>;
  const username = str(p.username);
  if (!username || !USERNAME_RE.test(username)) throw new GraphError("perfil sem username válido");
  return {
    username,
    name: str(p.name),
    biography: str(p.biography),
    website: websiteUrl(p.website),
    avatarUrl: httpUrl(p.profile_picture_url),
    mediaCount: count(p.media_count),
    followers: count(p.followers_count),
    following: count(p.follows_count),
  };
}

/** Quando o App exige "appsecret_proof" (META_APP_SECRET), ele vai como parâmetro — é um HMAC, não o token. */
function withProof(url: URL, token: string): URL {
  const secret = process.env.META_APP_SECRET;
  if (secret) url.searchParams.set("appsecret_proof", createHmac("sha256", secret).update(token).digest("hex"));
  return url;
}

async function fetchFromGraph(igUserId: string, token: string): Promise<IgData> {
  const base = graphBaseUrl();
  const id = encodeURIComponent(igUserId);
  // só o perfil: a grade não mostra as mídias já publicadas, então /media não é pedido
  const profileUrl = new URL(`${base}/${id}`);
  profileUrl.searchParams.set("fields", PROFILE_FIELDS);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IG_TIMEOUT_MS);
  try {
    // token SÓ no header (nunca na URL/query string)
    const res = await fetch(withProof(profileUrl, token), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: ctrl.signal,
    });
    return parseProfile(await readGraph(res));
  } catch (e) {
    if (ctrl.signal.aborted) throw new GraphError(`sem resposta em ${IG_TIMEOUT_MS} ms (timeout)`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function reasonOf(e: unknown, token: string | null): string {
  const raw = e instanceof GraphError ? e.message : e instanceof Error ? e.name : "erro desconhecido";
  return token ? raw.split(token).join("***") : raw;
}

/** Dados da Graph de uma conta, com cache (6 h sucesso / 5 min falha) e uma chamada por vez por conta. */
async function igDataFor(account: { id: string; externalId: string; accessTokenEnc: string }): Promise<IgData | null> {
  const now = Date.now();
  const hit = cache.get(account.id);
  if (hit && hit.expiresAt > now) return hit.data;

  const running = inflight.get(account.id);
  if (running) return running;

  const job = (async () => {
    let token: string | null = null;
    let data: IgData | null = null;
    try {
      token = decryptToken(account.accessTokenEnc);
      data = await fetchFromGraph(account.externalId, token);
    } catch (e) {
      // log no servidor SEM o token e sem a URL
      console.warn(`[ig-profile] perfil do Instagram indisponível (conta ${account.id}): ${reasonOf(e, token)}`);
    }
    const stored = Date.now();
    for (const [k, v] of cache) if (v.expiresAt <= stored) cache.delete(k);
    cache.set(account.id, { data, expiresAt: stored + (data ? IG_CACHE_TTL_MS : IG_FAILURE_TTL_MS) });
    return data;
  })();
  inflight.set(account.id, job);
  try {
    return await job;
  } finally {
    inflight.delete(account.id);
  }
}

/**
 * Cabeçalho do perfil do Instagram conectado do cliente (sem as postagens).
 * Nunca lança por causa do Instagram: sem conta, token vencido/ilegível, erro
 * ou timeout → dados do cadastro (logo, nome, @ do `instagramUrl`).
 */
export async function getInstagramProfilePreview(clientId: string): Promise<InstagramProfilePreview> {
  let client: { name: string; tradeName: string | null; logoUrl: string | null; instagramUrl: string | null } | null;
  let account: { id: string; externalId: string; accessTokenEnc: string; tokenExpiresAt: Date | null } | null;
  try {
    [client, account] = await Promise.all([
      prisma.client.findUnique({
        where: { id: clientId },
        select: { name: true, tradeName: true, logoUrl: true, instagramUrl: true },
      }),
      prisma.socialAccount.findFirst({
        where: { clientId, platform: "instagram", status: "active" },
        orderBy: { createdAt: "desc" },
        select: { id: true, externalId: true, accessTokenEnc: true, tokenExpiresAt: true },
      }),
    ]);
  } catch (e) {
    // a prévia nunca derruba a página: sem banco, a tela usa o nome que já tem
    console.warn(`[ig-profile] cadastro indisponível: ${e instanceof Error ? e.name : "erro"}`);
    return { source: "cadastro", username: null, name: "" };
  }

  const name = str(client?.tradeName) ?? str(client?.name) ?? "";
  const logo = httpUrl(client?.logoUrl);
  const fallback: InstagramProfilePreview = {
    source: "cadastro",
    username: usernameFromInstagramUrl(client?.instagramUrl),
    name,
    ...(logo ? { avatarUrl: logo } : {}),
  };

  // sem conta ativa, sem token ou token já vencido: nem chama a Graph
  if (!account || !account.externalId || !account.accessTokenEnc) return fallback;
  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= Date.now()) return fallback;

  const ig = await igDataFor(account);
  if (!ig) return fallback;

  const avatarUrl = ig.avatarUrl ?? logo;
  return {
    source: "instagram",
    username: ig.username,
    name: ig.name ?? name,
    ...(ig.biography ? { biography: ig.biography } : {}),
    ...(ig.website ? { website: ig.website } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(ig.mediaCount !== undefined ? { mediaCount: ig.mediaCount } : {}),
    ...(ig.followers !== undefined ? { followers: ig.followers } : {}),
    ...(ig.following !== undefined ? { following: ig.following } : {}),
  };
}
