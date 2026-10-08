import { createHash, randomBytes } from "crypto";

export const MAX_AI_EDITS = 5;

/** Token dos links públicos (mensal e semanal): 24 bytes do CSPRNG = 192 bits, base64url (32 caracteres). */
export function newApprovalToken(): string {
  return randomBytes(24).toString("base64url");
}

export function approvalLink(token: string, fallbackOrigin?: string): string {
  // SYSTEM_BASE_URL manda; sem ela, usa a origem da request (evita link relativo quebrado no e-mail)
  const base = (process.env.SYSTEM_BASE_URL ?? fallbackOrigin ?? "").replace(/\/$/, "");
  return `${base}/aprovar/${token}`;
}

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "junho de 2026" a partir do monthRef (Date). */
export function monthLabel(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

/* ------------------------------------------------------------------------------------------------
 * Ciclo de vida dos links públicos (/aprovar/[token] e /aprovar-semana/[token]).
 *
 * Decisão do usuário (07/10, OWASP AC-05/CR-05): "Expirar após conclusão + 60 dias".
 * - Aprovado (mensal) / concluído (semanal): o link vira SÓ LEITURA — nenhuma ação grava mais nada.
 * - 60 dias depois do envio o link deixa de valer (página "Este link expirou", ações → 410).
 * - Reenviar o cronograma gera um token NOVO (o antigo passa a 404) e renova o prazo.
 * Sem migração: o prazo conta de `sent_at`. Cronograma sem `sent_at` (anterior ao registro do envio)
 * conta de `created_at`, que nunca é posterior ao envio real — o prazo só pode ficar mais curto.
 * Sem data válida → expirado (falha fechada).
 * ---------------------------------------------------------------------------------------------- */

export const LINK_TTL_DAYS = 60;
const DAY_MS = 86_400_000;

export const OPEN_SCHEDULE_STATUSES: readonly string[] = ["enviado_cliente", "em_revisao"];
export const APPROVED_SCHEDULE_STATUSES: readonly string[] = ["aprovado_cliente", "aprovado_interno"];

/** Formato aceito na URL: base64url com tamanho plausível. Fora disso → 404 sem consultar o banco. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;
export function isTokenShaped(token: string): boolean {
  return TOKEN_SHAPE.test(token);
}

/** Identificador NÃO reversível do token (chave de rate limit / localStorage / log): nunca o token em si. */
export function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export function linkExpiresAt(sentAt: Date): Date {
  return new Date(sentAt.getTime() + LINK_TTL_DAYS * DAY_MS);
}

export function linkExpired(sentAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!(sentAt instanceof Date) || Number.isNaN(sentAt.getTime())) return true;
  return now.getTime() >= linkExpiresAt(sentAt).getTime();
}

export type MonthlyLinkState = "aberto" | "aprovado" | "fechado" | "expirado";

/** Estado do link MENSAL: expirado > aprovado (só leitura) > fechado (outro status) > aberto. */
export function monthlyLinkState(
  s: { status: string; sentAt: Date | null; createdAt: Date | null },
  now: Date = new Date()
): MonthlyLinkState {
  if (linkExpired(s.sentAt ?? s.createdAt, now)) return "expirado";
  if (APPROVED_SCHEDULE_STATUSES.includes(s.status)) return "aprovado";
  if (!OPEN_SCHEDULE_STATUSES.includes(s.status)) return "fechado";
  return "aberto";
}

export type WeeklyLinkState = "aberto" | "concluido" | "expirado";

/** Estado do link SEMANAL: expirado > concluído (só leitura) > aberto. */
export function weeklyLinkState(r: { status: string; sentAt: Date | null }, now: Date = new Date()): WeeklyLinkState {
  if (linkExpired(r.sentAt, now)) return "expirado";
  if (r.status === "concluido") return "concluido";
  return "aberto";
}

/* --------------------------------- respostas das APIs públicas --------------------------------- */

export const PUBLIC_LINK_MESSAGES = {
  invalid: "Link inválido",
  expired: "Este link expirou. Peça um novo link à agência.",
  approved: "Este cronograma já foi aprovado.",
  closed: "Este cronograma não está aberto para revisão no momento. Fale com a agência.",
  weekDone: "A revisão desta semana já foi concluída. Para mudar algo, fale com a agência.",
  tooLarge: "Mensagem muito grande. Encurte o texto e tente de novo.",
} as const;

/** Respostas das APIs públicas: nunca em cache (navegador/proxy) e nunca indexadas. */
export const PUBLIC_API_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
};

export function publicJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { ...PUBLIC_API_HEADERS } });
}

/** Acrescenta os cabeçalhos públicos numa resposta pronta (ex.: o 429 do rate limit). */
export function withPublicHeaders(res: Response): Response {
  for (const [k, v] of Object.entries(PUBLIC_API_HEADERS)) res.headers.set(k, v);
  return res;
}

export const linkNotFound = (): Response => publicJson({ error: PUBLIC_LINK_MESSAGES.invalid }, 404);
export const linkExpiredResponse = (): Response =>
  publicJson({ error: PUBLIC_LINK_MESSAGES.expired, code: "LINK_EXPIRED" }, 410);

/** Resposta para link mensal fora do estado "aberto" — sempre ANTES de qualquer gravação. */
export function monthlyLinkBlocked(state: MonthlyLinkState): Response | null {
  if (state === "expirado") return linkExpiredResponse();
  if (state === "aprovado") return publicJson({ error: PUBLIC_LINK_MESSAGES.approved, code: "SCHEDULE_APPROVED" }, 409);
  if (state === "fechado") return publicJson({ error: PUBLIC_LINK_MESSAGES.closed }, 409);
  return null;
}

/** Resposta para link semanal fora do estado "aberto" — sempre ANTES de qualquer gravação. */
export function weeklyLinkBlocked(state: WeeklyLinkState): Response | null {
  if (state === "expirado") return linkExpiredResponse();
  if (state === "concluido") return publicJson({ error: PUBLIC_LINK_MESSAGES.weekDone, code: "WEEK_CONCLUDED" }, 409);
  return null;
}

/* ------------------------------ corpo das ações públicas (CF-16) ------------------------------ */

/** Teto do corpo das ações públicas: o maior campo é um comentário de 2.000 caracteres. */
export const PUBLIC_BODY_MAX_BYTES = 32 * 1024;

export const bodyTooLarge = (): Response => publicJson({ error: PUBLIC_LINK_MESSAGES.tooLarge }, 413);

/** Content-Length declarado acima do teto: recusa sem ler nada. */
export function declaredBodyTooLarge(req: Request, max: number = PUBLIC_BODY_MAX_BYTES): boolean {
  const declared = Number(req.headers.get("content-length"));
  return Number.isFinite(declared) && declared > max;
}

/**
 * Lê o corpo JSON com teto: para de ler (e cancela o fluxo) assim que passa de `max` bytes,
 * mesmo sem Content-Length (chunked). JSON inválido → `value: null` (o zod recusa com 400).
 */
export async function readJsonCapped(
  req: Request,
  max: number = PUBLIC_BODY_MAX_BYTES
): Promise<{ tooLarge: true } | { tooLarge: false; value: unknown }> {
  if (declaredBodyTooLarge(req, max)) return { tooLarge: true };
  if (!req.body) return { tooLarge: false, value: null };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  try {
    return { tooLarge: false, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { tooLarge: false, value: null };
  }
}

/* ------------------------------------ páginas públicas ------------------------------------ */

/** Metadados das páginas públicas: nunca indexar nem seguir links (além do X-Robots-Tag global). */
export const PUBLIC_PAGE_ROBOTS = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: { index: false, follow: false },
};

/** Título da página de link expirado/inexistente (mesma página nos dois casos: não revela qual). */
export const EXPIRED_PAGE_TITLE = "Link expirado";

/* ------------------------------ rate limit por link (AC-08 / CF-07) ------------------------------ */

/** Ações por link por minuto (todas as rotas do link somadas, qualquer IP): o token é a parte fixa. */
export const LINK_ACTIONS_PER_MINUTE = 60;
/** Pedidos de ajuste por link por hora: cada um manda e-mail para a equipe. */
export const LINK_ADJUSTS_PER_HOUR = 40;
