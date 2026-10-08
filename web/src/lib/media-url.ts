import { SafeFetchError, assertSafeUrl } from "@/lib/safe-fetch";

/**
 * Validação das URLs de mídia gravadas pela equipe (OWASP AUD2-04):
 * `mediaUrl` do post e `baseImageUrl` da arte-base.
 * - só `https:` (nada de `javascript:`, `data:`, `http:`…), sem usuário/senha,
 *   porta padrão e host público (nunca localhost, IP privado ou nome interno);
 * - arte-base (`r2Only`): com o armazenamento configurado, só do R2 público
 *   (a tela de Artes-base sempre sobe o arquivo para lá). A mídia do post pode
 *   ser uma URL pública colada (recurso do campo "Mídia do post").
 * Sem rede: a busca em si passa por `safeFetchBuffer`, que confere o DNS.
 * Mensagens em pt-BR, sem detalhe técnico (N-14).
 */

export const MEDIA_URL_MAX = 2048;

/** Host do R2 público (R2_PUBLIC_BASE_URL); null se não configurado. */
export function r2PublicHost(): string | null {
  const base = process.env.R2_PUBLIC_BASE_URL?.trim();
  if (!base) return null;
  try {
    return new URL(base).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** null = URL aceita; senão, a frase (pt-BR) para o 400. */
export function mediaUrlProblem(raw: string, opts: { r2Only?: boolean } = {}): string | null {
  const v = raw.trim();
  if (v.length > MEDIA_URL_MAX) return "O link da mídia é longo demais.";
  // sem "https://" literal na frase: o `toUserMessage` da tela troca texto com URL por uma frase genérica
  if (!/^https:\/\//i.test(v)) return "O link da mídia precisa ser um endereço seguro (https).";
  const r2 = opts.r2Only ? r2PublicHost() : null;
  try {
    assertSafeUrl(v, r2 ? [r2] : undefined);
  } catch (e) {
    if (e instanceof SafeFetchError && e.code === "host" && r2) {
      return "Use uma imagem enviada pelo sistema (botão de envio), não um link de outro site.";
    }
    return "Esse link de mídia não é permitido. Use um endereço https público ou envie o arquivo.";
  }
  return null;
}
