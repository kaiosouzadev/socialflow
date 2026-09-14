/**
 * Regras de prazo do fluxo de aprovação (tudo no fuso America/Sao_Paulo):
 *
 * CRONOGRAMA (mensal, só títulos):
 * - enviado ao cliente entre os dias 10 e 20 do mês ANTERIOR ao mês do cronograma;
 * - cliente tem até o dia 25 desse mês anterior para aprovar ou pedir ajuste;
 * - pediu ajuste em cima do prazo → cronograma espera a redatora resolver e,
 *   com o prazo vencido, aprova automaticamente ao resolver o último ajuste.
 *
 * POST COMPLETO (semanal): o cliente responde até:
 *   post de domingo  → quinta anterior   (-3 dias)
 *   post de segunda  → sexta anterior    (-3 dias)
 *   post de terça    → sexta anterior    (-4 dias)
 *   post de quarta   → segunda anterior  (-2 dias)
 *   post de quinta   → terça anterior    (-2 dias)
 *   post de sexta    → quarta anterior   (-2 dias)
 *   post de sábado   → quinta anterior   (-2 dias)
 */

const TZ = "America/Sao_Paulo";
const SP_OFFSET = "-03:00";
const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" como visto em São Paulo. */
export function spDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function spTodayKey(): string {
  return spDateKey(new Date());
}

/** dia da semana (0=dom) da data civil "YYYY-MM-DD". */
function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** fim do dia civil (23:59:59 em SP) como instante UTC. */
function endOfDaySp(key: string): Date {
  return new Date(`${key}T23:59:59${SP_OFFSET}`);
}

const RESPONSE_OFFSET: Record<number, number> = {
  0: -3, // domingo → quinta
  1: -3, // segunda → sexta
  2: -4, // terça → sexta
  3: -2, // quarta → segunda
  4: -2, // quinta → terça
  5: -2, // sexta → quarta
  6: -2, // sábado → quinta
};

/** Prazo de resposta do cliente para um post completo (fim do dia, SP). */
export function postResponseDeadline(scheduledAt: Date): Date {
  const key = spDateKey(scheduledAt);
  const offset = RESPONSE_OFFSET[weekdayOfKey(key)] ?? -2;
  return endOfDaySp(addDaysKey(key, offset));
}

/** "YYYY-MM" do mês anterior a um monthRef (Date no dia 1 do mês do cronograma). */
function prevMonthKeyOf(monthRef: Date): string {
  const y = monthRef.getUTCFullYear();
  const m = monthRef.getUTCMonth() + 1; // 1-12
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

/** Janela ideal de envio do cronograma: dias 10 a 20 do mês anterior. */
export function scheduleSendWindow(monthRef: Date): { start: Date; end: Date } {
  const pm = prevMonthKeyOf(monthRef);
  return {
    start: new Date(`${pm}-10T00:00:00${SP_OFFSET}`),
    end: endOfDaySp(`${pm}-20`),
  };
}

/** Prazo do cliente para aprovar/pedir ajuste: dia 25 do mês anterior (fim do dia SP). */
export function scheduleClientDeadline(monthRef: Date): Date {
  return endOfDaySp(`${prevMonthKeyOf(monthRef)}-25`);
}

/** Domingo (chave civil SP) da semana que contém a data. */
export function weekStartKey(date: Date): string {
  const key = spDateKey(date);
  return addDaysKey(key, -weekdayOfKey(key));
}

/** Domingo da PRÓXIMA semana em relação a agora (chave civil SP). */
export function nextWeekStartKey(now = new Date()): string {
  return addDaysKey(weekStartKey(now), 7);
}

/** Date (00:00 SP) a partir de uma chave civil. */
export function spDateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00${SP_OFFSET}`);
}

export function addDaysToKey(key: string, days: number): string {
  return addDaysKey(key, days);
}

/** rótulo curto "qui 10/09" para mensagens. */
export function shortLabel(d: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(d);
}
