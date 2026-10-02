import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  LATE_NO_TEXT_DAYS,
  STAGES,
  STAGE_META,
  approvalDeadline,
  isLate,
  productionStage,
  type ProductionStage,
} from "../../src/lib/production.ts";

const COM = "aprovacao_cliente";
const SEM = "sem_aprovacao";

describe("productionStage — os 5 estágios", () => {
  test("sem_texto: sem legenda e sem texto nos slides", () => {
    assert.equal(productionStage({ caption: null, plan: COM }), "sem_texto");
    assert.equal(productionStage({ caption: "   ", slides: [{ text: " " }], plan: SEM }), "sem_texto");
    // mesmo com o tema do cronograma aprovado, sem texto continua vermelho
    assert.equal(
      productionStage({ caption: "", schedule: { status: "aprovado_cliente" }, plan: COM }),
      "sem_texto"
    );
  });

  test("texto_ok: legenda (ou texto de slide) escrita", () => {
    assert.equal(productionStage({ caption: "Legenda", plan: SEM }), "texto_ok");
    assert.equal(productionStage({ caption: null, slides: [{ text: "Tela 1" }], plan: SEM }), "texto_ok");
    // cliente sem aprovação para em "Texto ok", qualquer que seja o cronograma
    assert.equal(productionStage({ caption: "x", schedule: { status: "aprovado_cliente" }, plan: SEM }), "texto_ok");
    // com aprovação, mas cronograma em rascunho / aprovado interno / sem cronograma
    assert.equal(productionStage({ caption: "x", schedule: { status: "rascunho" }, plan: COM }), "texto_ok");
    assert.equal(productionStage({ caption: "x", schedule: { status: "aprovado_interno" }, plan: COM }), "texto_ok");
    assert.equal(productionStage({ caption: "x", schedule: null, plan: COM }), "texto_ok");
  });

  test("em_aprovacao: cronograma enviado/em revisão ou post no link semanal", () => {
    assert.equal(productionStage({ caption: "x", schedule: { status: "enviado_cliente" }, plan: COM }), "em_aprovacao");
    assert.equal(productionStage({ caption: "x", schedule: { status: "em_revisao" }, plan: COM }), "em_aprovacao");
    assert.equal(
      productionStage({ caption: "x", schedule: { status: "aprovado_cliente" }, weeklyReviewId: "w1", plan: COM }),
      "em_aprovacao"
    );
  });

  test("tema_aprovado: cronograma do mês aprovado pelo cliente", () => {
    assert.equal(productionStage({ caption: "x", schedule: { status: "aprovado_cliente" }, plan: COM }), "tema_aprovado");
  });

  test("post_aprovado: aprovação semanal do post completo", () => {
    assert.equal(
      productionStage({ caption: "x", weeklyReviewId: "w1", clientApproval: "aprovado", plan: COM }),
      "post_aprovado"
    );
    assert.equal(productionStage({ caption: null, clientApproval: "aprovado", plan: COM }), "post_aprovado");
  });

  test("slides inválidos (Json qualquer) não quebram", () => {
    for (const slides of [null, "texto", 3, [null], [{ text: 1 }], {}]) {
      assert.equal(productionStage({ caption: null, slides, plan: SEM }), "sem_texto");
    }
  });
});

describe("STAGES", () => {
  test("5 estágios em ordem, com letra única e equivalência da planilha", () => {
    assert.deepEqual(
      STAGES.map((s) => s.id),
      ["sem_texto", "texto_ok", "em_aprovacao", "tema_aprovado", "post_aprovado"]
    );
    assert.deepEqual(
      STAGES.map((s) => s.sheetColor),
      ["vermelho", "verde", "amarelo", "azul", "magenta"]
    );
    assert.equal(new Set(STAGES.map((s) => s.letter)).size, 5);
    for (const s of STAGES) {
      assert.ok(s.label && s.sheetLabel && s.letter.length === 1);
      assert.equal(STAGE_META[s.id], s);
    }
  });
});

describe("isLate (A11)", () => {
  const now = new Date("2026-10-01T12:00:00-03:00");
  const sp = (s: string) => new Date(`${s}-03:00`);

  test(`sem_texto atrasa com data em até ${LATE_NO_TEXT_DAYS} dias (SP), inclusive passada`, () => {
    assert.equal(isLate("sem_texto", sp("2026-09-28T09:00:00"), now), true);
    assert.equal(isLate("sem_texto", sp("2026-10-01T20:00:00"), now), true);
    assert.equal(isLate("sem_texto", sp("2026-10-02T09:00:00"), now), true);
    assert.equal(isLate("sem_texto", sp("2026-10-04T23:30:00"), now), true);
    assert.equal(isLate("sem_texto", sp("2026-10-05T00:30:00"), now), false);
    assert.equal(isLate("sem_texto", "2026-10-20T12:00:00.000Z", now), false);
  });

  test("dias civis no fuso SP, não UTC", () => {
    // 23:30 em SP = 02:30 UTC do dia seguinte; o dia de SP ainda é 01/10
    const lateNight = new Date("2026-10-01T23:30:00-03:00");
    // 04/10 às 23:00 SP = 05/10 02:00 UTC → ainda é 04/10 em SP → atrasado
    assert.equal(isLate("sem_texto", sp("2026-10-04T23:00:00"), lateNight), true);
    assert.equal(isLate("sem_texto", sp("2026-10-05T09:00:00"), lateNight), false);
  });

  test("em_aprovacao atrasa só com o prazo de resposta vencido", () => {
    const post = sp("2026-10-10T09:00:00");
    assert.equal(isLate("em_aprovacao", post, now, sp("2026-09-30T23:59:59")), true);
    assert.equal(isLate("em_aprovacao", post, now, sp("2026-10-02T23:59:59")), false);
    assert.equal(isLate("em_aprovacao", post, now), false);
    assert.equal(isLate("em_aprovacao", post, now, null), false);
  });

  test("outros estágios nunca atrasam", () => {
    const past = sp("2026-09-01T09:00:00");
    for (const s of ["texto_ok", "tema_aprovado", "post_aprovado"] as ProductionStage[]) {
      assert.equal(isLate(s, past, now, sp("2026-09-01T00:00:00")), false, s);
    }
  });
});

describe("approvalDeadline", () => {
  test("link semanal → prazo do post (segunda → sexta anterior)", () => {
    const d = approvalDeadline({ scheduledAt: new Date("2026-10-12T09:00:00-03:00"), weeklyReviewId: "w" });
    assert.equal(d?.toISOString(), new Date("2026-10-09T23:59:59-03:00").toISOString());
  });
  test("cronograma enviado → dia 25 do mês anterior", () => {
    const d = approvalDeadline({
      scheduledAt: "2026-11-05T12:00:00.000Z",
      schedule: { status: "enviado_cliente", monthRef: new Date("2026-11-01T00:00:00.000Z") },
    });
    assert.equal(d?.toISOString(), new Date("2026-10-25T23:59:59-03:00").toISOString());
  });
  test("fora de aprovação → null", () => {
    assert.equal(
      approvalDeadline({ scheduledAt: new Date(), schedule: { status: "aprovado_cliente", monthRef: new Date() } }),
      null
    );
  });
});
