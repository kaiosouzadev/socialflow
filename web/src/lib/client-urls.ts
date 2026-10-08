/**
 * Endereços do cadastro do cliente (site, Instagram, Facebook, logo): só `https:` (AUD2-04).
 *
 * - "www.cliente.com.br", "instagram.com/cliente" (sem esquema) e "//x.com" → https://…
 * - "http://…" → https://… (normaliza; nada na web do cliente deveria exigir http hoje)
 * - Instagram "@cliente" → https://www.instagram.com/cliente
 * - `javascript:`, `data:`, `vbscript:`, `file:`, `mailto:`, `ftp:` (qualquer outro esquema),
 *   endereço com usuário/senha, espaço ou caractere de controle → recusado (400 pt-BR por campo).
 *
 * Guarda o texto como a pessoa digitou (só com o esquema na frente), sem barra final acrescentada:
 * a arte gerada mostra o site sem o "https://" (lib/basic-plan).
 */

export const CLIENT_URL_FIELDS = ["website", "instagramUrl", "facebookUrl", "logoUrl"] as const;
export type ClientUrlField = (typeof CLIENT_URL_FIELDS)[number];

/** Texto do 400 de cada campo (N-14: frase pt-BR, sem detalhe técnico). */
export const CLIENT_URL_MESSAGES: Record<ClientUrlField, string> = {
  website: "O site precisa ser um endereço da web, como www.cliente.com.br.",
  instagramUrl: "O Instagram precisa ser um endereço da web, como instagram.com/cliente.",
  facebookUrl: "O Facebook precisa ser um endereço da web, como facebook.com/cliente.",
  logoUrl: "A logo não tem um endereço válido. Envie a imagem de novo.",
};

const MAX_LENGTH: Record<ClientUrlField, number> = {
  website: 200,
  instagramUrl: 200,
  facebookUrl: 200,
  logoUrl: 2000,
};

/** "esquema:" no começo, sem ponto antes dos dois-pontos (senão é "dominio.com:porta"). */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const INSTAGRAM_HANDLE = /^@([A-Za-z0-9._]{1,30})$/;
// espaço, controle e barra invertida (o navegador trata "\" como "/")
const FORBIDDEN_CHARS = /[\s\u0000-\u001f\u007f\\]/;

export type ClientUrlResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Normaliza um endereço do cadastro. Vazio (ou só espaços) → `""` (a rota decide se limpa).
 * Retorna o texto com `https://` ou o erro pt-BR do campo.
 */
export function normalizeClientUrl(field: ClientUrlField, raw: string): ClientUrlResult {
  const fail = { ok: false as const, error: CLIENT_URL_MESSAGES[field] };
  let value = raw.trim();
  if (!value) return { ok: true, value: "" };
  if (value.length > MAX_LENGTH[field] || FORBIDDEN_CHARS.test(value)) return fail;

  if (field === "instagramUrl") {
    const handle = INSTAGRAM_HANDLE.exec(value);
    if (handle) return { ok: true, value: `https://www.instagram.com/${handle[1]}` };
  }

  if (value.startsWith("//")) value = `https:${value}`;
  const scheme = SCHEME.exec(value)?.[1];
  if (scheme && !scheme.includes(".")) {
    const lower = scheme.toLowerCase();
    if (lower !== "http" && lower !== "https") return fail; // javascript:, data:, mailto:, ftp:…
    if (!value.slice(scheme.length + 1).startsWith("//")) return fail; // "https:x.com"
    value = `https:${value.slice(scheme.length + 1)}`;
  } else {
    value = `https://${value}`;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail;
  }
  if (url.protocol !== "https:" || url.username || url.password) return fail;
  // domínio de verdade (com ponto), sem "https://localhost" nem "https://@x"
  if (!url.hostname || !url.hostname.includes(".") || url.hostname.startsWith(".") || url.hostname.endsWith(".")) {
    return fail;
  }
  if (value.length > MAX_LENGTH[field]) return fail;
  return { ok: true, value };
}

/**
 * Aplica `normalizeClientUrl` nos campos de endereço presentes em `data` (mutando-o).
 * Retorna o primeiro erro (campo + texto) ou null.
 */
export function normalizeClientUrlFields(
  data: Record<string, unknown>,
): { field: ClientUrlField; error: string } | null {
  for (const field of CLIENT_URL_FIELDS) {
    const v = data[field];
    if (typeof v !== "string") continue;
    const r = normalizeClientUrl(field, v);
    if (!r.ok) return { field, error: r.error };
    data[field] = r.value;
  }
  return null;
}
