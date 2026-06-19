import { createHmac, timingSafeEqual } from "crypto";

/**
 * Assina/valida o acesso à mídia de um post. A URL é estável e não-adivinhável
 * (HMAC do postId). Imagens viram públicas ao serem postadas, então não há
 * dado sensível — a assinatura só evita enumeração da rota.
 */

function secret(): string {
  const s = process.env.MEDIA_SIGNING_SECRET;
  if (!s) throw new Error("MEDIA_SIGNING_SECRET não configurado");
  return s;
}

export function signMedia(postId: string): string {
  return createHmac("sha256", secret()).update(postId).digest("hex");
}

export function verifyMedia(postId: string, sig: string): boolean {
  const expected = signMedia(postId);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** URL absoluta da mídia, baixada pelo Graph API no momento da publicação. */
export function mediaUrlFor(postId: string): string {
  const base = (process.env.SYSTEM_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/api/media/${postId}?sig=${signMedia(postId)}`;
}
