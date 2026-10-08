/**
 * Guarda das chamadas que mudam estado em `/api/**` (auditoria OWASP CF-14/AC-09 e CF-16),
 * aplicada pelo `proxy.ts` antes de qualquer rota.
 *
 * CSRF: o cookie de sessão é SameSite=Lax, o que barra o POST vindo de OUTRO site, mas não de
 * uma página do mesmo site (outro subdomínio da agência, por exemplo) — essa página consegue
 * mandar `<form enctype="text/plain">` com a sessão da equipe. Por isso, em todo método que não
 * seja GET/HEAD/OPTIONS:
 *   1. `Sec-Fetch-Site` (quando o navegador manda) precisa ser `same-origin` (ou `none`);
 *   2. `Origin` precisa ser o do próprio sistema; sem `Origin`, vale o `Referer`; sem nenhum
 *      dos dois, recusa (todo navegador atual manda `Origin` em POST/PUT/PATCH/DELETE);
 *   3. com corpo, o `Content-Type` precisa ser `application/json` (ou `multipart/form-data` só
 *      no upload): `text/plain` e formulário comum não chegam às rotas;
 *   4. corpo declarado acima do teto (`Content-Length`) é recusado sem ser lido.
 *
 * Fora da guarda: `/api/auth/**` (NextAuth tem o próprio token CSRF e usa formulário) e as
 * chamadas do n8n em `/api/internal/**` com `x-internal-key` (navegador nenhum consegue mandar
 * esse cabeçalho de outro site sem CORS, que o sistema não libera). Chamada a `/api/internal/**`
 * SEM a chave (botão da tela, com sessão) passa pela guarda como as outras.
 */

export const REQUEST_GUARD_MESSAGES = {
  origin: "Ação recusada por segurança: o pedido não veio das telas do sistema. Recarregue a página e tente de novo.",
  contentType: "Formato de envio não aceito. Recarregue a página e tente de novo.",
  tooLarge: "O conteúdo enviado é grande demais.",
} as const;

/** Métodos que não mudam estado (nunca recusados pela guarda). */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Rotas que recebem multipart/form-data (arquivo). */
const MULTIPART_PATHS = new Set(["/api/upload"]);

/** Teto do corpo declarado: upload de 8 MB + folga do multipart; JSON em geral, 2 MB. */
export const BODY_LIMITS = {
  upload: 9 * 1024 * 1024,
  json: 2 * 1024 * 1024,
} as const;

export type GuardInput = {
  method: string;
  pathname: string;
  headers: Headers;
  /** origens aceitas (`https://host[:porta]`), ver allowedOriginsFor */
  allowedOrigins: Iterable<string>;
};

export type GuardRefusal = {
  status: 403 | 413 | 415;
  error: string;
  /** motivo curto para o log do servidor (nunca vai para a tela) */
  reason: string;
};

function originOf(value: string | null): string | null {
  if (!value || value === "null") return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** A rota está fora da guarda? */
export function isGuardExempt(pathname: string, headers: Headers): boolean {
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return true;
  if (pathname.startsWith("/api/internal/") && headers.has("x-internal-key")) return true;
  return false;
}

/**
 * Confere uma chamada a `/api/**`. Devolve null quando pode seguir, ou a recusa (status + texto
 * pt-BR para a tela + motivo para o log).
 */
export function checkApiRequest({ method, pathname, headers, allowedOrigins }: GuardInput): GuardRefusal | null {
  const m = method.toUpperCase();
  if (SAFE_METHODS.has(m)) return null;
  if (isGuardExempt(pathname, headers)) return null;

  const refuse = (status: GuardRefusal["status"], error: string, reason: string): GuardRefusal => ({
    status,
    error,
    reason,
  });

  // 1. o navegador diz de onde veio o pedido
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return refuse(403, REQUEST_GUARD_MESSAGES.origin, `sec-fetch-site=${site.slice(0, 20)}`);
  }

  // 2. Origin (ou Referer) do próprio sistema
  const allowed = new Set(allowedOrigins);
  const rawOrigin = headers.get("origin");
  const origin = rawOrigin !== null ? originOf(rawOrigin) : originOf(headers.get("referer"));
  if (!origin) {
    return refuse(403, REQUEST_GUARD_MESSAGES.origin, rawOrigin !== null ? "origin inválido" : "sem origin/referer");
  }
  if (!allowed.has(origin)) return refuse(403, REQUEST_GUARD_MESSAGES.origin, "origin de fora");

  // 3. tamanho declarado
  const declared = Number(headers.get("content-length") ?? "");
  const limit = MULTIPART_PATHS.has(pathname) ? BODY_LIMITS.upload : BODY_LIMITS.json;
  if (Number.isFinite(declared) && declared > limit) {
    return refuse(413, REQUEST_GUARD_MESSAGES.tooLarge, `content-length ${declared}`);
  }

  // 4. com corpo: só JSON (multipart só no upload)
  const hasBody = (Number.isFinite(declared) && declared > 0) || headers.has("transfer-encoding");
  if (hasBody) {
    const type = (headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const ok = type === "application/json" || (type === "multipart/form-data" && MULTIPART_PATHS.has(pathname));
    if (!ok) return refuse(415, REQUEST_GUARD_MESSAGES.contentType, `content-type=${type.slice(0, 40) || "(vazio)"}`);
  }
  return null;
}

/**
 * Origens aceitas para uma requisição: a do próprio pedido (Host / X-Forwarded-Host, em http e
 * https), a que o Next calculou e as configuradas (SYSTEM_BASE_URL, AUTH_URL). O navegador não
 * deixa uma página de outro site trocar o Host nem mandar X-Forwarded-Host (cabeçalho fora da
 * lista simples exige CORS), então comparar o Origin com eles é seguro contra CSRF.
 */
export function allowedOriginsFor(
  headers: Headers,
  requestOrigin: string,
  env: Record<string, string | undefined> = process.env
): Set<string> {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    const o = originOf(v ?? null);
    if (o) out.add(o);
  };
  add(requestOrigin);
  for (const name of ["host", "x-forwarded-host"]) {
    const host = headers.get(name)?.split(",")[0]?.trim();
    if (host && /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) {
      add(`https://${host}`);
      add(`http://${host}`);
    }
  }
  add(env.SYSTEM_BASE_URL);
  add(env.AUTH_URL);
  return out;
}

/** Resposta JSON da recusa (sem cache; o motivo técnico fica só no log). */
export function guardResponse(refusal: GuardRefusal): Response {
  return Response.json(
    { error: refusal.error },
    { status: refusal.status, headers: { "Cache-Control": "no-store" } }
  );
}
