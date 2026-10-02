import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_STATUS,
  CLIENT_STATUS,
  CLIENT_STATUSES,
  PENDING_KIND,
  PENDING_KINDS,
  PLAN,
  PLANS,
  POST_STATUS,
  POST_STATUSES,
  SCHEDULE_STATUS,
  SCHEDULE_STATUSES,
  SEGMENT,
  SEGMENTS,
  TIER,
  labelOf,
  metaOf,
  type StatusMeta,
} from "../../src/lib/status-meta.ts";
import { FORMAT_OPTIONS } from "../../src/lib/formats.ts";
import { STAGES } from "../../src/lib/production.ts";

const MAPS: Record<string, Record<string, StatusMeta>> = {
  POST_STATUS,
  SCHEDULE_STATUS,
  CLIENT_STATUS,
  SEGMENT,
  PLAN,
  TIER,
  ACCOUNT_STATUS,
  PENDING_KIND,
};

// palavras em inglês que já apareceram como rótulo cru na UI
const ENGLISH =
  /\b(draft|scheduled|publishing|published|failed|active|inactive|pending|approved|review|sent|basic|complete|stand ?by|waiting|other|status)\b/i;

describe("status-meta", () => {
  test("nenhum rótulo em inglês nem igual à chave técnica em inglês", () => {
    for (const [name, map] of Object.entries(MAPS)) {
      for (const [key, meta] of Object.entries(map)) {
        assert.ok(meta.label.trim(), `${name}.${key} sem rótulo`);
        assert.doesNotMatch(meta.label, ENGLISH, `${name}.${key} = "${meta.label}"`);
        if (/^[a-z_]+$/.test(key)) assert.notEqual(meta.label, key, `${name}.${key} usa a chave como rótulo`);
      }
    }
  });

  test("formatos e estágios também em pt-BR", () => {
    for (const f of FORMAT_OPTIONS) assert.doesNotMatch(f.label, ENGLISH, f.id);
    for (const s of STAGES) assert.doesNotMatch(s.label, ENGLISH, s.id);
  });

  test("cada mapa cobre exatamente a sua lista de valores", () => {
    const pairs: [readonly string[], Record<string, StatusMeta>][] = [
      [POST_STATUSES, POST_STATUS],
      [SCHEDULE_STATUSES, SCHEDULE_STATUS],
      [CLIENT_STATUSES, CLIENT_STATUS],
      [SEGMENTS, SEGMENT],
      [PLANS, PLAN],
      [PENDING_KINDS, PENDING_KIND],
    ];
    for (const [list, map] of pairs) assert.deepEqual(Object.keys(map), [...list]);
  });

  test("rótulos existentes preservados (posts e cronogramas)", () => {
    assert.equal(POST_STATUS.scheduled.label, "Agendado");
    assert.equal(POST_STATUS.failed.label, "Falhou");
    assert.equal(SCHEDULE_STATUS.aprovado_interno.label, "Aprovado (interno)");
    assert.equal(SCHEDULE_STATUS.enviado_cliente.label, "Enviado ao cliente");
    assert.equal(PLAN.aprovacao_cliente.label, "Com aprovação");
  });

  test("metaOf/labelOf: valor desconhecido não quebra", () => {
    assert.deepEqual(metaOf(POST_STATUS, "draft"), { label: "Rascunho", tone: "neutral" });
    assert.equal(labelOf(PLAN, "sem_aprovacao"), "Sem aprovação");
    assert.deepEqual(metaOf(POST_STATUS, "xyz"), { label: "xyz", tone: "neutral" });
    assert.deepEqual(metaOf(POST_STATUS, null), { label: "", tone: "neutral" });
    assert.deepEqual(metaOf(POST_STATUS, "toString"), { label: "toString", tone: "neutral" });
  });
});
