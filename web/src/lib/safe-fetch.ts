import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import https from "node:https";
import { isIP } from "node:net";

/**
 * Busca de URL informada por usuária (mídia do post, arte-base, logo) sem SSRF
 * (OWASP AUD2-03 / A10):
 * - só `https:` na porta 443, sem usuário/senha na URL;
 * - o host não pode ser IP privado/loopback/link-local/metadata (IPv4, IPv6 e
 *   IPv4-mapeado) nem nome interno ("localhost", ".local", ".internal"…);
 * - o DNS é resolvido e conferido NA HORA DA CONEXÃO (a conexão usa o IP
 *   validado: um DNS que muda para 127.0.0.1 depois da checagem não passa);
 * - redirecionamento só se pedido, e cada salto passa por todas as checagens;
 * - tempo-limite total e teto de bytes (o corpo é lido em pedaços e cortado).
 * Lista de hosts permitidos opcional (`allowedHosts`: "host.exato" ou ".sufixo").
 */

export type SafeFetchErrorCode =
  | "url" // URL inválida, não https, porta ou credencial na URL
  | "host" // host fora da lista permitida, nome interno ou IP não público
  | "redirect" // redirecionamento não permitido (ou demais)
  | "status" // resposta não 2xx
  | "type" // content-type recusado
  | "too_large" // passou do teto de bytes
  | "timeout"
  | "network";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  constructor(code: SafeFetchErrorCode, message: string) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

export type SafeFetchOptions = {
  /** teto do corpo em bytes (obrigatório) */
  maxBytes: number;
  /** tempo-limite total, incluindo redirecionamentos (padrão 15 s) */
  timeoutMs?: number;
  /** "host.exato" ou ".sufixo.com"; ausente/vazio = qualquer host público */
  allowedHosts?: readonly string[];
  /** confere o content-type da resposta (sem parâmetros, minúsculo) */
  accept?: (contentType: string) => boolean;
  /** quantos redirecionamentos seguir, cada um revalidado (padrão 0 = nenhum) */
  maxRedirects?: number;
};

export type SafeFetchResult = { buffer: Buffer; contentType: string; finalUrl: string };

const DEFAULT_TIMEOUT_MS = 15_000;

// ------------------------------------------------------------ IPs

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** [rede, bits] IPv4 que nunca são destino válido (RFC 6890 e afins). */
const BLOCKED_V4: readonly [string, number][] = [
  ["0.0.0.0", 8], // "esta rede"
  ["10.0.0.0", 8], // privado
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (metadata de nuvem 169.254.169.254)
  ["172.16.0.0", 12], // privado
  ["192.0.0.0", 24], // IETF
  ["192.0.2.0", 24], // documentação
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // privado
  ["198.18.0.0", 15], // benchmark
  ["198.51.100.0", 24], // documentação
  ["203.0.113.0", 24], // documentação
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reservado + broadcast
];

function isPublicIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  for (const [net, bits] of BLOCKED_V4) {
    const base = ipv4ToInt(net)!;
    const size = 2 ** (32 - bits);
    if (n >= base && n < base + size) return false;
  }
  return true;
}

/** "::ffff:1.2.3.4", "2001:db8::1" → 8 grupos de 16 bits; null se inválido. */
function parseIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  if (s.includes(".", lastColon)) {
    const v4 = ipv4ToInt(s.slice(lastColon + 1));
    if (v4 === null) return null;
    tail = [Math.floor(v4 / 65536), v4 % 65536];
    s = `${s.slice(0, lastColon + 1)}0:0`; // placeholder com 2 grupos, trocado abaixo
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...rest].some((x) => Number.isNaN(x))) return null;
  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array(missing).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  if (tail.length) groups.splice(6, 2, ...tail);
  return groups;
}

function isPublicIpv6(ip: string): boolean {
  const g = parseIpv6(ip);
  if (!g) return false;
  const v4At = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  // ::/96 (inclui :: e ::1) e IPv4-mapeado ::ffff:0:0/96 → decide pelo IPv4 de dentro (só o mapeado)
  if (g.slice(0, 5).every((x) => x === 0)) {
    if (g[5] === 0xffff) return isPublicIpv4(v4At(g[6], g[7]));
    return false;
  }
  // NAT64 64:ff9b::/96 → IPv4 de dentro
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPublicIpv4(v4At(g[6], g[7]));
  // só unicast global 2000::/3
  if ((g[0] & 0xe000) !== 0x2000) return false; // fc00::/7 ULA, fe80::/10 link-local, ff00::/8 multicast, ::/8…
  if (g[0] === 0x2001 && g[1] < 0x200) return false; // 2001::/23 (Teredo, ORCHID, IETF)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentação
  if (g[0] === 0x2002) return isPublicIpv4(v4At(g[1], g[2])); // 6to4
  return true;
}

/** IP (v4 ou v6, com ou sem colchetes) roteável na internet pública. */
export function isPublicIp(ip: string): boolean {
  const bare = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  const v = isIP(bare.split("%")[0]);
  if (v === 4) return isPublicIpv4(bare);
  if (v === 6) return isPublicIpv6(bare);
  return false;
}

// ------------------------------------------------------------ hosts e URL

const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".home.arpa", ".corp", ".intranet", ".localdomain"];

function hostAllowed(host: string, allowed: readonly string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) return true;
  return allowed.some((a) => {
    const h = a.toLowerCase();
    return h.startsWith(".") ? host.endsWith(h) && host.length > h.length : host === h;
  });
}

/**
 * Confere a URL sem rede (esquema, porta, credencial, host interno, lista
 * permitida, IP literal). Devolve a URL normalizada ou lança SafeFetchError.
 */
export function assertSafeUrl(raw: string, allowedHosts?: readonly string[]): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SafeFetchError("url", "URL inválida");
  }
  if (u.protocol !== "https:") throw new SafeFetchError("url", "URL precisa ser https");
  if (u.username || u.password) throw new SafeFetchError("url", "URL com usuário/senha");
  if (u.port && u.port !== "443") throw new SafeFetchError("url", "porta não permitida");
  // o parser WHATWG já normaliza IPv4 escrito em octal/decimal ("0177.0.0.1", "2130706433" → 127.0.0.1);
  // o ponto final ("metadata.google.internal.") sai aqui
  const host = u.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host) throw new SafeFetchError("url", "URL sem host");
  const bare = host.startsWith("[") ? host.slice(1, -1) : host;
  if (isIP(bare)) {
    if (!isPublicIp(bare)) throw new SafeFetchError("host", "endereço interno não permitido");
  } else {
    if (host === "localhost" || !host.includes(".") || INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) {
      throw new SafeFetchError("host", "host interno não permitido");
    }
  }
  if (!hostAllowed(host, allowedHosts)) throw new SafeFetchError("host", "host fora da lista permitida");
  return u;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * `lookup` da conexão: resolve o nome e só deixa conectar se TODOS os
 * endereços forem públicos (um nome que resolve para 10.x e 8.8.8.8 é recusado).
 */
function guardedLookup(hostname: string, options: { all?: boolean; family?: number }, cb: LookupCallback): void {
  dnsLookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses) => {
    if (err) return cb(err, "");
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => !isPublicIp(a.address))) {
      const e = new SafeFetchError("host", "o nome resolve para endereço interno") as unknown as NodeJS.ErrnoException;
      return cb(e, "");
    }
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

function requestOnce(
  u: URL,
  opts: SafeFetchOptions,
  deadline: number
): Promise<{ status: number; location: string | null; contentType: string; buffer: Buffer | null }> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new SafeFetchError("timeout", "tempo esgotado"));
    let settled = false;
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      reject(e instanceof SafeFetchError ? e : new SafeFetchError("network", e.message || "falha de rede"));
    };
    const req = https.request(
      u,
      {
        method: "GET",
        lookup: guardedLookup as unknown as typeof dnsLookup,
        headers: { "user-agent": "SocialFlow/1.0", accept: "*/*" },
        // a família é a do IP validado; sem agente compartilhado (cada conexão passa pelo lookup)
        agent: false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (status >= 300 && status < 400) {
          settled = true;
          clearTimeout(timer);
          res.resume();
          req.destroy();
          return resolve({ status, location: (res.headers.location as string | undefined) ?? null, contentType, buffer: null });
        }
        if (status < 200 || status >= 300) return fail(new SafeFetchError("status", `resposta ${status}`));
        if (opts.accept && !opts.accept(contentType)) return fail(new SafeFetchError("type", `tipo ${contentType || "ausente"} recusado`));
        const declared = Number(res.headers["content-length"] ?? NaN);
        if (Number.isFinite(declared) && declared > opts.maxBytes) return fail(new SafeFetchError("too_large", "arquivo grande demais"));
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (c: Buffer) => {
          total += c.length;
          if (total > opts.maxBytes) return fail(new SafeFetchError("too_large", "arquivo grande demais"));
          chunks.push(c);
        });
        res.on("end", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ status, location: null, contentType, buffer: Buffer.concat(chunks, total) });
        });
        res.on("error", fail);
      }
    );
    const timer = setTimeout(() => fail(new SafeFetchError("timeout", "tempo esgotado")), remaining);
    req.on("error", fail);
    req.end();
  });
}

/** Próximo salto de um redirecionamento: o `Location` passa por TODAS as checagens de `assertSafeUrl`. */
export function nextHopUrl(location: string | null, current: URL, allowedHosts?: readonly string[]): URL {
  if (!location) throw new SafeFetchError("redirect", "redirecionamento sem destino");
  let next: string;
  try {
    next = new URL(location, current).href;
  } catch {
    throw new SafeFetchError("redirect", "redirecionamento inválido");
  }
  return assertSafeUrl(next, allowedHosts);
}

/** Baixa a URL com todas as defesas acima. Lança SafeFetchError (mensagem técnica: só para log). */
export async function safeFetchBuffer(raw: string, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let url = assertSafeUrl(raw, opts.allowedHosts);
  for (let hop = 0; ; hop++) {
    const r = await requestOnce(url, opts, deadline);
    if (r.buffer) return { buffer: r.buffer, contentType: r.contentType, finalUrl: url.href };
    if (hop >= (opts.maxRedirects ?? 0)) throw new SafeFetchError("redirect", "redirecionamento não permitido");
    url = nextHopUrl(r.location, url, opts.allowedHosts);
  }
}

// ------------------------------------------------------------ conteúdo de imagem

export type SafeImageType = "image/jpeg" | "image/png" | "image/webp";

/**
 * Tipo da imagem pelos primeiros bytes (não pelo nome nem pelo content-type):
 * só JPEG, PNG e WebP. SVG, HTML, HEIF/AVIF, GIF etc. → null.
 */
export function sniffImageType(buf: Uint8Array): SafeImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  return null;
}

/** Vídeo aceito para hospedar (MP4/MOV pela caixa "ftyp"; WebM pelo cabeçalho EBML). */
export function sniffVideoType(buf: Uint8Array): "video/mp4" | "video/quicktime" | "video/webm" | null {
  if (buf.length >= 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm";
  return null;
}
