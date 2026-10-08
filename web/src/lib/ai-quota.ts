import { rateLimit } from "@/lib/rate-limit";

/**
 * Teto de gerações por IA (auditoria OWASP CF-12): cada chamada ao Gemini/ChatGPT custa dinheiro
 * e gasta a cota da conta. Além dos limites por IP de cada rota (rajadas), vale:
 *
 * - por usuária: AI_USER_HOURLY_LIMIT por hora (padrão 120) e AI_USER_DAILY_LIMIT por 24 h
 *   (padrão 600) — chaves `ai:<userId>:h` e `ai:<userId>:d`;
 * - para o sistema todo: AI_GLOBAL_HOURLY_LIMIT por hora (padrão 1000) — chave `ai:global:h`.
 *
 * Uma "geração" é uma chamada à IA: legenda, ideia, resumo, pergunta ao assistente e cada LOTE
 * de legendas do calendário (até 6 posts por lote). Rotas que fazem várias chamadas consomem
 * várias unidades (ex.: títulos do mês das artes-base = 1 + uma por título).
 *
 * Usa o `rateLimit` (janela fixa em memória por instância — ver lib/rate-limit). Unidades são
 * consumidas uma a uma: se o teto estourar no meio de um pedido de várias, o que já foi contado
 * fica contado (a pessoa já estava no limite).
 */

export type AiQuotaScope = "user_hour" | "user_day" | "global_hour";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

export const AI_QUOTA_DEFAULTS = { userHourly: 120, userDaily: 600, globalHourly: 1000 } as const;

function envInt(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n >= 1 && n <= 1_000_000 ? n : fallback;
}

/** Limites em vigor (lidos do ambiente a cada chamada; inválido → padrão). */
export function aiQuotaLimits() {
  return {
    userHourly: envInt("AI_USER_HOURLY_LIMIT", AI_QUOTA_DEFAULTS.userHourly),
    userDaily: envInt("AI_USER_DAILY_LIMIT", AI_QUOTA_DEFAULTS.userDaily),
    globalHourly: envInt("AI_GLOBAL_HOURLY_LIMIT", AI_QUOTA_DEFAULTS.globalHourly),
  };
}

export type AiQuotaResult = { ok: true } | { ok: false; retryAfter: number; scope: AiQuotaScope };

/** Consome `units` gerações da usuária (e do total do sistema). */
export function consumeAiQuota(userId: string, units = 1): AiQuotaResult {
  const limits = aiQuotaLimits();
  const n = Math.max(1, Math.floor(units));
  const checks: { key: string; limit: number; windowMs: number; scope: AiQuotaScope }[] = [
    { key: `ai:${userId}:h`, limit: limits.userHourly, windowMs: HOUR, scope: "user_hour" },
    { key: `ai:${userId}:d`, limit: limits.userDaily, windowMs: DAY, scope: "user_day" },
    { key: "ai:global:h", limit: limits.globalHourly, windowMs: HOUR, scope: "global_hour" },
  ];
  for (let i = 0; i < n; i++) {
    for (const c of checks) {
      const r = rateLimit(c.key, c.limit, c.windowMs);
      if (!r.ok) return { ok: false, retryAfter: Math.max(1, r.retryAfter), scope: c.scope };
    }
  }
  return { ok: true };
}

/** "Tente de novo em X min." (ou "X h" quando passa de hora e meia). */
export function aiQuotaMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  const when = minutes <= 90 ? `${minutes} min` : `${Math.ceil(minutes / 60)} h`;
  return `Limite de gerações por IA atingido. Tente de novo em ${when}.`;
}

/**
 * Para as rotas: consome a cota e devolve o 429 pt-BR (com Retry-After) se estourou, ou null.
 * `label` só entra no log do servidor.
 */
export function enforceAiQuota(userId: string, units = 1, label = "ia"): Response | null {
  const r = consumeAiQuota(userId, units);
  if (r.ok) return null;
  console.warn(`[ai-quota] ${label}: limite ${r.scope} atingido (usuária ${userId}, ${units} unidade(s))`);
  return Response.json(
    { error: aiQuotaMessage(r.retryAfter), code: "AI_QUOTA" },
    { status: 429, headers: { "Retry-After": String(r.retryAfter), "Cache-Control": "no-store" } }
  );
}
