/**
 * Cliente mínimo da API do LinkedIn (membro). OAuth 2.0 3-legged + publicação
 * de texto via /rest/posts. Diferente do Meta (System User token), cada conta
 * LinkedIn passa por um fluxo OAuth do próprio dono.
 *
 * Env: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET.
 * Escopos: openid profile (pegar o URN do membro) + w_member_social (publicar).
 */

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const API = "https://api.linkedin.com";
const REST_VERSION = "202405";
export const LINKEDIN_SCOPES = "openid profile w_member_social";

export function linkedinConfigured(): boolean {
  return !!process.env.LINKEDIN_CLIENT_ID && !!process.env.LINKEDIN_CLIENT_SECRET;
}

/** Monta a redirect URI a partir do base público do sistema. */
export function linkedinRedirectUri(): string {
  const base = (process.env.SYSTEM_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/linkedin/callback`;
}

/** URL de autorização para iniciar o consentimento OAuth. */
export function getAuthorizeUrl(state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.LINKEDIN_CLIENT_ID!);
  url.searchParams.set("redirect_uri", linkedinRedirectUri());
  url.searchParams.set("scope", LINKEDIN_SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

export type LinkedInTokens = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
};

/** Troca o authorization code por tokens. */
export async function exchangeCode(code: string): Promise<LinkedInTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: linkedinRedirectUri(),
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error_description ?? `Token exchange HTTP ${res.status}`);
  return data as LinkedInTokens;
}

/** Renova o access token usando um refresh token (para o WF de refresh). */
export async function refreshAccessToken(refreshToken: string): Promise<LinkedInTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error_description ?? `Refresh HTTP ${res.status}`);
  return data as LinkedInTokens;
}

/**
 * Lê o perfil do membro via OpenID Connect userinfo. Retorna o URN
 * (urn:li:person:{sub}) usado como author na publicação, e o nome.
 */
export async function getMember(accessToken: string): Promise<{ urn: string; name: string }> {
  const res = await fetch(`${API}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? `userinfo HTTP ${res.status}`);
  return { urn: `urn:li:person:${data.sub}`, name: data.name ?? data.sub };
}

/**
 * Publica um post de texto no feed do membro. Retorna o id do post (urn).
 * Imagem exige registrar o asset antes — fica para uma fase posterior.
 */
export async function publishText(
  accessToken: string,
  authorUrn: string,
  text: string
): Promise<{ id: string }> {
  const res = await fetch(`${API}/rest/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": REST_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author: authorUrn,
      commentary: text,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`posts HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  // o id do post vem no header x-restli-id (ou x-linkedin-id)
  const id = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id") ?? "";
  return { id };
}
