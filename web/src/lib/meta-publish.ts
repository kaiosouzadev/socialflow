import { assertGraphId, graphRequest, redactSecrets } from "@/lib/meta";

/**
 * Publicação na Graph API (Meta) — lógica validada em produção (cobaia).
 * Suporta IG (feed, story, reels, carrossel) e FB (foto, vídeo, carrossel).
 * Regra de ouro: aguardar status_code=FINISHED de TODO container (inclusive
 * imagem) antes do media_publish, senão dá "Media ID is not available".
 *
 * Segurança (OWASP CR-07/CF-15): o token vai SÓ no header Authorization
 * (lib/meta `graphRequest`); todo id que entra num caminho (`/{id}/...`) é
 * conferido como só dígitos; toda chamada tem timeout e a publicação inteira
 * respeita um prazo (`deadline`) abaixo do maxDuration da rota.
 */

type Params = Record<string, string>;
export type PublishResult = { platform: string; ok: boolean; externalId?: string; error?: string };
export type MediaItem = { url: string; type: "image" | "video" };
export type PublishablePost = {
  format: string;
  mediaUrl: string | null;
  mediaItems: MediaItem[] | null;
  caption: string; // já resolvido por rede
};
/** `deadline`: instante (ms, Date.now()) a partir do qual nenhuma chamada nova começa. */
export type PublishOptions = { deadline?: number };

/** Texto gravado quando o prazo da publicação acaba (o WF-03 tenta de novo). */
export const PUBLISH_TIMEOUT_ERROR =
  "A publicação demorou demais (a mídia ainda estava sendo processada pela rede) e será tentada de novo.";

function checkDeadline(opts: PublishOptions) {
  if (opts.deadline !== undefined && Date.now() > opts.deadline) throw new Error(PUBLISH_TIMEOUT_ERROR);
}

async function graph(method: "GET" | "POST", path: string, params: Params, token: string, opts: PublishOptions) {
  checkDeadline(opts);
  return graphRequest<Record<string, unknown>>(method, path, token, params);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera o container ficar FINISHED (imagem é rápido; vídeo demora). */
async function waitReady(creationId: string, token: string, opts: PublishOptions, tries = 30, delayMs = 4000) {
  const id = assertGraphId(creationId, "mídia");
  for (let i = 0; i < tries; i++) {
    const s = await graph("GET", `/${id}`, { fields: "status_code" }, token, opts);
    if (s.status_code === "FINISHED") return;
    if (s.status_code === "ERROR") throw new Error("processamento retornou ERROR");
    if (opts.deadline !== undefined && Date.now() + delayMs > opts.deadline) throw new Error(PUBLISH_TIMEOUT_ERROR);
    await sleep(delayMs);
  }
  throw new Error("timeout no processamento da mídia");
}

const isVideoUrl = (u: string) => /\.(mp4|mov|webm|m4v)$/i.test(u);

/** Id devolvido pela Graph (container, foto, vídeo) — só dígitos, ou erro. */
function idFrom(r: Record<string, unknown>, key: string, what: string): string {
  return assertGraphId(r[key], what);
}

// ---------------- Instagram ----------------
async function igContainer(igId: string, token: string, params: Params, opts: PublishOptions): Promise<string> {
  const c = await graph("POST", `/${igId}/media`, params, token, opts);
  return idFrom(c, "id", "mídia");
}
async function igPublish(igId: string, token: string, creationId: string, opts: PublishOptions): Promise<string> {
  await waitReady(creationId, token, opts);
  const r = await graph("POST", `/${igId}/media_publish`, { creation_id: creationId }, token, opts);
  return String(r.id ?? "");
}

async function publishInstagram(
  igUserId: string,
  token: string,
  post: PublishablePost,
  opts: PublishOptions
): Promise<string> {
  const igId = assertGraphId(igUserId, "conta do Instagram");
  const caption = post.caption;

  if (post.format === "carrossel") {
    const items = post.mediaItems ?? [];
    if (items.length < 2) throw new Error("carrossel precisa de 2+ mídias");
    const children: string[] = [];
    for (const it of items) {
      const id =
        it.type === "video"
          ? await igContainer(igId, token, { media_type: "VIDEO", video_url: it.url, is_carousel_item: "true" }, opts)
          : await igContainer(igId, token, { image_url: it.url, is_carousel_item: "true" }, opts);
      if (it.type === "video") await waitReady(id, token, opts);
      children.push(id);
    }
    const parent = await igContainer(
      igId,
      token,
      { media_type: "CAROUSEL", children: children.join(","), caption },
      opts
    );
    return igPublish(igId, token, parent, opts);
  }

  const url = post.mediaUrl;
  if (!url) throw new Error("post sem mídia");
  const video = isVideoUrl(url);
  if (post.format === "reels" && !video) {
    throw new Error("reels exige vídeo (mp4/mov) — a mídia atual é imagem");
  }

  let creationId: string;
  if (post.format === "story") {
    creationId = await igContainer(
      igId,
      token,
      video ? { media_type: "STORIES", video_url: url } : { media_type: "STORIES", image_url: url },
      opts
    );
  } else if (post.format === "reels" || video) {
    creationId = await igContainer(igId, token, { media_type: "REELS", video_url: url, caption }, opts);
  } else {
    creationId = await igContainer(igId, token, { image_url: url, caption }, opts);
  }
  return igPublish(igId, token, creationId, opts);
}

/**
 * Cota de publicação da conta do Instagram na própria Meta
 * (`/{ig-user-id}/content_publishing_limit`). `null` = resposta sem os números
 * (formato inesperado); erro HTTP/timeout lança (a rede conta como falha).
 */
export async function getInstagramPublishingQuota(
  igUserId: string,
  token: string,
  opts: PublishOptions = {}
): Promise<{ usage: number; total: number } | null> {
  const igId = assertGraphId(igUserId, "conta do Instagram");
  const r = await graph("GET", `/${igId}/content_publishing_limit`, { fields: "quota_usage,config" }, token, opts);
  const first = Array.isArray(r.data) ? (r.data[0] as Record<string, unknown> | undefined) : undefined;
  const usage = first?.quota_usage;
  const total = (first?.config as Record<string, unknown> | undefined)?.quota_total;
  if (typeof usage !== "number" || typeof total !== "number" || !Number.isFinite(usage) || !(total > 0)) return null;
  return { usage, total };
}

// ---------------- Facebook ----------------

/** O upload de vídeo de story só vai para o host de upload da própria Meta. */
function metaUploadUrl(raw: unknown): string {
  if (typeof raw === "string") {
    try {
      const u = new URL(raw);
      if (u.protocol === "https:" && (u.hostname === "facebook.com" || u.hostname.endsWith(".facebook.com"))) return u.href;
    } catch {
      /* cai no erro abaixo */
    }
  }
  throw new Error("A Meta devolveu um endereço de upload inesperado para o story.");
}

async function publishFacebook(
  facebookPageId: string,
  token: string,
  post: PublishablePost,
  opts: PublishOptions
): Promise<string> {
  const pageId = assertGraphId(facebookPageId, "Página do Facebook");
  const caption = post.caption;

  if (post.format === "carrossel") {
    const imgs = (post.mediaItems ?? []).filter((m) => m.type === "image");
    if (imgs.length === 0) throw new Error("carrossel FB precisa de imagens");
    const fbids: string[] = [];
    for (const it of imgs) {
      const r = await graph("POST", `/${pageId}/photos`, { url: it.url, published: "false" }, token, opts);
      fbids.push(idFrom(r, "id", "foto"));
    }
    const attached = fbids.map((id) => ({ media_fbid: id }));
    const r = await graph(
      "POST",
      `/${pageId}/feed`,
      { message: caption, attached_media: JSON.stringify(attached) },
      token,
      opts
    );
    return String(r.id ?? "");
  }

  const url = post.mediaUrl;
  if (!url) throw new Error("post sem mídia");
  const video = isVideoUrl(url);
  if (post.format === "reels" && !video) {
    throw new Error("reels exige vídeo (mp4/mov) — a mídia atual é imagem");
  }

  // STORY no Facebook (Page Stories API)
  if (post.format === "story") {
    if (video) {
      const start = await graph("POST", `/${pageId}/video_stories`, { upload_phase: "start" }, token, opts);
      const videoId = idFrom(start, "video_id", "vídeo");
      const uploadUrl = metaUploadUrl(start.upload_url);
      checkDeadline(opts);
      const up = await fetch(uploadUrl, {
        method: "POST",
        headers: { Authorization: `OAuth ${token}`, file_url: url },
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
      if (!up.ok) {
        const d = await up.text().catch(() => "");
        throw new Error(redactSecrets(`upload story FB: ${up.status} ${d.slice(0, 150)}`, token));
      }
      const fin = await graph(
        "POST",
        `/${pageId}/video_stories`,
        { upload_phase: "finish", video_id: videoId },
        token,
        opts
      );
      return String(fin.post_id ?? "") || videoId;
    }
    const ph = await graph("POST", `/${pageId}/photos`, { url, published: "false" }, token, opts);
    const photoId = idFrom(ph, "id", "foto");
    const r = await graph("POST", `/${pageId}/photo_stories`, { photo_id: photoId }, token, opts);
    return String(r.post_id ?? "") || photoId;
  }

  if (post.format === "reels" || video) {
    const r = await graph("POST", `/${pageId}/videos`, { file_url: url, description: caption }, token, opts);
    return String(r.id ?? "");
  }
  // feed imagem → foto no feed
  const r = await graph("POST", `/${pageId}/photos`, { url, caption }, token, opts);
  return String(r.post_id ?? "") || String(r.id ?? "");
}

/** Publica um post em uma plataforma. Lança erro com mensagem amigável (sem token). */
export async function publishToPlatform(
  platform: string,
  externalId: string,
  token: string,
  post: PublishablePost,
  opts: PublishOptions = {}
): Promise<string> {
  try {
    if (platform === "instagram") return await publishInstagram(externalId, token, post, opts);
    if (platform === "facebook") return await publishFacebook(externalId, token, post, opts);
  } catch (e) {
    // a mensagem nunca sai com o token (DOMException tem `message` só leitura: cria outro erro)
    const msg = e instanceof Error ? e.message : String(e);
    const clean = redactSecrets(msg, token);
    if (clean === msg) throw e;
    const safe = new Error(clean);
    safe.name = e instanceof Error ? e.name : "Error";
    throw safe;
  }
  throw new Error(`plataforma não suportada: ${platform}`);
}
