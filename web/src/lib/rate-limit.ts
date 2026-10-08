/**
 * Limites de uso em memória.
 *
 * - `rateLimit` / `enforceRateLimit`: janela fixa por chave (rotas de IA, links públicos…).
 * - `loginGate` / `loginFailed` / `loginSucceeded`: tentativas de login — só as FALHAS
 *   contam, por e-mail+IP e por IP, com bloqueio curto e progressivo (ver LOGIN_LIMITS).
 * - `clientIp`: IP de quem chamou, só de cabeçalhos em que dá para confiar (ver abaixo).
 *
 * Limitação: o estado vive no processo. Na Vercel cada instância tem o seu contador e ele
 * zera quando a instância recomeça; para um teto global, complementar com uma regra de
 * limite do Vercel Firewall (ou trocar o Map por Redis/KV).
 */

type Entry = { count: number; resetAt: number };

const buckets = new Map<string, Entry>();
let lastSweep = 0;

function sweep(now: number) {
  // limpeza periódica para o mapa não crescer sem limite
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, e] of buckets) if (e.resetAt <= now) buckets.delete(k);
  sweepFailures(now);
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  sweep(now);

  const e = buckets.get(key);
  if (!e || e.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (e.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((e.resetAt - now) / 1000) };
  }
  e.count++;
  return { ok: true, retryAfter: 0 };
}

// ------------------------------------------------------------------ IP confiável

/** Primeiro valor de uma lista "a, b, c" (sem espaços), ou null. */
function firstOf(value: string | null): string | null {
  const v = value?.split(",")[0]?.trim();
  return v ? v : null;
}

/** Quantos proxies confiáveis (nossos) existem na frente do app fora da Vercel. Padrão 1. */
function trustedProxyHops(): number {
  const n = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "", 10);
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : 1;
}

function onVercel(): boolean {
  return process.env.VERCEL === "1" || process.env.VERCEL === "true";
}

let warnedUnknown = false;

/**
 * IP de quem chamou, para limites de uso e trilha de auditoria.
 *
 * Na Vercel (VERCEL=1): `x-vercel-forwarded-for` (a plataforma define e sobrescreve; o
 * cliente não consegue forjar), depois `x-real-ip` e `x-forwarded-for`, que a Vercel
 * também sobrescreve com o IP real.
 *
 * Fora da Vercel (VPS atrás de nginx/Caddy): o `x-forwarded-for` acumula "cliente, proxy1,
 * proxy2…" e cada proxy ACRESCENTA no fim o IP de quem se conectou a ele. Só o último salto
 * (o que o nosso proxy acrescentou) é confiável; os primeiros vêm de quem chamou e são
 * forjáveis. Com `TRUSTED_PROXY_HOPS=n` (n proxies nossos em cadeia), usa o n-ésimo a partir
 * do fim. Sem proxy algum, o próprio Next preenche o cabeçalho com o IP da conexão, mas só
 * quando ele não vem na requisição: servidor exposto direto não tem IP confiável (só dev).
 *
 * `x-vercel-forwarded-for` fora da Vercel é ignorado (qualquer um pode mandá-lo).
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  let ip: string | null = null;
  if (onVercel()) {
    ip = firstOf(h.get("x-vercel-forwarded-for")) ?? firstOf(h.get("x-real-ip")) ?? firstOf(h.get("x-forwarded-for"));
  } else {
    const hops = (h.get("x-forwarded-for") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (hops.length > 0) ip = hops[Math.max(0, hops.length - trustedProxyHops())];
    else ip = firstOf(h.get("x-real-ip"));
  }
  if (ip) return ip.slice(0, 64);
  if (!warnedUnknown) {
    warnedUnknown = true;
    console.warn("[rate-limit] requisição sem cabeçalho de IP; usando o grupo \"unknown\"");
  }
  return "unknown";
}

/**
 * Helper para rotas: aplica rate limit e devolve uma Response 429 se estourar,
 * ou null se liberado.
 */
export function enforceRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Response | null {
  const { ok, retryAfter } = rateLimit(key, limit, windowMs);
  if (ok) return null;
  return Response.json(
    { error: `Muitas requisições. Tente novamente em ${retryAfter}s.` },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

// ------------------------------------------------------------------ tentativas de login

/**
 * Regras do login (auditoria OWASP AC-06/CF-07). Só FALHAS contam (senha errada ou e-mail
 * inexistente); o login certo zera o contador de e-mail+IP.
 *
 * - e-mail+IP (falhas lembradas por 1 h): as 4 primeiras não esperam; a partir da 5ª, espera
 *   1 min, depois 2, 4, 8 e no máximo 15 min (contados da última falha). Quem erra a senha de
 *   outro IP não trava a dona da conta, e ela nunca espera mais de 15 min.
 * - IP: 20 falhas em 15 min (qualquer e-mail: password spraying) → 15 min de espera.
 * Tentativa durante a espera não confere senha nem conta falha (não prolonga o bloqueio).
 */
export const LOGIN_LIMITS = {
  ipEmail: { free: 4, windowMs: 60 * 60_000, baseLockMs: 60_000, maxLockMs: 15 * 60_000 },
  ip: { max: 20, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
} as const;

export type LoginScope = "ip_email" | "ip";

const failures = new Map<string, number[]>();
const MAX_FAILURE_KEYS = 20_000;
const LONGEST_WINDOW = Math.max(LOGIN_LIMITS.ipEmail.windowMs, LOGIN_LIMITS.ip.windowMs);

function sweepFailures(now: number) {
  for (const [k, list] of failures) {
    if (list.length === 0 || list[list.length - 1] <= now - LONGEST_WINDOW) failures.delete(k);
  }
}

function recent(key: string, now: number, windowMs: number): number[] {
  const list = failures.get(key);
  if (!list) return [];
  const from = now - windowMs;
  const kept = list.filter((t) => t > from);
  if (kept.length === 0) failures.delete(key);
  else if (kept.length !== list.length) failures.set(key, kept);
  return kept;
}

function push(key: string, now: number, windowMs: number) {
  const list = recent(key, now, windowMs);
  list.push(now);
  // guarda só o necessário para as regras (a espera máxima já vale com 9 falhas)
  failures.set(key, list.slice(-50));
  if (failures.size > MAX_FAILURE_KEYS) {
    sweepFailures(now);
    // ainda cheio: descarta as chaves mais antigas (ordem de inserção do Map)
    for (const k of failures.keys()) {
      if (failures.size <= MAX_FAILURE_KEYS * 0.9) break;
      failures.delete(k);
    }
  }
}

const ipKey = (ip: string) => `login:ip:${ip}`;
const ipEmailKey = (ip: string, email: string) => `login:ipemail:${ip}|${email.trim().toLowerCase()}`;
const byIp = (ip: string, now: number) => recent(ipKey(ip), now, LOGIN_LIMITS.ip.windowMs);
const byPair = (ip: string, email: string, now: number) => recent(ipEmailKey(ip, email), now, LOGIN_LIMITS.ipEmail.windowMs);

/** Espera (ms) do e-mail+IP depois de `n` falhas lembradas. */
function ipEmailLockMs(n: number): number {
  const { free, baseLockMs, maxLockMs } = LOGIN_LIMITS.ipEmail;
  if (n <= free) return 0;
  return Math.min(maxLockMs, baseLockMs * 2 ** (n - free - 1));
}

type GateState = { blocked: boolean; retryAfter: number; scope: LoginScope | null };

function state(ip: string, email: string, now: number): GateState {
  const ipList = byIp(ip, now);
  if (ipList.length >= LOGIN_LIMITS.ip.max) {
    const until = ipList[ipList.length - 1] + LOGIN_LIMITS.ip.lockMs;
    if (until > now) return { blocked: true, retryAfter: Math.ceil((until - now) / 1000), scope: "ip" };
  }
  const pairList = byPair(ip, email, now);
  const lock = ipEmailLockMs(pairList.length);
  if (lock > 0) {
    const until = pairList[pairList.length - 1] + lock;
    if (until > now) return { blocked: true, retryAfter: Math.ceil((until - now) / 1000), scope: "ip_email" };
  }
  return { blocked: false, retryAfter: 0, scope: null };
}

/** Antes de conferir a senha: o par e-mail+IP (ou o IP) está em espera? */
export function loginGate(ip: string, email: string, now = Date.now()): GateState {
  sweep(now);
  return state(ip, email, now);
}

/**
 * Registra uma falha de login. `lockedNow` diz se ESTA falha iniciou uma espera (para
 * registrar o bloqueio uma vez só na trilha de auditoria).
 */
export function loginFailed(
  ip: string,
  email: string,
  now = Date.now()
): { lockedNow: LoginScope | null; retryAfter: number; failures: number } {
  push(ipKey(ip), now, LOGIN_LIMITS.ip.windowMs);
  push(ipEmailKey(ip, email), now, LOGIN_LIMITS.ipEmail.windowMs);
  const after = state(ip, email, now);
  const pairCount = byPair(ip, email, now).length;
  const ipCount = byIp(ip, now).length;
  // a espera começou com ESTA falha (cruzou o limite agora); as esperas seguintes do mesmo
  // par (2, 4, 8 min…) não geram novo registro
  let lockedNow: LoginScope | null = null;
  if (ipCount === LOGIN_LIMITS.ip.max) lockedNow = "ip";
  else if (pairCount === LOGIN_LIMITS.ipEmail.free + 1) lockedNow = "ip_email";
  return { lockedNow, retryAfter: after.retryAfter, failures: pairCount };
}

/** Login certo: zera as falhas do e-mail+IP (as do IP ficam, para não abrir brecha ao spraying). */
export function loginSucceeded(ip: string, email: string): void {
  failures.delete(ipEmailKey(ip, email));
}

/**
 * E-mail mascarado para registro ("an***@agencia.com.br"): o que foi digitado no login pode
 * ser de outra pessoa ou ter erro de digitação; a trilha não guarda o endereço inteiro.
 */
export function maskEmailForLog(email: string): string {
  const value = email.trim().toLowerCase().slice(0, 254);
  const at = value.lastIndexOf("@");
  if (at < 0) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, Math.min(2, at))}***${value.slice(at)}`;
}

/** Só para testes: limpa todos os contadores. */
export function resetRateLimitsForTests(): void {
  buckets.clear();
  failures.clear();
  lastSweep = 0;
}
