/**
 * Rate limiter simples em memória (janela fixa).
 *
 * Limitação: o estado vive no processo — em deploy com múltiplas instâncias
 * cada uma tem seu contador. Para um VPS de instância única já protege bem
 * contra brute force/abuso. Para escala horizontal, trocar por Redis.
 */

type Entry = { count: number; resetAt: number };

const buckets = new Map<string, Entry>();
let lastSweep = 0;

function sweep(now: number) {
  // limpeza periódica para o mapa não crescer sem limite
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, e] of buckets) if (e.resetAt <= now) buckets.delete(k);
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

/** Extrai um IP de identificação a partir dos headers de proxy. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
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
