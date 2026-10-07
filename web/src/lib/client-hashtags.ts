/**
 * Hashtags fixas do cliente (campo "Hashtags" do briefing): entram SEMPRE no fim de
 * toda legenda gerada pela IA (pedido do usuário em 07/10). A garantia é este código,
 * não o prompt — a IA é instruída a não pôr hashtags próprias, mas se puser, as linhas
 * finais só de hashtags são trocadas pelo bloco do cliente.
 *
 * Módulo puro (sem Prisma/rede): usado pelas rotas de IA, pelo lote semanal e pelo
 * plano básico. Legendas digitadas à mão pela equipe não passam por aqui.
 */

const toLf = (s: string) => s.replace(/\r\n?/g, "\n");

/** Bloco de hashtags do cliente (`briefing.hashtags`) como o usuário escreveu; null se vazio. */
export function clientHashtagBlock(briefing: unknown): string | null {
  if (!briefing || typeof briefing !== "object" || Array.isArray(briefing)) return null;
  const raw = (briefing as Record<string, unknown>).hashtags;
  if (typeof raw !== "string") return null;
  const block = toLf(raw).trim();
  return block || null;
}

const HASHTAG = /^#[\p{L}\p{N}_]/u;
const SEPARATOR = /^[|•·,;.\-–—]+$/u;

/** Linha formada só por hashtags (separadores soltos como "·" ou "|" são tolerados). */
function isHashtagOnlyLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  return (
    tokens.some((t) => HASHTAG.test(t)) && tokens.every((t) => HASHTAG.test(t) || SEPARATOR.test(t))
  );
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Garante o bloco de hashtags do cliente no fim da legenda gerada pela IA.
 * - sem bloco ou legenda vazia → devolve a legenda igual;
 * - já termina com o bloco (ignorando diferenças de espaço/quebra) → igual (idempotente);
 * - senão remove do FIM as linhas só de hashtags (as da IA) e anexa `\n\n` + bloco.
 * Hashtags no meio do texto (ou na mesma linha de uma frase) não são tocadas.
 */
export function withClientHashtags(caption: string, block: string | null): string {
  if (!block || !caption.trim()) return caption;
  const tags = toLf(block).trim();
  if (!tags) return caption;
  if (squash(caption).endsWith(squash(tags))) return caption;

  const lines = toLf(caption).split("\n");
  let end = lines.length;
  while (end > 0 && (!lines[end - 1].trim() || isHashtagOnlyLine(lines[end - 1]))) end--;
  const body = lines.slice(0, end).join("\n").trimEnd();
  return body ? `${body}\n\n${tags}` : tags;
}

/**
 * Trecho de prompt para quando o cliente tem hashtags fixas: a IA não deve inventar
 * as dela (o código anexa o bloco). null quando o cliente não tem bloco.
 */
export function hashtagPromptRule(block: string | null): string | null {
  return block
    ? "NÃO inclua hashtags nas legendas: as hashtags fixas do cliente são adicionadas automaticamente no fim."
    : null;
}
