/**
 * P5-B: exclusão em massa na lista de posts — POST /api/posts/bulk-delete.
 *   - sem sessão → 401 (texto pt-BR) e nenhuma consulta ao banco;
 *   - corpo inválido (sem ids, vazio, > 500, ID não-UUID, repetidos) → 400 { error: "<pt-BR>" };
 *   - apaga num só deleteMany os posts pedidos, EXCETO os "publishing" (o publicador está com eles);
 *   - responde { ok, deleted, skippedPublishing, notFound } com as contagens certas;
 *   - falha do banco → 500 pt-BR, sem o texto do Prisma.
 *
 * Técnica do doc-import-captions.test.ts / aprovar-semana-guard.test.ts: hooks de módulo resolvem
 * "@/" para os fontes e trocam Prisma e a sessão (@/auth) por versões falsas em memória (sem rede e
 * sem banco real). O `POST` da rota roda de verdade, com o requireAuth e o zod reais. O Prisma falso
 * aplica o `where` LITERALMENTE: se a rota esquecer o filtro de status, o post em publicação some.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

/** UUID bem formado a partir de um número (ex.: 7 → 00000000-0000-4000-8000-000000000007). */
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** UUID com letras, para os casos de maiúsculas/minúsculas. */
const HEX = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

// ------------------------------------------------------------ banco e sessão falsos

type Row = { id: string; status: string; theme: string };
type Session = { user: { role?: string } } | null;
type Where = { id?: { in?: string[] }; status?: { not?: string } };

const state = {
  session: { user: { role: "staff" } } as Session,
  posts: [] as Row[],
  calls: [] as { op: string; where: Where }[],
  fail: null as Error | null,
};

/** Igualdade de UUID do Postgres: sem diferenciar maiúsculas. */
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Aplica só as formas de `where` que a rota pode usar; qualquer outra forma falha o teste. */
function matches(row: Row, where: Where): boolean {
  const keys = Object.keys(where);
  for (const k of keys) assert.ok(k === "id" || k === "status", `where com chave inesperada: ${k}`);
  assert.ok(Array.isArray(where.id?.in), "where.id.in deve ser a lista de ids");
  if (!where.id!.in!.some((id) => sameId(id, row.id))) return false;
  if (where.status !== undefined) {
    assert.deepEqual(Object.keys(where.status), ["not"], "where.status só com `not`");
    if (row.status === where.status.not) return false;
  }
  return true;
}

const fakePrisma = {
  post: {
    deleteMany: async ({ where }: { where: Where }) => {
      state.calls.push({ op: "deleteMany", where });
      if (state.fail) throw state.fail;
      const before = state.posts.length;
      state.posts = state.posts.filter((p) => !matches(p, where));
      return { count: before - state.posts.length };
    },
    count: async ({ where }: { where: Where }) => {
      state.calls.push({ op: "count", where });
      if (state.fail) throw state.fail;
      return state.posts.filter((p) => matches(p, where)).length;
    },
    findMany: async ({ where }: { where: Where }) => {
      state.calls.push({ op: "findMany", where });
      if (state.fail) throw state.fail;
      return state.posts.filter((p) => matches(p, where)).map((p) => ({ id: p.id, status: p.status }));
    },
    // a exclusão em massa nunca usa a exclusão individual
    delete: async () => assert.fail("bulk-delete não deve usar prisma.post.delete"),
  },
};

const logs: string[] = [];
console.error = (...args: unknown[]) => {
  logs.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" "));
};

// ------------------------------------------------------------ hooks de módulo

const FAKE_MODULES: Record<string, string> = {
  "next/server": "export class NextRequest extends Request {} export class NextResponse extends Response {}",
  "@/auth": "export const auth = async () => globalThis.__p5b.state.session;",
  "@/lib/prisma": "export const prisma = globalThis.__p5b.prisma;",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __p5b: unknown }).__p5b = { state, prisma: fakePrisma };
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

const { POST } = await import("../../src/app/api/posts/bulk-delete/route.ts");

// ------------------------------------------------------------ helpers

async function call(body: unknown, raw = false): Promise<{ status: number; json: Record<string, unknown> }> {
  const req = new Request("http://localhost/api/posts/bulk-delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
  const res = await POST(req as unknown as Parameters<typeof POST>[0]);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function seed(...rows: [number, string][]) {
  state.posts = rows.map(([n, status]) => ({ id: uid(n), status, theme: `ZZ QA P5B ${status} ${n}` }));
}

/** `error` é texto pt-BR para a tela (N-14): string, sem inglês/jargão do zod ou do Prisma. */
function assertFriendly(json: Record<string, unknown>, expected?: string) {
  assert.equal(typeof json.error, "string", `error não é string: ${JSON.stringify(json)}`);
  const text = json.error as string;
  if (expected) assert.equal(text, expected);
  for (const re of [/Invalid|Expected|Required|received|too_(big|small)|Unauthorized/i, /Prisma|P20\d\d|ECONN|\bError\b/]) {
    assert.doesNotMatch(text, re, `texto técnico/inglês no erro: ${text}`);
  }
}

beforeEach(() => {
  state.session = { user: { role: "staff" } };
  state.posts = [];
  state.calls = [];
  state.fail = null;
  logs.length = 0;
});

// ------------------------------------------------------------ testes

describe("POST /api/posts/bulk-delete — sessão", () => {
  test("sem sessão → 401 em pt-BR e nenhuma consulta ao banco", async () => {
    state.session = null;
    seed([1, "draft"]);
    const r = await call({ ids: [uid(1)] });
    assert.equal(r.status, 401);
    assertFriendly(r.json, "Sua sessão expirou. Entre de novo.");
    assert.equal(state.calls.length, 0);
    assert.equal(state.posts.length, 1);
  });

  test("qualquer usuário logado (não só admin) pode excluir", async () => {
    seed([1, "draft"]);
    const r = await call({ ids: [uid(1)] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, deleted: 1, skippedPublishing: 0, notFound: 0 });
  });
});

describe("POST /api/posts/bulk-delete — validação (400 com texto pt-BR, banco intocado)", () => {
  const cases: [string, unknown, string, boolean?][] = [
    ["corpo que não é JSON", "{ids:", "Envie a lista de posts a excluir.", true],
    ["corpo sem ids", {}, "Envie a lista de posts a excluir."],
    ["ids que não é lista", { ids: uid(1) }, "Envie a lista de posts a excluir."],
    ["corpo que não é objeto", [uid(1)], "Envie a lista de posts a excluir."],
    ["lista vazia", { ids: [] }, "Selecione ao menos um post para excluir."],
    [
      "mais de 500 ids",
      { ids: Array.from({ length: 501 }, (_, i) => uid(i + 1)) },
      "Dá para excluir no máximo 500 posts por vez.",
    ],
    ["id que não é UUID", { ids: [uid(1), "abc"] }, "A lista tem um post com identificador inválido."],
    ["id que não é texto", { ids: [uid(1), 42] }, "A lista tem um post com identificador inválido."],
    ["ids repetidos", { ids: [uid(1), uid(2), uid(1)] }, "A lista tem posts repetidos."],
    ["repetido só na caixa", { ids: [HEX.toUpperCase(), HEX] }, "A lista tem posts repetidos."],
  ];

  for (const [name, body, message, raw] of cases) {
    test(`${name} → 400`, async () => {
      seed([1, "draft"], [2, "scheduled"]);
      const r = await call(body, raw);
      assert.equal(r.status, 400);
      assertFriendly(r.json, message);
      assert.equal(state.calls.length, 0, "não deve consultar o banco");
      assert.equal(state.posts.length, 2);
    });
  }

  test("exatamente 500 ids é aceito (limite inclusivo)", async () => {
    seed([1, "draft"]);
    const ids = Array.from({ length: 500 }, (_, i) => uid(i + 1));
    const r = await call({ ids });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, deleted: 1, skippedPublishing: 0, notFound: 499 });
  });
});

describe("POST /api/posts/bulk-delete — exclusão", () => {
  test("apaga rascunho, agendado, publicado e com falha; mantém o em publicação; conta o inexistente", async () => {
    seed([1, "draft"], [2, "scheduled"], [3, "published"], [4, "failed"], [5, "publishing"], [6, "scheduled"]);
    const r = await call({ ids: [uid(1), uid(2), uid(3), uid(4), uid(5), uid(99)] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, deleted: 4, skippedPublishing: 1, notFound: 1 });
    // ficou o em publicação e o que não estava na lista
    assert.deepEqual(
      state.posts.map((p) => [p.id, p.status]),
      [
        [uid(5), "publishing"],
        [uid(6), "scheduled"],
      ]
    );
  });

  test("um só deleteMany, filtrado por ids E por status ≠ publishing", async () => {
    seed([1, "draft"], [2, "publishing"]);
    await call({ ids: [uid(1), uid(2)] });
    const deletes = state.calls.filter((c) => c.op === "deleteMany");
    assert.equal(deletes.length, 1);
    assert.deepEqual(deletes[0].where.status, { not: "publishing" });
    assert.deepEqual([...(deletes[0].where.id?.in ?? [])].sort(), [uid(1), uid(2)]);
  });

  test("só posts em publicação → nada apagado, todos contados como em publicação", async () => {
    seed([1, "publishing"], [2, "publishing"]);
    const r = await call({ ids: [uid(1), uid(2)] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, deleted: 0, skippedPublishing: 2, notFound: 0 });
    assert.equal(state.posts.length, 2);
  });

  test("todos inexistentes (já excluídos por outra pessoa) → 200 com notFound", async () => {
    seed([1, "draft"]);
    const r = await call({ ids: [uid(7), uid(8)] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, deleted: 0, skippedPublishing: 0, notFound: 2 });
    assert.equal(state.posts.length, 1);
  });

  test("UUID em maiúsculas encontra o post (o Postgres não diferencia)", async () => {
    seed([2, "scheduled"]);
    state.posts.push({ id: HEX, status: "draft", theme: "ZZ QA P5B hex" });
    const r = await call({ ids: [HEX.toUpperCase()] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, deleted: 1, skippedPublishing: 0, notFound: 0 });
    assert.deepEqual(state.posts.map((p) => p.id), [uid(2)]);
  });

  test("falha do banco → 500 em pt-BR, sem o texto do Prisma (detalhe só no log)", async () => {
    seed([1, "draft"]);
    state.fail = new Error("PrismaClientKnownRequestError P2003: Foreign key constraint failed on the field `post_id`");
    const r = await call({ ids: [uid(1)] });
    assert.equal(r.status, 500);
    assertFriendly(r.json, "Não foi possível excluir os posts agora. Tente de novo.");
    assert.ok(logs.some((l) => l.includes("P2003")), "o detalhe técnico vai para o log do servidor");
  });
});
