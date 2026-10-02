/**
 * Datas/horários SEMPRE no fuso de São Paulo (UTC-3, sem DST desde 2019),
 * independente do fuso do servidor ou do navegador. Fonte única da verdade
 * para exibição e para converter os inputs datetime-local.
 */

export const TZ = "America/Sao_Paulo";
const SP_OFFSET = "-03:00";

function asDate(d: Date | string): Date {
  return typeof d === "string" ? new Date(d) : d;
}

/** "21/06/2026 22:26" no fuso SP. */
export function formatDateTime(d: Date | string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    dateStyle: "short",
    timeStyle: "short",
  }).format(asDate(d));
}

/** "21/06/2026" no fuso SP. */
export function formatDate(d: Date | string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, dateStyle: "short" }).format(asDate(d));
}

/** { day, time } no fuso SP — para montar grade de calendário. */
export function spDayTime(d: Date | string): { day: number; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(asDate(d))
      .map((p) => [p.type, p.value])
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return { day: Number(parts.day), time: `${hour}:${parts.minute}` };
}

/** Componentes de relógio de parede SP no formato do input datetime-local. */
function spWallClock(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  const hour = parts.hour === "24" ? "00" : parts.hour; // alguns runtimes retornam "24" à meia-noite
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

/** Valor inicial do datetime-local = agora, em horário de SP. */
export function spNowLocalInput(): string {
  return spWallClock(new Date());
}

/** Converte um instante (ISO/Date) para o relógio de parede SP do datetime-local. */
export function spLocalInputFromISO(iso: Date | string): string {
  return spWallClock(asDate(iso));
}

/**
 * Interpreta o valor do datetime-local ("YYYY-MM-DDTHH:mm") COMO horário de SP
 * e devolve o instante UTC em ISO. Assim o dia/hora escolhido é sempre tratado
 * como São Paulo, não importa o fuso do navegador.
 */
export function spLocalInputToISO(value: string): string {
  // value pode vir "YYYY-MM-DDTHH:mm" ou com segundos
  const v = value.length === 16 ? `${value}:00` : value;
  return new Date(`${v}${SP_OFFSET}`).toISOString();
}

/** Primeira letra maiúscula (pt-BR), o resto intacto: "setembro de 2026" → "Setembro de 2026". */
export function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase("pt-BR") + s.slice(1) : s;
}

/**
 * Rótulo do mês com inicial maiúscula (no lugar do `capitalize` do CSS, que
 * capitalizaria também o "de"): "Setembro de 2026"; `{ withYear: false }` → "Setembro".
 * - "AAAA-MM" e "AAAA-MM-DD" são datas civis (sem fuso);
 * - Date e ISO com hora são lidos no fuso SP.
 * Para `Schedule.monthRef` (@db.Date, meia-noite UTC) passe a chave civil:
 * `formatMonthLabel(monthRef.toISOString().slice(0, 7))`.
 */
export function formatMonthLabel(value: Date | string, opts?: { withYear?: boolean }): string {
  const key = typeof value === "string" ? /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(value) : null;
  // dia 15 ao meio-dia UTC: nunca muda de mês em SP
  const d = key ? new Date(Date.UTC(Number(key[1]), Number(key[2]) - 1, 15, 12)) : asDate(value);
  const withYear = opts?.withYear ?? true;
  const label = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(d);
  return capitalizeFirst(label);
}
