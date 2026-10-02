import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMonthIndex,
  canonicalMonthFolderName,
  drivePathLabel,
  isStoryName,
  legacyMonthFolderName,
  matchMonthFolder,
  matchYearFolder,
  normalizeFolderName,
  parseMonthFolderName,
  parseMonthKey,
  pickMonthFolder,
  resolveMonthFolder,
  type DriveFolder,
  type ListChildren,
} from "../../src/lib/drive-layout.ts";

describe("normalizeFolderName", () => {
  test("trim, minúsculas, sem acento, espaços colapsados", () => {
    assert.equal(normalizeFolderName("  MARÇO  "), "marco");
    assert.equal(normalizeFolderName("10  -  Outubro"), "10 - outubro");
    assert.equal(normalizeFolderName("Cliente Ação"), "cliente acao");
  });
});

describe("matchMonthFolder (A1)", () => {
  const casam: [string, number][] = [
    ["outubro", 10],
    ["OUTUBRO", 10],
    ["Outubro", 10],
    ["10", 10],
    ["010", 10],
    ["10 - Outubro", 10],
    ["10-outubro", 10],
    ["10_outubro", 10],
    ["10.Outubro", 10],
    ["10 outubro", 10],
    ["Marco", 3],
    ["Março", 3],
    ["MARÇO", 3],
    ["03 - Março", 3],
    ["3", 3],
    ["  setembro ", 9],
  ];
  for (const [nome, mes] of casam) {
    test(`"${nome}" casa com o mês ${mes}`, () => {
      assert.notEqual(matchMonthFolder(nome, mes), null);
    });
  }

  test('"04 - SETEMBRO" → setembro (o nome prevalece sobre o número)', () => {
    assert.equal(matchMonthFolder("04 - SETEMBRO", 9), "numero-nome");
    assert.equal(matchMonthFolder("04 - SETEMBRO", 4), null);
    assert.deepEqual(parseMonthFolderName("04 - SETEMBRO"), { month: 9, kind: "numero-nome" });
  });

  test('"1" não casa com 10, 11 nem 12', () => {
    assert.equal(matchMonthFolder("1", 10), null);
    assert.equal(matchMonthFolder("1", 11), null);
    assert.equal(matchMonthFolder("1", 12), null);
    assert.equal(matchMonthFolder("1", 1), "numero");
  });

  test('"31", "Outubro 2025" e "out" não casam', () => {
    for (const nome of ["31", "Outubro 2025", "out", "0", "13", "10 - Outubro 2026", "outubro-rosa"]) {
      assert.equal(parseMonthFolderName(nome), null, nome);
      assert.equal(matchMonthFolder(nome, 10), null, nome);
    }
  });

  test("tipo do casamento: nome > número e nome > só número", () => {
    assert.equal(matchMonthFolder("Outubro", 10), "nome");
    assert.equal(matchMonthFolder("10 - Outubro", 10), "numero-nome");
    assert.equal(matchMonthFolder("10", 10), "numero");
  });

  test("mês fora de 1..12 lança erro", () => {
    assert.throws(() => matchMonthFolder("outubro", 13));
  });
});

describe("matchYearFolder", () => {
  test("casa o ano exato", () => {
    assert.equal(matchYearFolder("2026", 2026), true);
    assert.equal(matchYearFolder(" 2026 ", 2026), true);
    assert.equal(matchYearFolder("2025", 2026), false);
    assert.equal(matchYearFolder("2026 - antigo", 2026), false);
    assert.equal(matchYearFolder("26", 2026), false);
  });
});

describe("nomes canônicos", () => {
  test('canonicalMonthFolderName → "10 - Outubro"', () => {
    assert.equal(canonicalMonthFolderName(10), "10 - Outubro");
    assert.equal(canonicalMonthFolderName(3), "03 - Março");
    assert.equal(canonicalMonthFolderName(1), "01 - Janeiro");
  });
  test("o nome canônico casa com o próprio mês pelo matcher", () => {
    for (let m = 1; m <= 12; m++) assert.notEqual(matchMonthFolder(canonicalMonthFolderName(m), m), null);
  });
  test("legacyMonthFolderName = nome por extenso em minúsculas (estrutura antiga)", () => {
    assert.equal(legacyMonthFolderName(3), "março");
    assert.equal(legacyMonthFolderName(10), "outubro");
  });
  test("parseMonthKey", () => {
    assert.deepEqual(parseMonthKey("2026-10"), { year: 2026, month: 10 });
    assert.throws(() => parseMonthKey("2026-13"));
    assert.throws(() => parseMonthKey("10/2026"));
  });
});

describe("pickMonthFolder", () => {
  test("precedência determinística e independe da ordem da listagem", () => {
    const a: DriveFolder[] = [
      { id: "n", name: "10" },
      { id: "nn", name: "10 - Outubro" },
      { id: "x", name: "Outubro" },
    ];
    const r1 = pickMonthFolder(a, 10);
    const r2 = pickMonthFolder([...a].reverse(), 10);
    assert.equal(r1.folder?.id, "x");
    assert.equal(r2.folder?.id, "x");
    assert.deepEqual(r1.ambiguous, ["Outubro", "10 - Outubro", "10"]);
    assert.deepEqual(r2.ambiguous, r1.ambiguous);
  });
  test("sem candidata", () => {
    assert.deepEqual(pickMonthFolder([{ id: "1", name: "setembro" }], 10), { folder: null, ambiguous: [] });
  });
});

describe("resolveMonthFolder (árvore falsa)", () => {
  function fakeDrive(tree: Record<string, DriveFolder[]>) {
    const calls: string[] = [];
    const list: ListChildren = async (parentId) => {
      calls.push(parentId);
      return tree[parentId] ?? [];
    };
    return { list, calls };
  }

  test("(1) Cliente/2026/10 - Outubro → ano/mes", async () => {
    const { list, calls } = fakeDrive({
      cli: [
        { id: "y2025", name: "2025" },
        { id: "y2026", name: "2026" },
      ],
      y2026: [
        { id: "m09", name: "09 - Setembro" },
        { id: "m10", name: "10 - Outubro" },
      ],
    });
    const r = await resolveMonthFolder(list, "cli", 2026, 10, "Cliente");
    assert.deepEqual(r, {
      folderId: "m10",
      layout: "ano/mes",
      path: "Cliente/2026/10 - Outubro",
      ambiguous: [],
      yearFolderName: "2026",
      monthFolderName: "10 - Outubro",
    });
    assert.ok(calls.length <= 2);
  });

  test("(2) só Cliente/outubro → legado", async () => {
    const { list } = fakeDrive({ cli: [{ id: "leg", name: "outubro" }] });
    const r = await resolveMonthFolder(list, "cli", 2026, 10, "Cliente");
    assert.equal(r.folderId, "leg");
    assert.equal(r.layout, "legado");
    assert.equal(r.path, "Cliente/outubro");
    assert.deepEqual(r.ambiguous, []);
  });

  test("(3) Cliente/2026 sem outubro, mas Cliente/outubro existe → legado", async () => {
    const { list } = fakeDrive({
      cli: [
        { id: "y2026", name: "2026" },
        { id: "leg", name: "Outubro" },
      ],
      y2026: [{ id: "m09", name: "09 - Setembro" }],
    });
    const r = await resolveMonthFolder(list, "cli", 2026, 10, "Cliente");
    assert.equal(r.folderId, "leg");
    assert.equal(r.layout, "legado");
    assert.equal(r.path, "Cliente/Outubro");
  });

  test('(4) "Outubro" e "10" no mesmo ano → escolha determinística + ambiguous', async () => {
    const tree = {
      cli: [{ id: "y2026", name: "2026" }],
      y2026: [
        { id: "num", name: "10" },
        { id: "nome", name: "Outubro" },
      ],
    };
    const r = await resolveMonthFolder(fakeDrive(tree).list, "cli", 2026, 10, "Cliente");
    assert.equal(r.folderId, "nome");
    assert.equal(r.layout, "ano/mes");
    assert.deepEqual(r.ambiguous, ["2026/Outubro", "2026/10"]);
    // a ordem da listagem não muda a escolha
    const reversed = { ...tree, y2026: [...tree.y2026].reverse() };
    const r2 = await resolveMonthFolder(fakeDrive(reversed).list, "cli", 2026, 10, "Cliente");
    assert.equal(r2.folderId, "nome");
    assert.deepEqual(r2.ambiguous, r.ambiguous);
  });

  test('(5) nenhum → null com o path esperado "Cliente/2026/10 - Outubro"', async () => {
    const { list } = fakeDrive({ cli: [{ id: "x", name: "Fotos" }] });
    const r = await resolveMonthFolder(list, "cli", 2026, 10, "Cliente");
    assert.deepEqual(r, {
      folderId: null,
      layout: null,
      path: "Cliente/2026/10 - Outubro",
      ambiguous: [],
      yearFolderName: null,
      monthFolderName: null,
    });
  });

  test("ano/mes tem prioridade sobre o legado quando os dois existem", async () => {
    const { list } = fakeDrive({
      cli: [
        { id: "leg", name: "outubro" },
        { id: "y2026", name: "2026" },
      ],
      y2026: [{ id: "m10", name: "Outubro" }],
    });
    const r = await resolveMonthFolder(list, "cli", 2026, 10);
    assert.equal(r.folderId, "m10");
    assert.equal(r.layout, "ano/mes");
    assert.equal(r.path, "2026/Outubro");
  });

  test("a pasta legada de outro ano não é confundida com a do ano", async () => {
    const { list } = fakeDrive({
      cli: [{ id: "y2025", name: "2025" }],
      y2025: [{ id: "m10-2025", name: "10 - Outubro" }],
    });
    const r = await resolveMonthFolder(list, "cli", 2026, 10, "Cliente");
    assert.equal(r.folderId, null);
    assert.equal(r.path, "Cliente/2026/10 - Outubro");
  });
});

describe("drivePathLabel", () => {
  test("ano/mes, legado e esperado", () => {
    assert.equal(drivePathLabel("Cliente", 2026, 10, "3.jpg", "ano/mes"), "Cliente/2026/10 - Outubro/3.jpg");
    assert.equal(drivePathLabel("Cliente", 2026, 10, "3.jpg", null), "Cliente/2026/10 - Outubro/3.jpg");
    assert.equal(
      drivePathLabel("Cliente", 2026, 10, "3.jpg", "legado"),
      "Cliente/outubro/3.jpg (estrutura antiga)"
    );
    assert.equal(drivePathLabel("Cliente", 2026, 10, "", "ano/mes"), "Cliente/2026/10 - Outubro");
  });
  test("usa os nomes reais das pastas quando informados", () => {
    assert.equal(
      drivePathLabel("Cliente", 2026, 10, "3story.jpg", "ano/mes", { yearFolderName: "2026", monthFolderName: "Outubro" }),
      "Cliente/2026/Outubro/3story.jpg"
    );
    assert.equal(
      drivePathLabel("Cliente", 2026, 10, "3.jpg", "legado", { monthFolderName: "OUTUBRO" }),
      "Cliente/OUTUBRO/3.jpg (estrutura antiga)"
    );
  });
});

describe("isStoryName", () => {
  test("nomes de story", () => {
    for (const n of ["3story.jpg", "3 story.png", "3-story.jpg", "03_STORY.jpg", "3 - story.mp4", "story.jpg", "3story"]) {
      assert.equal(isStoryName(n), true, n);
    }
  });
  test("2º, 3º… story do mesmo post (P4-D): \"4story2.jpg\", \"story2.jpg\"", () => {
    for (const n of ["4story2.jpg", "4 story 2.jpg", "4-story-2.jpg", "04_STORY_2.png", "4story2.mp4", "story2.jpg", "4story3.jpg"]) {
      assert.equal(isStoryName(n), true, n);
    }
  });
  test("nomes que não são story", () => {
    for (const n of ["3.jpg", "1.png", "03 - Título.jpg", "3storyboard.jpg", "historia.jpg", "3_final.jpg", "3 - storyboard.jpg"]) {
      assert.equal(isStoryName(n), false, n);
    }
  });
});

describe("buildMonthIndex — paridade com drive-sync.ts:60-84", () => {
  // Cópia literal da regra original (oráculo congelado) para provar paridade.
  function legacyBuildMonthIndex(
    monthPosts: { id: string; format: string; scheduledAt: Date }[]
  ): Map<string, number> {
    const byId = new Map<string, number>();
    let mainIdx = 0;
    let lastMainIdx = 0;
    for (const p of monthPosts) {
      if (p.format === "story") {
        byId.set(p.id, lastMainIdx > 0 ? lastMainIdx : 1);
      } else {
        mainIdx += 1;
        lastMainIdx = mainIdx;
        byId.set(p.id, mainIdx);
      }
    }
    return byId;
  }

  const at = (day: number, h = 9) => new Date(`2026-10-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00-03:00`);

  test("feed, story, carrossel, reels e story antes de qualquer principal", () => {
    const posts = [
      { id: "s0", format: "story", scheduledAt: at(1, 8) }, // story antes de qualquer principal → 1
      { id: "f1", format: "feed", scheduledAt: at(2) }, // 1
      { id: "s1", format: "story", scheduledAt: at(2, 10) }, // herda 1
      { id: "c2", format: "carrossel", scheduledAt: at(5) }, // 2
      { id: "r3", format: "reels", scheduledAt: at(7) }, // 3
      { id: "s3", format: "story", scheduledAt: at(7, 21) }, // herda 3
      { id: "f4", format: "feed", scheduledAt: at(9) }, // 4
    ];
    const got = buildMonthIndex(posts);
    assert.deepEqual(Object.fromEntries(got), { s0: 1, f1: 1, s1: 1, c2: 2, r3: 3, s3: 3, f4: 4 });
    assert.deepEqual(got, legacyBuildMonthIndex(posts));
  });

  test("mês vazio e só stories", () => {
    assert.equal(buildMonthIndex([]).size, 0);
    const onlyStories = [
      { id: "a", format: "story", scheduledAt: at(1) },
      { id: "b", format: "story", scheduledAt: at(2) },
    ];
    assert.deepEqual(buildMonthIndex(onlyStories), legacyBuildMonthIndex(onlyStories));
    assert.deepEqual(Object.fromEntries(buildMonthIndex(onlyStories)), { a: 1, b: 1 });
  });

  test("paridade em 500 sequências pseudoaleatórias", () => {
    const formats = ["feed", "story", "carrossel", "reels"];
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let i = 0; i < 500; i++) {
      const n = Math.floor(rnd() * 25);
      const posts = Array.from({ length: n }, (_, k) => ({
        id: `p${k}`,
        format: formats[Math.floor(rnd() * formats.length)],
        scheduledAt: at(1 + (k % 28)),
      }));
      assert.deepEqual(buildMonthIndex(posts), legacyBuildMonthIndex(posts));
    }
  });
});
