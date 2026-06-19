// Valida o tratamento de datas SP (replica lib/format-date.ts).
const TZ = "America/Sao_Paulo";
const SP_OFFSET = "-03:00";

const fmtDateTime = (d) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(new Date(d));
function spWallClock(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`;
}
const spLocalInputToISO = (v) => new Date(`${v.length === 16 ? v + ":00" : v}${SP_OFFSET}`).toISOString();
const spLocalInputFromISO = (iso) => spWallClock(new Date(iso));

let pass = 0, fail = 0;
function check(name, got, expected) {
  const ok = got === expected;
  console.log(`  ${ok ? "✓" : "✗"} ${name}: ${got}${ok ? "" : ` (esperado ${expected})`}`);
  ok ? pass++ : fail++;
}

console.log("== Usuário escolhe 22/06/2026 18:00 (SP) ==");
const iso = spLocalInputToISO("2026-06-22T18:00");
check("vira UTC 21:00Z", iso, "2026-06-22T21:00:00.000Z");
check("exibe 22/06/2026 18:00", fmtDateTime(iso), "22/06/2026, 18:00");
check("input volta 22/06 18:00", spLocalInputFromISO(iso), "2026-06-22T18:00");

console.log("\n== Borda: meia-noite SP (00:00 do dia 22) ==");
const mn = spLocalInputToISO("2026-06-22T00:00");
check("vira UTC 03:00Z dia 22", mn, "2026-06-22T03:00:00.000Z");
check("exibe dia 22 (sem cair p/ 21)", fmtDateTime(mn), "22/06/2026, 00:00");

console.log("\n== Borda: 23:30 SP (vira dia seguinte em UTC) ==");
const late = spLocalInputToISO("2026-06-22T23:30");
check("vira UTC 02:30Z dia 23", late, "2026-06-23T02:30:00.000Z");
check("exibe dia 22 23:30 (não 23)", fmtDateTime(late), "22/06/2026, 23:30");

console.log("\n== Caso do bug relatado: instante salvo 2026-06-22T01:26Z ==");
check("exibe 21/06 22:26 (SP correto)", fmtDateTime("2026-06-22T01:26:38.893Z"), "21/06/2026, 22:26");

console.log(`\n=== ${pass} passou, ${fail} falhou ===`);
process.exit(fail === 0 ? 0 : 1);
