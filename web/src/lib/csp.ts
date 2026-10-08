/**
 * Content-Security-Policy das páginas (auditoria OWASP CF-08), montada no `proxy.ts` a cada
 * requisição com um nonce novo.
 *
 * - Scripts: só os que carregam o nonce desta resposta (o Next põe o nonce sozinho nos scripts
 *   dele quando lê o CSP do cabeçalho da requisição; o script de tema do layout raiz recebe o
 *   nonce por `x-nonce`). `'strict-dynamic'` deixa esses scripts carregarem os pedaços do app.
 *   Em dev o React precisa de `'unsafe-eval'` (pilhas de erro do servidor no navegador).
 * - Estilos: `'unsafe-inline'` — o app usa `style={…}` (cores de cliente, larguras) e o nonce
 *   não cobre atributos de estilo; o CSS em si vem de arquivo do próprio site.
 * - Imagens/vídeos: o próprio site, data:/blob: (miniaturas e prévias de upload), o R2 público
 *   (R2_PUBLIC_BASE_URL), as CDNs do Instagram/Facebook (foto de perfil na prévia do feed) e o
 *   Google (Drive). Hosts a mais, se um dia precisar: CSP_EXTRA_MEDIA_HOSTS (lista por vírgula).
 * - Rede (fetch): só o próprio site. Formulários: só para o próprio site. Ninguém embute as
 *   telas em iframe (`frame-ancestors 'none'`), nada de <object>/<embed> nem <base> de fora.
 */

/** CDNs fixas das prévias (foto de perfil do Instagram, imagens do Facebook, Drive). */
export const CSP_MEDIA_HOSTS = [
  "https://*.cdninstagram.com",
  "https://*.fbcdn.net",
  "https://*.googleusercontent.com",
  "https://drive.google.com",
] as const;

/**
 * Só em `next dev`: o banco de cópia tem mídias do R2 de produção e o `.env` de dev deixa
 * R2_PUBLIC_BASE_URL vazio. Em produção vale só o host exato do R2 configurado.
 */
export const CSP_DEV_MEDIA_HOSTS = ["https://*.r2.dev"] as const;

/** Nonce aleatório (128 bits) em base64, um por resposta. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Origem `https://host[:porta]` de um endereço configurado, ou null se não for http(s) válido.
 * Aceita também curinga de subdomínio (`https://*.exemplo.com`), que o CSP entende.
 */
export function cspSourceFrom(value: string | undefined | null): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const wildcard = /^https:\/\/\*\.([a-z0-9-]+\.)+[a-z]{2,}$/i;
  if (wildcard.test(raw)) return raw.toLowerCase();
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Origens de mídia vindas do ambiente: R2 público + CSP_EXTRA_MEDIA_HOSTS. */
export function mediaSourcesFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  const r2 = cspSourceFrom(env.R2_PUBLIC_BASE_URL);
  if (r2) out.push(r2);
  for (const part of (env.CSP_EXTRA_MEDIA_HOSTS ?? "").split(",")) {
    const src = cspSourceFrom(part);
    if (src) out.push(src);
  }
  return out;
}

export type CspOptions = {
  nonce: string;
  /** `next dev`: libera `'unsafe-eval'` e não força https */
  dev: boolean;
  /** R2 público e extras (ver mediaSourcesFromEnv) */
  mediaSources?: string[];
};

/** Valor do cabeçalho Content-Security-Policy (uma linha, diretivas separadas por "; "). */
export function buildCsp({ nonce, dev, mediaSources = [] }: CspOptions): string {
  if (!/^[A-Za-z0-9+/=]{16,}$/.test(nonce)) throw new Error("nonce inválido");
  const media = Array.from(new Set([...CSP_MEDIA_HOSTS, ...mediaSources, ...(dev ? CSP_DEV_MEDIA_HOSTS : [])]));
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${media.join(" ")}`,
    `media-src 'self' blob: ${media.join(" ")}`,
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (!dev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
