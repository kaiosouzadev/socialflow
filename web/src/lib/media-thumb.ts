import sharp from "sharp";

/**
 * "Lembrança" de posts publicados: miniatura jpeg (320px, ~10-20KB) em data
 * URI, gravada no Postgres. A mídia cheia fica no R2 por 30 dias e depois é
 * excluída — a miniatura permanece sem ocupar espaço no Cloudflare.
 * Vídeos não geram miniatura (sem ffmpeg) — a UI mostra um placeholder.
 */
export async function thumbFromUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    const out = await sharp(buffer)
      .resize(320, 320, { fit: "cover" })
      .jpeg({ quality: 60 })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return null; // lembrança é best-effort, nunca trava a publicação/limpeza
  }
}
