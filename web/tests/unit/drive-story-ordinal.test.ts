/**
 * P4-D (ADENDO 1, A2): vários stories do mesmo post no Drive.
 * Pedido do usuário: "O segundo story do mesmo post: pode ser 4story2.jpg e
 * assim por diante" → Nstory, Nstory2, Nstory3… (regras puras do drive-layout).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMonthFileNames,
  buildMonthIndex,
  isStoryName,
  parseArtStem,
  storyFileStem,
} from "../../src/lib/drive-layout.ts";

type P = { id: string; format: string };
const stems = (posts: P[]) => Object.fromEntries([...buildMonthFileNames(posts)].map(([id, n]) => [id, n.fileStem]));

describe("buildMonthFileNames: Nstory, Nstory2, Nstory3…", () => {
  test("reels nº4 + story junto + story avulso seguinte → 4story.jpg e 4story2.jpg (caso N-23)", () => {
    const posts: P[] = [
      { id: "f1", format: "feed" },
      { id: "f2", format: "feed" },
      { id: "c3", format: "carrossel" },
      { id: "r4", format: "reels" },
      { id: "s4junto", format: "story" }, // sai 15 min depois do reels
      { id: "s4avulso", format: "story" }, // story avulso: herda o N do reels
      { id: "f5", format: "feed" },
    ];
    const got = buildMonthFileNames(posts);
    assert.deepEqual(got.get("r4"), { index: 4, storyOrdinal: null, fileStem: "4" });
    assert.deepEqual(got.get("s4junto"), { index: 4, storyOrdinal: 1, fileStem: "4story" });
    assert.deepEqual(got.get("s4avulso"), { index: 4, storyOrdinal: 2, fileStem: "4story2" });
    assert.deepEqual(stems(posts), { f1: "1", f2: "2", c3: "3", r4: "4", s4junto: "4story", s4avulso: "4story2", f5: "5" });
  });

  test("3 stories do mesmo N → Nstory, Nstory2, Nstory3", () => {
    const posts: P[] = [
      { id: "f1", format: "feed" },
      { id: "f2", format: "feed" },
      { id: "a", format: "story" },
      { id: "b", format: "story" },
      { id: "c", format: "story" },
    ];
    assert.deepEqual(stems(posts), { f1: "1", f2: "2", a: "2story", b: "2story2", c: "2story3" });
    assert.deepEqual(
      ["a", "b", "c"].map((id) => buildMonthFileNames(posts).get(id)?.storyOrdinal),
      [1, 2, 3]
    );
  });

  test("story antes de qualquer post → 1story; o story do post 1 → 1story2", () => {
    const posts: P[] = [
      { id: "antes", format: "story" },
      { id: "f1", format: "feed" },
      { id: "s1", format: "story" },
    ];
    assert.deepEqual(stems(posts), { antes: "1story", f1: "1", s1: "1story2" });
  });

  test("a ordem do story recomeça em cada N", () => {
    const posts: P[] = [
      { id: "f1", format: "feed" },
      { id: "s1", format: "story" },
      { id: "s1b", format: "story" },
      { id: "c2", format: "carrossel" },
      { id: "s2", format: "story" },
    ];
    assert.deepEqual(stems(posts), { f1: "1", s1: "1story", s1b: "1story2", c2: "2", s2: "2story" });
  });

  test("um único story por N continua \"Nstory\" (nada muda para quem já usa a regra antiga)", () => {
    const posts: P[] = [
      { id: "f1", format: "feed" },
      { id: "s1", format: "story" },
      { id: "r2", format: "reels" },
      { id: "s2", format: "story" },
    ];
    assert.deepEqual(stems(posts), { f1: "1", s1: "1story", r2: "2", s2: "2story" });
  });

  test("mês vazio", () => {
    assert.equal(buildMonthFileNames([]).size, 0);
  });

  test("index = buildMonthIndex e ordens 1..k consecutivas por N (500 sequências pseudoaleatórias)", () => {
    const formats = ["feed", "story", "carrossel", "reels", "story"];
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let i = 0; i < 500; i++) {
      const posts: P[] = Array.from({ length: Math.floor(rnd() * 25) }, (_, k) => ({
        id: `p${k}`,
        format: formats[Math.floor(rnd() * formats.length)],
      }));
      const idx = buildMonthIndex(posts);
      const names = buildMonthFileNames(posts);
      const seen = new Map<number, number>();
      for (const p of posts) {
        const n = names.get(p.id);
        assert.ok(n);
        assert.equal(n.index, idx.get(p.id));
        if (p.format === "story") {
          const expected = (seen.get(n.index) ?? 0) + 1;
          seen.set(n.index, expected);
          assert.equal(n.storyOrdinal, expected);
          assert.equal(n.fileStem, storyFileStem(n.index, expected));
        } else {
          assert.equal(n.storyOrdinal, null);
          assert.equal(n.fileStem, String(n.index));
        }
      }
    }
  });

  test("storyFileStem", () => {
    assert.equal(storyFileStem(4, 1), "4story");
    assert.equal(storyFileStem(4, 2), "4story2");
    assert.equal(storyFileStem(12, 3), "12story3");
  });
});

describe("parseArtStem: o N e a ordem do story no nome do arquivo", () => {
  const stem = (name: string) => name.replace(/\.[^.]+$/, "");

  test("2º story do post 4: variações aceitas", () => {
    for (const name of ["4story2.jpg", "4 story 2.jpg", "4-story-2.jpg", "04_STORY_2.png", "4story2.mp4", "4 - story - 2.jpg", "4story_2_final.jpg"]) {
      assert.deepEqual(parseArtStem(stem(name)), { kind: "story", index: 4, ordinal: 2 }, name);
    }
  });

  test("1º story: sem número, ou \"Nstory1\" como sinônimo", () => {
    for (const name of ["4story.jpg", "4 story.png", "4-story.jpg", "04_STORY.jpg", "4 - story.jpg", "4story1.jpg", "4 story 1.jpg", "4story_final.jpg", "4story.v2.jpg"]) {
      assert.deepEqual(parseArtStem(stem(name)), { kind: "story", index: 4, ordinal: 1 }, name);
    }
  });

  test("3º story e ordem com zero à esquerda", () => {
    assert.deepEqual(parseArtStem("4story3"), { kind: "story", index: 4, ordinal: 3 });
    assert.deepEqual(parseArtStem("4story02"), { kind: "story", index: 4, ordinal: 2 });
    assert.deepEqual(parseArtStem("12 story 10"), { kind: "story", index: 12, ordinal: 10 });
  });

  test("dentro de N/: \"story\", \"story2\" (sem o N no nome)", () => {
    assert.deepEqual(parseArtStem("story"), { kind: "story", index: null, ordinal: 1 });
    assert.deepEqual(parseArtStem("story2"), { kind: "story", index: null, ordinal: 2 });
    assert.deepEqual(parseArtStem("STORY 2"), { kind: "story", index: null, ordinal: 2 });
  });

  test("4story2 não é o feed 4 nem o 1º story; 4story não é o 2º", () => {
    const s2 = parseArtStem("4story2");
    assert.notEqual(s2?.kind, "post");
    assert.notEqual(s2?.kind === "story" && s2.ordinal, 1);
    const s1 = parseArtStem("4story");
    assert.equal(s1?.kind === "story" && s1.ordinal, 1);
    assert.equal(parseArtStem("04_STORY_2")?.kind, "story", "04_STORY_2 não vira o feed 4");
  });

  test("principais continuam como antes", () => {
    for (const [name, index] of [["3", 3], ["03", 3], ["3 - Título do post", 3], ["3_final", 3], ["3.v2", 3], ["3 (1)", 3], ["3 - storyboard", 3]] as const) {
      assert.deepEqual(parseArtStem(name), { kind: "post", index }, name);
    }
  });

  test("nomes que não servem", () => {
    for (const name of ["31x", "3Título", "3storyboard", "4story2b", "4story0", "historia", "capa", ""]) {
      assert.equal(parseArtStem(name), null, name);
    }
    assert.equal(parseArtStem("31")?.kind === "post" && parseArtStem("31")?.index, 31, "31 é o post 31, nunca o 3");
  });
});

describe("isStoryName com a ordem do story (A2)", () => {
  test("nomes de story com ordem não viram feed nem slide", () => {
    for (const n of ["4story2.jpg", "4 story 2.jpg", "4-story-2.jpg", "04_STORY_2.png", "4story2.mp4", "story2.jpg", "story_2.jpg", "3story_final.jpg"]) {
      assert.equal(isStoryName(n), true, n);
    }
  });
  test("continuam fora: storyboard, história, títulos", () => {
    for (const n of ["3storyboard.jpg", "storyboard.jpg", "historia.jpg", "3 - Título.jpg", "2.jpg"]) {
      assert.equal(isStoryName(n), false, n);
    }
  });
});
