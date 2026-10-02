import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { capitalizeFirst, formatMonthLabel } from "../../src/lib/format-date.ts";

describe("formatMonthLabel", () => {
  test('"Setembro de 2026" a partir de AAAA-MM, Date e ISO', () => {
    assert.equal(formatMonthLabel("2026-09"), "Setembro de 2026");
    assert.equal(formatMonthLabel(new Date("2026-09-15T12:00:00-03:00")), "Setembro de 2026");
    assert.equal(formatMonthLabel("2026-03-10T12:00:00.000Z"), "Março de 2026");
  });

  test("data civil AAAA-MM-DD não sofre deslocamento de fuso", () => {
    assert.equal(formatMonthLabel("2026-10-01"), "Outubro de 2026");
    assert.equal(formatMonthLabel(new Date("2026-10-01T00:00:00.000Z").toISOString().slice(0, 7)), "Outubro de 2026");
  });

  test("usa o fuso SP: 01/10 00:30 UTC ainda é setembro em SP", () => {
    assert.equal(formatMonthLabel(new Date("2026-10-01T00:30:00.000Z")), "Setembro de 2026");
  });

  test("sem o ano", () => {
    assert.equal(formatMonthLabel("2026-12", { withYear: false }), "Dezembro");
  });
});

describe("capitalizeFirst", () => {
  test("só a primeira letra", () => {
    assert.equal(capitalizeFirst("setembro de 2026"), "Setembro de 2026");
    assert.equal(capitalizeFirst("éter"), "Éter");
    assert.equal(capitalizeFirst(""), "");
  });
});
