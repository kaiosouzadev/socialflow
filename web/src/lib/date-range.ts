// Date-range helpers for filtering posts by day / week / month, in the
// São Paulo civil timezone. Brazil has no DST since 2019, so a fixed
// -03:00 offset is safe and keeps the math simple.

export type RangeKind = "day" | "week" | "month" | "all";

const TZ = "America/Sao_Paulo";
const pad = (n: number) => String(n).padStart(2, "0");

export function isRangeKind(v: string | undefined): v is RangeKind {
  return v === "day" || v === "week" || v === "month" || v === "all";
}

/** YYYY-MM-DD as seen in São Paulo, for `new Date()` or a given date. */
export function spDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDaysKey(key: string, days: number) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function weekdayOf(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
}

/** UTC instants [gte, lt) covering the range, or null for "all". */
export function dateWindow(range: RangeKind, ref: string): { gte: Date; lt: Date } | null {
  if (range === "all") return null;

  if (range === "day") {
    const start = new Date(`${ref}T00:00:00-03:00`);
    return { gte: start, lt: new Date(start.getTime() + 86400000) };
  }

  if (range === "week") {
    const startKey = addDaysKey(ref, -weekdayOf(ref));
    const start = new Date(`${startKey}T00:00:00-03:00`);
    return { gte: start, lt: new Date(start.getTime() + 7 * 86400000) };
  }

  // month
  const [y, m] = ref.split("-").map(Number);
  const start = new Date(`${y}-${pad(m)}-01T00:00:00-03:00`);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = new Date(`${ny}-${pad(nm)}-01T00:00:00-03:00`);
  return { gte: start, lt: end };
}

/** Previous/next reference key for the current range. */
export function shiftRef(range: RangeKind, ref: string, dir: -1 | 1): string {
  if (range === "day") return addDaysKey(ref, dir);
  if (range === "week") return addDaysKey(ref, dir * 7);
  if (range === "month") {
    const [y, m] = ref.split("-").map(Number);
    const total = (y * 12 + (m - 1)) + dir;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    return `${ny}-${pad(nm)}-01`;
  }
  return ref;
}

/** Human label for the active range, e.g. "junho de 2026". */
export function rangeLabel(range: RangeKind, ref: string): string {
  if (range === "all") return "Todas as datas";
  const at = new Date(`${ref}T12:00:00-03:00`);

  if (range === "day") {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: TZ,
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(at);
  }
  if (range === "month") {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, month: "long", year: "numeric" }).format(at);
  }
  // week
  const startKey = addDaysKey(ref, -weekdayOf(ref));
  const endKey = addDaysKey(startKey, 6);
  const f = (k: string) =>
    new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "short" }).format(
      new Date(`${k}T12:00:00-03:00`)
    );
  return `${f(startKey)} – ${f(endKey)}`;
}
