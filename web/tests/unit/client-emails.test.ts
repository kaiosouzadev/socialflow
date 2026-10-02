import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EXTRA_EMAILS,
  clientRecipients,
  isValidEmail,
  normalizeExtraEmails,
} from "../../src/lib/client-emails.ts";

describe("normalizeExtraEmails", () => {
  test("trim, minúsculas, duplicatas e o principal removidos (critério do S14)", () => {
    const r = normalizeExtraEmails("Principal@x.example.com", [
      " A@x.example.com ",
      "a@x.example.com",
      "principal@x.example.com",
    ]);
    assert.deepEqual(r, { ok: true, emails: ["a@x.example.com"] });
  });

  test("vazios são ignorados e a ordem é preservada", () => {
    const r = normalizeExtraEmails("p@example.com", ["", "  ", "b@example.com", "c@example.com", "B@EXAMPLE.COM"]);
    assert.deepEqual(r, { ok: true, emails: ["b@example.com", "c@example.com"] });
  });

  test("e-mail inválido → erro com o item", () => {
    const r = normalizeExtraEmails("p@example.com", ["ok@example.com", " nao-e-email ", "a@b"]);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.deepEqual(r.invalid, ["nao-e-email", "a@b"]);
      assert.match(r.error, /inválidos/);
    }
  });

  test("11 e-mails adicionais → erro de limite", () => {
    const list = Array.from({ length: MAX_EXTRA_EMAILS + 1 }, (_, i) => `e${i}@example.com`);
    const r = normalizeExtraEmails("p@example.com", list);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /No máximo 10/);
  });

  test("10 adicionais passam; 11 itens com 1 duplicata também (10 únicos)", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `e${i}@example.com`);
    assert.deepEqual(normalizeExtraEmails("p@example.com", ten), { ok: true, emails: ten });
    const r = normalizeExtraEmails("p@example.com", [...ten, "E0@example.com"]);
    assert.deepEqual(r, { ok: true, emails: ten });
  });

  test("sem principal", () => {
    assert.deepEqual(normalizeExtraEmails(null, ["a@example.com"]), { ok: true, emails: ["a@example.com"] });
  });
});

describe("clientRecipients", () => {
  test("principal primeiro, sem vazios, duplicatas nem maiúsculas", () => {
    assert.deepEqual(
      clientRecipients({
        email: "Principal@Example.com",
        extraEmails: ["", "b@example.com", "PRINCIPAL@example.com", "B@example.com", "c@example.com"],
      }),
      ["principal@example.com", "b@example.com", "c@example.com"]
    );
  });

  test("inválidos vindos do banco são ignorados", () => {
    assert.deepEqual(clientRecipients({ email: "p@example.com", extraEmails: ["invalido", "x@example.com"] }), [
      "p@example.com",
      "x@example.com",
    ]);
  });

  test("11 adicionais no banco → no máximo 10 adicionais (11 destinatários)", () => {
    const extras = Array.from({ length: 11 }, (_, i) => `e${i}@example.com`);
    const r = clientRecipients({ email: "p@example.com", extraEmails: extras });
    assert.equal(r.length, 11);
    assert.equal(r[0], "p@example.com");
    assert.ok(!r.includes("e10@example.com"));
  });

  test("sem extraEmails (null/undefined) e sem principal", () => {
    assert.deepEqual(clientRecipients({ email: "p@example.com", extraEmails: null }), ["p@example.com"]);
    assert.deepEqual(clientRecipients({ email: "p@example.com" }), ["p@example.com"]);
    assert.deepEqual(clientRecipients({ email: "", extraEmails: ["a@example.com"] }), ["a@example.com"]);
  });
});

describe("isValidEmail", () => {
  test("mesma regra do zod", () => {
    assert.equal(isValidEmail("a@x.example.com"), true);
    assert.equal(isValidEmail("a@b"), false);
    assert.equal(isValidEmail("x..y@a.com"), false);
  });
});
