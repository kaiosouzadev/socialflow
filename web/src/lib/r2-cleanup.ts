import { prisma } from "@/lib/prisma";
import { deleteFromR2, r2KeyFromUrl } from "@/lib/r2";

/**
 * Limpeza segura de mídia de post no R2 (OWASP AUD2): antes, a limpeza
 * apagava QUALQUER objeto do R2 referenciado pelo post — inclusive a logo do
 * cliente ou uma arte-base compartilhada, se a URL delas fosse colada como
 * mídia. Agora só sai do R2:
 * - objeto sob um prefixo de mídia de POST: `posts/<cliente>/…` (upload),
 *   `arts/<cliente>/…` (arte gerada) e `<cliente>/<post>-<n>.<ext>` (sync do
 *   Drive) — nunca `logos/`, `templates/` nem `uploads/`;
 * - e só se nenhum OUTRO registro usa a mesma URL (outro post, logo de
 *   cliente, arte-base).
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const POST_MEDIA_KEY = new RegExp(`^(?:posts/(?:${UUID}|sem-cliente)/|arts/${UUID}/|${UUID}/)[A-Za-z0-9._-]{1,200}$`, "i");

/** A chave do R2 é de mídia de post (pode ser apagada pela limpeza)? */
export function isPostMediaKey(key: string): boolean {
  return POST_MEDIA_KEY.test(key) && !key.includes("..");
}

/** Outro registro (outro post, logo de cliente, arte-base) usa esta URL? */
export async function mediaUrlUsedElsewhere(url: string, postId: string): Promise<boolean> {
  const items = JSON.stringify([{ url }]);
  const rows = await prisma.$queryRaw<{ n: bigint | number }[]>`
    SELECT (
      (SELECT count(*) FROM posts WHERE id <> ${postId}::uuid AND (media_url = ${url} OR media_items @> ${items}::jsonb))
      + (SELECT count(*) FROM clients WHERE logo_url = ${url})
      + (SELECT count(*) FROM art_templates WHERE base_image_url = ${url})
    ) AS n`;
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * Apaga do R2 as mídias de um post que podem sair (ver acima). Devolve quantas
 * saíram (`freed`) e quantas ficaram por segurança (`kept`: fora do prefixo de
 * post ou usadas por outro registro). URL fora do R2 é ignorada.
 */
export async function deletePostMedia(postId: string, urls: readonly string[]): Promise<{ freed: number; kept: number }> {
  let freed = 0;
  let kept = 0;
  for (const url of new Set(urls)) {
    const key = r2KeyFromUrl(url);
    if (!key) continue;
    if (!isPostMediaKey(key) || (await mediaUrlUsedElsewhere(url, postId))) {
      kept++;
      continue;
    }
    await deleteFromR2(key);
    freed++;
  }
  return { freed, kept };
}
