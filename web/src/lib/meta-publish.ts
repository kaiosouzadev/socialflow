import { createHmac } from "crypto";

/**
 * Publicação na Graph API (Meta) — lógica validada em produção (cobaia).
 * Suporta IG (feed, story, reels, carrossel) e FB (foto, vídeo, carrossel).
 * Regra de ouro: aguardar status_code=FINISHED de TODO container (inclusive
 * imagem) antes do media_publish, senão dá "Media ID is not available".
 */

const GRAPH = "https://graph.facebook.com/v21.0";

type Params = Record<string, string>;
export type PublishResult = { platform: string; ok: boolean; externalId?: string; error?: string };
export type MediaItem = { url: string; type: "image" | "video" };
export type PublishablePost = {
  format: string;
  mediaUrl: string | null;
  mediaItems: MediaItem[] | null;
  caption: string; // já resolvido por rede
};

function proof(token: string): string | null {
  const s = process.env.META_APP_SECRET;
  return s ? createHmac("sha256", s).update(token).digest("hex") : null;
}

async function graph(method: "GET" | "POST", pathUrl: string, params: Params, token: string) {
  const url = new URL(`${GRAPH}${pathUrl}`);
  url.searchParams.set("access_token", token);
  const p = proof(token);
  if (p) url.searchParams.set("appsecret_proof", p);
  if (method === "GET") for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const opt: RequestInit = { method };
  if (method === "POST") {
    opt.headers = { "Content-Type": "application/x-www-form-urlencoded" };
    opt.body = new URLSearchParams(params);
  }
  const res = await fetch(url, opt);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera o container ficar FINISHED (imagem é rápido; vídeo demora). */
async function waitReady(creationId: string, token: string, tries = 30, delayMs = 4000) {
  for (let i = 0; i < tries; i++) {
    const s = await graph("GET", `/${creationId}`, { fields: "status_code" }, token);
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR") throw new Error("processamento retornou ERROR");
    await sleep(delayMs);
  }
  throw new Error("timeout no processamento da mídia");
}

const isVideoUrl = (u: string) => /\.(mp4|mov|webm|m4v)$/i.test(u);

// ---------------- Instagram ----------------
async function igContainer(igId: string, token: string, params: Params): Promise<string> {
  const c = await graph("POST", `/${igId}/media`, params, token);
  return c.id as string;
}
async function igPublish(igId: string, token: string, creationId: string): Promise<string> {
  await waitReady(creationId, token);
  const r = await graph("POST", `/${igId}/media_publish`, { creation_id: creationId }, token);
  return r.id as string;
}

async function publishInstagram(
  igId: string,
  token: string,
  post: PublishablePost
): Promise<string> {
  const caption = post.caption;

  if (post.format === "carrossel") {
    const items = post.mediaItems ?? [];
    if (items.length < 2) throw new Error("carrossel precisa de 2+ mídias");
    const children: string[] = [];
    for (const it of items) {
      const id =
        it.type === "video"
          ? await igContainer(igId, token, { media_type: "VIDEO", video_url: it.url, is_carousel_item: "true" })
          : await igContainer(igId, token, { image_url: it.url, is_carousel_item: "true" });
      if (it.type === "video") await waitReady(id, token);
      children.push(id);
    }
    const parent = await igContainer(igId, token, {
      media_type: "CAROUSEL",
      children: children.join(","),
      caption,
    });
    return igPublish(igId, token, parent);
  }

  const url = post.mediaUrl;
  if (!url) throw new Error("post sem mídia");
  const video = isVideoUrl(url);

  let creationId: string;
  if (post.format === "story") {
    creationId = await igContainer(igId, token, video ? { media_type: "STORIES", video_url: url } : { media_type: "STORIES", image_url: url });
  } else if (post.format === "reels" || video) {
    creationId = await igContainer(igId, token, { media_type: "REELS", video_url: url, caption });
  } else {
    creationId = await igContainer(igId, token, { image_url: url, caption });
  }
  return igPublish(igId, token, creationId);
}

// ---------------- Facebook ----------------
async function publishFacebook(
  pageId: string,
  token: string,
  post: PublishablePost
): Promise<string> {
  const caption = post.caption;

  if (post.format === "carrossel") {
    const imgs = (post.mediaItems ?? []).filter((m) => m.type === "image");
    if (imgs.length === 0) throw new Error("carrossel FB precisa de imagens");
    const fbids: string[] = [];
    for (const it of imgs) {
      const r = await graph("POST", `/${pageId}/photos`, { url: it.url, published: "false" }, token);
      fbids.push(r.id as string);
    }
    const attached = fbids.map((id) => ({ media_fbid: id }));
    const r = await graph(
      "POST",
      `/${pageId}/feed`,
      { message: caption, attached_media: JSON.stringify(attached) },
      token
    );
    return (r.id as string) ?? "";
  }

  const url = post.mediaUrl;
  if (!url) throw new Error("post sem mídia");
  const video = isVideoUrl(url);

  // STORY no Facebook (Page Stories API)
  if (post.format === "story") {
    if (video) {
      const start = await graph("POST", `/${pageId}/video_stories`, { upload_phase: "start" }, token);
      const up = await fetch(start.upload_url as string, {
        method: "POST",
        headers: { Authorization: `OAuth ${token}`, file_url: url },
      });
      if (!up.ok) {
        const d = await up.text().catch(() => "");
        throw new Error(`upload story FB: ${up.status} ${d.slice(0, 150)}`);
      }
      const fin = await graph("POST", `/${pageId}/video_stories`, { upload_phase: "finish", video_id: start.video_id as string }, token);
      return (fin.post_id as string) || (start.video_id as string);
    }
    const ph = await graph("POST", `/${pageId}/photos`, { url, published: "false" }, token);
    const r = await graph("POST", `/${pageId}/photo_stories`, { photo_id: ph.id as string }, token);
    return (r.post_id as string) || (ph.id as string);
  }

  if (post.format === "reels" || video) {
    const r = await graph("POST", `/${pageId}/videos`, { file_url: url, description: caption }, token);
    return r.id as string;
  }
  // feed imagem → foto no feed
  const r = await graph("POST", `/${pageId}/photos`, { url, caption }, token);
  return (r.post_id as string) || (r.id as string);
}

/** Publica um post em uma plataforma. Lança erro com mensagem amigável. */
export async function publishToPlatform(
  platform: string,
  externalId: string,
  token: string,
  post: PublishablePost
): Promise<string> {
  if (platform === "instagram") return publishInstagram(externalId, token, post);
  if (platform === "facebook") return publishFacebook(externalId, token, post);
  throw new Error(`plataforma não suportada: ${platform}`);
}
