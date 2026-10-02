import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FORMAT, FORMAT_OPTIONS, POST_FORMATS, formatLabel, formatMeta, isPostFormat } from "../../src/lib/formats.ts";

describe("formats", () => {
  test("4 formatos, na ordem dos seletores atuais, com rótulo e tom", () => {
    assert.deepEqual([...POST_FORMATS], ["feed", "story", "carrossel", "reels"]);
    assert.deepEqual(
      FORMAT_OPTIONS.map((f) => [f.id, f.label, f.tone]),
      [
        ["feed", "Feed", "format-feed"],
        ["story", "Story", "format-story"],
        ["carrossel", "Carrossel", "format-carrossel"],
        ["reels", "Reels", "format-reels"],
      ]
    );
  });

  test("tons distintos por formato", () => {
    assert.equal(new Set(Object.values(FORMAT).map((f) => f.tone)).size, 4);
  });

  test("isPostFormat / formatMeta / formatLabel", () => {
    assert.equal(isPostFormat("reels"), true);
    assert.equal(isPostFormat("video"), false);
    assert.equal(isPostFormat(null), false);
    assert.equal(formatLabel("carrossel"), "Carrossel");
    assert.equal(formatMeta("video").label, "video");
    assert.equal(formatMeta("video").tone, "format-feed");
    assert.equal(formatLabel(undefined), "Feed");
  });
});
