/**
 * Cliente mínimo da Graph API (Meta) para um System User token.
 * Lê Páginas + contas Instagram que o Business administra. Somente leitura
 * de ativos; a publicação fica no n8n (WF-01).
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export type MetaAsset = {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  instagramId: string | null;
  instagramUsername: string | null;
};

async function graph<T = unknown>(
  path: string,
  token: string,
  params: Record<string, string> = {}
): Promise<T> {
  const url = new URL(`${GRAPH}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

/** Valida o token chamando /me. Retorna o nome do ator (business/usuário). */
export async function validateToken(token: string): Promise<{ id: string; name: string }> {
  return graph<{ id: string; name: string }>("/me", token, { fields: "id,name" });
}

/**
 * Lista as Páginas do Business + a conta IG vinculada a cada uma.
 * /me/accounts traz o token de cada Página (longa duração com System User token).
 */
export async function listAssets(token: string): Promise<MetaAsset[]> {
  const assets: MetaAsset[] = [];
  let after: string | undefined;

  do {
    const page = await graph<{
      data: { id: string; name: string; access_token: string }[];
      paging?: { cursors?: { after?: string }; next?: string };
    }>("/me/accounts", token, {
      fields: "id,name,access_token",
      limit: "100",
      ...(after ? { after } : {}),
    });

    for (const p of page.data ?? []) {
      let igId: string | null = null;
      let igUser: string | null = null;
      try {
        const ig = await graph<{
          instagram_business_account?: { id: string; username?: string };
        }>(`/${p.id}`, p.access_token, {
          fields: "instagram_business_account{id,username}",
        });
        if (ig.instagram_business_account) {
          igId = ig.instagram_business_account.id;
          igUser = ig.instagram_business_account.username ?? null;
        }
      } catch {
        // página sem IG vinculado ou sem permissão — segue sem IG
      }
      assets.push({
        pageId: p.id,
        pageName: p.name,
        pageAccessToken: p.access_token,
        instagramId: igId,
        instagramUsername: igUser,
      });
    }

    after = page.paging?.next ? page.paging?.cursors?.after : undefined;
  } while (after);

  return assets;
}

/** Acha um ativo (Página) específico pelo pageId, com o token atual. */
export async function getAsset(token: string, pageId: string): Promise<MetaAsset | null> {
  const all = await listAssets(token);
  return all.find((a) => a.pageId === pageId) ?? null;
}
