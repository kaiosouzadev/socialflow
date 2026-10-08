import sharp from "sharp";
import { safeFetchBuffer, sniffImageType } from "@/lib/safe-fetch";

/**
 * "Lembrança" de posts publicados: miniatura jpeg (320px, ~10-20KB) em data
 * URI, gravada no Postgres. A mídia cheia fica no R2 por 30 dias e depois é
 * excluída — a miniatura permanece sem ocupar espaço no Cloudflare.
 * Vídeos não geram miniatura (sem ffmpeg) — a UI mostra um placeholder.
 *
 * Segurança (OWASP AUD2-03 SSRF e AUD-4 CF-03 sharp):
 * - a URL é baixada por `safeFetchBuffer` (só https público, DNS conferido na
 *   conexão, redirecionamento revalidado, 15 s, teto de 25 MB);
 * - só JPEG/PNG/WebP PELO CONTEÚDO (bytes iniciais) chegam ao sharp, e o
 *   libvips fica com os outros decodificadores bloqueados (SVG, HEIF/AVIF, GIF,
 *   TIFF, PDF…); imagem com mais de 40 megapixels é recusada.
 */

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const FETCH_TIMEOUT_MS = 15_000;

let decodersRestricted = false;

/** Deixa no libvips só os decodificadores de JPEG, PNG e WebP (vale para o processo). */
export function restrictImageDecoders(): void {
  if (decodersRestricted) return;
  sharp.block({ operation: ["VipsForeignLoad"] });
  sharp.unblock({ operation: ["VipsForeignLoadJpeg", "VipsForeignLoadPng", "VipsForeignLoadWebp"] });
  decodersRestricted = true;
}

/** Miniatura a partir dos bytes; null se não for JPEG/PNG/WebP de verdade ou se o sharp recusar. */
export async function thumbFromBuffer(buffer: Buffer): Promise<string | null> {
  if (!sniffImageType(buffer)) return null;
  try {
    restrictImageDecoders();
    const out = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .resize(320, 320, { fit: "cover" })
      .jpeg({ quality: 60 })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function thumbFromUrl(url: string): Promise<string | null> {
  try {
    const { buffer } = await safeFetchBuffer(url, {
      maxBytes: MAX_MEDIA_BYTES,
      timeoutMs: FETCH_TIMEOUT_MS,
      maxRedirects: 3,
      accept: (type) => type.startsWith("image/"),
    });
    return await thumbFromBuffer(buffer);
  } catch {
    return null; // lembrança é best-effort, nunca trava a publicação/limpeza
  }
}
