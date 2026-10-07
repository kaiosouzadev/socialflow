/**
 * F13-APROVACOES: lógica pura da página /aprovacoes (app/(app)/aprovacoes/schedules-view.ts).
 *   - grupos: "Precisa de ação" (rascunho, aprovado interno, em revisão), "Aguardando o cliente",
 *     "Aprovados"; status desconhecido cai em "Precisa de ação";
 *   - cronogramas com 0 posts saem dos grupos e vão para a lista de vazios;
 *   - ordem: última atividade (máx. entre criação, envio, aprovação, ajuste pedido e o post mais
 *     novo), o mais recente primeiro — calendário salvo hoje num cronograma antigo sobe ao topo;
 *   - selo "Novo" (< 24 h: cronograma criado ou posts novos) e "Atualizado hoje" (dia civil de SP);
 *   - filtros da URL (cliente sem acento, mês, status) e contagem.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildScheduleView,
  compareByActivity,
  countLabel,
  filtersQuery,
  freshnessOf,
  groupOf,
  hasActiveFilters,
  lastActivity,
  matchesFilters,
  monthOptions,
  NO_FILTERS,
  parseScheduleFilters,
  type ActivityInput,
  type ViewRow,
} from "../../src/app/(app)/aprovacoes/schedules-view.ts";

const sp = (s: string) => new Date(`${s}-03:00`);
const NOW = sp("2026-10-07T15:00:00");
const H = 3_600_000;

function act(over: Partial<ActivityInput>): ActivityInput {
  return { createdAt: sp("2026-08-27T10:00:00"), sentAt: null, approvedAt: null, changesAskedAt: null, latestPostAt: null, ...over };
}

type Row = ViewRow & { month: string };
function row(id: string, over: Partial<Row>): Row {
  return { id, client: "Cliente", monthKey: "2026-11", month: "Novembro de 2026", status: "rascunho", posts: 3, lastActivity: 0, ...over };
}

describe("grupos", () => {
  test("status → grupo", () => {
    assert.equal(groupOf("rascunho"), "acao");
    assert.equal(groupOf("aprovado_interno"), "acao");
    assert.equal(groupOf("em_revisao"), "acao");
    assert.equal(groupOf("enviado_cliente"), "cliente");
    assert.equal(groupOf("aprovado_cliente"), "aprovados");
    assert.equal(groupOf("??"), "acao");
  });
});

describe("última atividade e selo", () => {
  test("máximo entre criação, envio, aprovação, ajuste pedido e post mais novo", () => {
    const a = act({ sentAt: sp("2026-09-01T10:00:00"), changesAskedAt: sp("2026-09-05T10:00:00"), latestPostAt: sp("2026-10-07T14:50:00") });
    assert.equal(lastActivity(a).getTime(), sp("2026-10-07T14:50:00").getTime());
    assert.equal(lastActivity(act({})).getTime(), sp("2026-08-27T10:00:00").getTime());
    assert.equal(lastActivity(act({ approvedAt: sp("2026-09-20T09:00:00") })).getTime(), sp("2026-09-20T09:00:00").getTime());
  });

  test("cronograma criado há < 24 h → Novo", () => {
    assert.equal(freshnessOf(act({ createdAt: new Date(NOW.getTime() - 2 * H) }), NOW), "novo");
    assert.equal(freshnessOf(act({ createdAt: new Date(NOW.getTime() - 23.9 * H) }), NOW), "novo");
  });

  test("cronograma antigo (27/08) com posts salvos agora → Novo (o caso da Coletivo de novembro)", () => {
    assert.equal(freshnessOf(act({ latestPostAt: new Date(NOW.getTime() - 10 * 60_000) }), NOW), "novo");
  });

  test("24 h ou mais → não é Novo", () => {
    const old = new Date(NOW.getTime() - 24 * H);
    assert.equal(freshnessOf(act({ createdAt: old, latestPostAt: old }), NOW), null);
  });

  test("envio/aprovação/ajuste hoje (SP), sem conteúdo novo → Atualizado hoje", () => {
    assert.equal(freshnessOf(act({ sentAt: sp("2026-10-07T09:00:00") }), NOW), "atualizado");
    assert.equal(freshnessOf(act({ approvedAt: sp("2026-10-07T00:10:00") }), NOW), "atualizado");
    assert.equal(freshnessOf(act({ changesAskedAt: sp("2026-10-07T14:00:00") }), NOW), "atualizado");
  });

  test("“hoje” é o dia civil de SP: 23h de ontem não é “Atualizado hoje”", () => {
    const earlyNow = sp("2026-10-07T01:00:00");
    assert.equal(freshnessOf(act({ sentAt: sp("2026-10-06T23:00:00") }), earlyNow), null);
    assert.equal(freshnessOf(act({ sentAt: sp("2026-10-07T00:30:00") }), earlyNow), "atualizado");
  });
});

describe("montagem da lista", () => {
  const rows: Row[] = [
    // o cronograma ANTIGO de novembro que recebeu o calendário agora
    row("coletivo-nov", { client: "Coletivo", posts: 24, lastActivity: sp("2026-10-07T14:55:00").getTime() }),
    row("coletivo-dez", { client: "Coletivo", monthKey: "2026-12", month: "Dezembro de 2026", posts: 2, lastActivity: sp("2026-09-04T10:00:00").getTime() }),
    row("jose-out", { client: "José Flávio", monthKey: "2026-10", month: "Outubro de 2026", posts: 0, lastActivity: sp("2026-10-07T14:50:00").getTime() }),
    row("balt-nov", { client: "Balt Brasil", status: "enviado_cliente", posts: 0, lastActivity: sp("2026-10-06T11:41:00").getTime() }),
    row("nucleo-rev", { client: "NucleoCorr", status: "em_revisao", posts: 24, lastActivity: sp("2026-10-05T10:00:00").getTime() }),
    row("franquia", { client: "Franquia Brazil", monthKey: "2026-09", month: "Setembro de 2026", status: "enviado_cliente", posts: 15, lastActivity: sp("2026-09-11T15:08:00").getTime() }),
    row("ap1", { client: "A", monthKey: "2026-08", month: "Agosto de 2026", status: "aprovado_cliente", posts: 1, lastActivity: sp("2026-09-01T10:00:00").getTime() }),
    row("ap2", { client: "B", monthKey: "2026-10", month: "Outubro de 2026", status: "aprovado_cliente", posts: 1, lastActivity: sp("2026-09-20T10:00:00").getTime() }),
    row("ap-vazio", { client: "C", monthKey: "2026-08", month: "Agosto de 2026", status: "aprovado_cliente", posts: 0, lastActivity: sp("2026-08-19T10:00:00").getTime() }),
  ];

  test("vazios fora dos grupos; grupos na ordem; mais recente primeiro dentro do grupo", () => {
    const v = buildScheduleView(rows, NO_FILTERS);
    assert.deepEqual(v.groups.map((g) => g.id), ["acao", "cliente", "aprovados"]);
    assert.deepEqual(v.groups[0].rows.map((r) => r.id), ["coletivo-nov", "nucleo-rev", "coletivo-dez"]);
    assert.deepEqual(v.groups[1].rows.map((r) => r.id), ["franquia"]);
    assert.deepEqual(v.groups[2].rows.map((r) => r.id), ["ap2", "ap1"]);
    assert.deepEqual(v.empty.map((r) => r.id), ["jose-out", "balt-nov", "ap-vazio"]);
    for (const g of v.groups) for (const r of g.rows) assert.ok(r.posts > 0, `${r.id} tem 0 posts e está num grupo`);
    assert.equal(v.total, 6);
    assert.equal(v.shown, 6);
  });

  test("grupo sem cronograma não aparece", () => {
    const v = buildScheduleView(rows.filter((r) => r.status !== "enviado_cliente"), NO_FILTERS);
    assert.deepEqual(v.groups.map((g) => g.id), ["acao", "aprovados"]);
  });

  test("empate na atividade: cliente A→Z, depois mês mais novo", () => {
    const t = 1000;
    const sorted = [row("b", { client: "Beta", lastActivity: t }), row("a2", { client: "alfa", monthKey: "2026-10", lastActivity: t }), row("a1", { client: "Alfa", monthKey: "2026-12", lastActivity: t })].sort(compareByActivity);
    assert.deepEqual(sorted.map((r) => r.id), ["a1", "a2", "b"]);
  });

  test("filtros valem para a lista e para os vazios; contagem", () => {
    const f = { ...NO_FILTERS, q: "jose" };
    const v = buildScheduleView(rows, f);
    assert.equal(v.groups.length, 0);
    assert.deepEqual(v.empty.map((r) => r.id), ["jose-out"]);
    const byMonth = buildScheduleView(rows, { ...NO_FILTERS, mes: "2026-11" });
    assert.deepEqual(byMonth.groups.flatMap((g) => g.rows.map((r) => r.id)), ["coletivo-nov", "nucleo-rev"]);
    assert.deepEqual(byMonth.empty.map((r) => r.id), ["balt-nov"]);
    assert.equal(byMonth.shown, 2);
    assert.equal(countLabel(byMonth.shown, byMonth.total, true), "2 de 6 cronogramas");
    const byStatus = buildScheduleView(rows, { ...NO_FILTERS, status: "enviado_cliente" });
    assert.deepEqual(byStatus.groups.map((g) => g.id), ["cliente"]);
  });

  test("busca sem acento e sem maiúsculas", () => {
    assert.ok(matchesFilters({ client: "José Flávio Commandulli", monthKey: "2026-10", status: "rascunho" }, { ...NO_FILTERS, q: "FLAVIO" }));
    assert.ok(!matchesFilters({ client: "Coletivo", monthKey: "2026-10", status: "rascunho" }, { ...NO_FILTERS, q: "jose" }));
  });

  test("meses existentes, do mais novo ao mais antigo, sem repetir", () => {
    assert.deepEqual(monthOptions(rows).map((m) => m.value), ["2026-12", "2026-11", "2026-10", "2026-09", "2026-08"]);
    assert.equal(monthOptions(rows)[0].label, "Dezembro de 2026");
  });
});

describe("filtros da URL", () => {
  test("valores válidos passam; inválidos viram “sem filtro”", () => {
    assert.deepEqual(parseScheduleFilters({ q: "  Coletivo ", mes: "2026-11", status: "enviado_cliente" }), {
      q: "Coletivo",
      mes: "2026-11",
      status: "enviado_cliente",
    });
    assert.deepEqual(parseScheduleFilters({ q: ["a", "b"], mes: "2026-13", status: "xpto" }), { q: "a", mes: "", status: "" });
    assert.deepEqual(parseScheduleFilters({}), NO_FILTERS);
    assert.equal(parseScheduleFilters({ q: "x".repeat(200) }).q.length, 80);
  });

  test("query sem os vazios; ida e volta", () => {
    assert.equal(filtersQuery(NO_FILTERS), "");
    const f = { q: "José", mes: "2026-10", status: "rascunho" };
    const qs = filtersQuery(f);
    assert.equal(qs, "?q=Jos%C3%A9&mes=2026-10&status=rascunho");
    assert.deepEqual(parseScheduleFilters(Object.fromEntries(new URLSearchParams(qs))), f);
    assert.ok(hasActiveFilters(f));
    assert.ok(!hasActiveFilters({ ...NO_FILTERS, q: "   " }));
  });

  test("contagem", () => {
    assert.equal(countLabel(1, 1, false), "1 cronograma");
    assert.equal(countLabel(12, 12, false), "12 cronogramas");
    assert.equal(countLabel(12, 12, true), "12 cronogramas");
    assert.equal(countLabel(0, 12, true), "0 de 12 cronogramas");
  });
});
