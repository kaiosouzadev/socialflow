/**
 * S35 / P4-A2 item 6 (N-18, N-25): uma regra única de "legenda efetiva".
 *   `caption` não vazio OU o 1º valor NÃO VAZIO de captions{instagram, facebook, linkedin}
 *   (chave com string vazia ou só espaços não conta).
 * A função vem de um lugar só (`effectiveCaption`, lib/production.ts) e é a mesma que
 * lib/daily-summary.ts usa em `hasCaption` e o /producao usa no estágio "Sem texto".
 *
 * daily-summary usa o alias "@/" e o Prisma: como no doc-import-captions.test.ts, hooks de
 * módulo resolvem "@/" para os fontes e trocam Prisma e a IA por versões falsas em memória.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

// ------------------------------------------------------------ banco falso

type Row = Record<string, unknown>;
const state = { posts: [] as Row[] };

const fakePrisma = {
  post: {
    findMany: async () => state.posts,
  },
};

// ------------------------------------------------------------ hooks de módulo

const FAKE_MODULES: Record<string, string> = {
  "@/lib/prisma": "export const prisma = globalThis.__p4a2c.prisma;",
  "@/lib/gemini": "export const CAPTION_MODEL = 'falso'; export const generateText = async () => { throw new Error('IA real bloqueada no teste'); };",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __p4a2c: unknown }).__p4a2c = { prisma: fakePrisma };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in FAKE_MODULES) {
      return { url: `data:text/javascript,${encodeURIComponent(FAKE_MODULES[specifier])}`, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return { url: pathToFileURL(path.join(SRC, `${specifier.slice(2)}.ts`)).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

// namespace: no módulo antigo a função não existe e cada teste falha sozinho (sem derrubar o arquivo)
const production = (await import("../../src/lib/production.ts")) as Record<string, unknown> &
  typeof import("../../src/lib/production.ts");
const { getTodayPosts } = await import("../../src/lib/daily-summary.ts");

type CaptionFields = { caption?: string | null; captions?: unknown };
function effectiveCaption(post: CaptionFields): string | null {
  const fn = production.effectiveCaption as ((p: CaptionFields) => string | null) | undefined;
  assert.equal(typeof fn, "function", "lib/production.ts não exporta effectiveCaption");
  return fn!(post);
}

/** Casos da regra: [descrição, campos do post, legenda efetiva esperada]. */
const CASES: [string, CaptionFields, string | null][] = [
  ["caption com texto", { caption: "Legenda única", captions: null }, "Legenda única"],
  ["caption vence captions", { caption: "Legenda única", captions: { instagram: "IG" } }, "Legenda única"],
  ["só captions.instagram", { caption: null, captions: { instagram: "IG", facebook: "FB" } }, "IG"],
  ["instagram vazio → facebook", { caption: null, captions: { instagram: "", facebook: "FB" } }, "FB"],
  ["ordem das redes, não das chaves", { caption: null, captions: { linkedin: "LI", facebook: "FB", instagram: "IG" } }, "IG"],
  ["só linkedin", { caption: null, captions: { linkedin: "LI" } }, "LI"],
  ["caption só com espaços → captions", { caption: "   ", captions: { facebook: "FB" } }, "FB"],
  ["chave vazia não conta", { caption: null, captions: { instagram: "" } }, null],
  ["chaves só com espaços não contam", { caption: "", captions: { instagram: "  ", facebook: "\n", linkedin: "\t" } }, null],
  ["caption só com espaços e sem captions", { caption: "  ", captions: null }, null],
  ["captions vazio", { caption: null, captions: {} }, null],
  ["chave fora das 3 redes não conta", { caption: null, captions: { shared: "Texto" } }, null],
  ["valor que não é texto não conta", { caption: null, captions: { instagram: 123, facebook: null } }, null],
  ["captions não é objeto", { caption: null, captions: ["IG"] }, null],
  ["sem nenhum campo", {}, null],
];

describe("effectiveCaption (lib/production.ts) — a regra única", () => {
  for (const [name, fields, expected] of CASES) {
    test(name, () => assert.equal(effectiveCaption(fields), expected));
  }

  test("o estágio do Quadro usa a legenda efetiva: chave vazia é 'Sem texto', facebook com texto é 'Texto ok'", () => {
    const stage = (fields: CaptionFields) =>
      production.productionStage({ caption: effectiveCaption(fields), plan: "sem_aprovacao" });
    assert.equal(stage({ caption: null, captions: { instagram: "" } }), "sem_texto");
    assert.equal(stage({ caption: null, captions: { instagram: "", facebook: "FB" } }), "texto_ok");
  });
});

describe("daily-summary: hasCaption = a mesma regra (N-25)", () => {
  beforeEach(() => {
    state.posts = [];
  });

  const post = (id: string, fields: CaptionFields): Row => ({
    id,
    client: { name: "ZZ QA P4A2" },
    theme: `Tema ${id}`,
    targets: ["instagram"],
    status: "draft",
    scheduledAt: new Date("2026-10-02T15:00:00.000Z"),
    mediaUrl: null,
    caption: fields.caption ?? null,
    captions: fields.captions ?? null,
  });

  test("captions com chave vazia → hasCaption false (antes: true)", async () => {
    state.posts = [post("a", { captions: { instagram: "" } }), post("b", { captions: { instagram: " ", facebook: "" } })];
    const today = await getTodayPosts("2026-10-02");
    assert.deepEqual(today.map((p) => p.hasCaption), [false, false]);
  });

  test("caption só com espaços → hasCaption false", async () => {
    state.posts = [post("a", { caption: "   " })];
    const [p] = await getTodayPosts("2026-10-02");
    assert.equal(p.hasCaption, false);
  });

  test("todos os casos: hasCaption === (effectiveCaption(post) !== null)", async () => {
    state.posts = CASES.map(([name, fields]) => post(name, fields));
    const today = await getTodayPosts("2026-10-02");
    assert.equal(today.length, CASES.length);
    today.forEach((p, i) => {
      const [name, fields, expected] = CASES[i];
      assert.equal(p.hasCaption, expected !== null, name);
      assert.equal(p.hasCaption, effectiveCaption(fields) !== null, name);
    });
  });
});
