/**
 * F6 DS-A: marcar/desmarcar a ARTE de um post — PATCH /api/posts/[id]/art.
 *   - sem sessão → 401 (texto pt-BR) e nenhuma consulta ao banco;
 *   - id ou corpo inválido → 400 { error: "<pt-BR>" }, banco intocado;
 *   - post inexistente → 404 pt-BR;
 *   - done=true grava art_done_at=agora e art_done_by=usuária da sessão; done=false limpa os dois;
 *   - resposta { ok, artDoneAt (ISO|null), artDoneBy {id,name}|null };
 *   - falha do banco → 500 pt-BR, sem o texto do Prisma.
 *
 * Técnica do posts-bulk-delete.test.ts: hooks de módulo trocam Prisma e a sessão (@/auth) por
 * versões falsas em memória. O `PATCH` da rota roda de verdade, com o requireAuth e o zod reais.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ------------------------------------------------------------ banco e sessão falsos

type PostRow = { id: string; artDoneAt: Date | null; artDoneBy: string | null };
type UserRow = { id: string; name: string; email: string };
type Session = { user: { id?: string; email?: string | null; role?: string } } | null;

const ANA: UserRow = { id: uid(501), name: "ZZ QA Designer Ana", email: "zzqa.ana@example.com" };

const state = {
  session: { user: { id: ANA.id, email: ANA.email, role: "staff" } } as Session,
  posts: [] as PostRow[],
  users: [ANA] as UserRow[],
  calls: [] as { op: string; args: unknown }[],
  fail: null as Error | null,
};

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const fakePrisma = {
  post: {
    updateMany: async (args: { where: { id: string }; data: { artDoneAt: Date | null; artDoneBy: string | null } }) => {
      state.calls.push({ op: "post.updateMany", args });
      if (state.fail) throw state.fail;
      assert.deepEqual(Object.keys(args.where), ["id"], "where só pelo id");
      assert.deepEqual(Object.keys(args.data).sort(), ["artDoneAt", "artDoneBy"], "data só com os 2 campos da arte");
      let count = 0;
      for (const p of state.posts) {
        if (!sameId(p.id, args.where.id)) continue;
        p.artDoneAt = args.data.artDoneAt;
        p.artDoneBy = args.data.artDoneBy;
        count += 1;
      }
      return { count };
    },
    update: async () => assert.fail("a rota usa updateMany (404 sem exceção do Prisma)"),
  },
  user: {
    findUnique: async (args: { where: { id?: string; email?: string } }) => {
      state.calls.push({ op: "user.findUnique", args });
      if (state.fail) throw state.fail;
      const u = state.users.find((x) =>
        args.where.id !== undefined ? sameId(x.id, args.where.id) : x.email === args.where.email
      );
      return u ? { id: u.id, name: u.name } : null;
    },
  },
};

const logs: string[] = [];
console.error = (...args: unknown[]) => {
  logs.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" "));
};

// ------------------------------------------------------------ hooks de módulo

const FAKE_MODULES: Record<string, string> = {
  "next/server": "export class NextRequest extends Request {} export class NextResponse extends Response {}",
  "@/auth": "export const auth = async () => globalThis.__f6art.state.session;",
  "@/lib/prisma": "export const prisma = globalThis.__f6art.prisma;",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __f6art: unknown }).__f6art = { state, prisma: fakePrisma };
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

const { PATCH } = await import("../../src/app/api/posts/[id]/art/route.ts");

// ------------------------------------------------------------ helpers

async function call(id: string, body: unknown, raw = false): Promise<{ status: number; json: Record<string, unknown> }> {
  const req = new Request(`http://localhost/api/posts/${id}/art`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
  const res = await PATCH(req as unknown as Parameters<typeof PATCH>[0], { params: Promise.resolve({ id }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function assertFriendly(json: Record<string, unknown>, expected: string) {
  assert.equal(typeof json.error, "string", `error não é string: ${JSON.stringify(json)}`);
  assert.equal(json.error, expected);
  assert.doesNotMatch(json.error as string, /Invalid|Expected|Required|received|Unauthorized|Prisma|P20\d\d/i);
}

beforeEach(() => {
  state.session = { user: { id: ANA.id, email: ANA.email, role: "staff" } };
  state.posts = [
    { id: uid(1), artDoneAt: null, artDoneBy: null },
    { id: uid(2), artDoneAt: new Date("2026-10-01T12:00:00Z"), artDoneBy: ANA.id },
  ];
  state.users = [ANA];
  state.calls = [];
  state.fail = null;
  logs.length = 0;
});

// ------------------------------------------------------------ testes

describe("PATCH /api/posts/[id]/art — sessão e validação", () => {
  test("sem sessão → 401 em pt-BR e nenhuma consulta ao banco", async () => {
    state.session = null;
    const r = await call(uid(1), { done: true });
    assert.equal(r.status, 401);
    assertFriendly(r.json, "Sua sessão expirou. Entre de novo.");
    assert.equal(state.calls.length, 0);
    assert.equal(state.posts[0].artDoneAt, null);
  });

  test("id que não é UUID → 400 pt-BR, banco intocado", async () => {
    const r = await call("abc", { done: true });
    assert.equal(r.status, 400);
    assertFriendly(r.json, "Post inválido.");
    assert.equal(state.calls.length, 0);
  });

  const badBodies: [string, unknown, boolean?][] = [
    ["corpo que não é JSON", "{done:", true],
    ["corpo vazio", {}],
    ["done como texto", { done: "true" }],
    ["done como número", { done: 1 }],
    ["done nulo", { done: null }],
    ["corpo lista", [true]],
  ];
  for (const [name, body, raw] of badBodies) {
    test(`${name} → 400 pt-BR, banco intocado`, async () => {
      const r = await call(uid(1), body, raw);
      assert.equal(r.status, 400);
      assertFriendly(r.json, "Informe se a arte está feita ou não.");
      assert.equal(state.calls.length, 0);
    });
  }
});

describe("PATCH /api/posts/[id]/art — marcar e desmarcar", () => {
  test("post inexistente → 404 pt-BR", async () => {
    const r = await call(uid(99), { done: true });
    assert.equal(r.status, 404);
    assertFriendly(r.json, "Post não encontrado.");
  });

  test("done=true grava agora + usuária da sessão e devolve { ok, artDoneAt, artDoneBy }", async () => {
    const before = Date.now();
    const r = await call(uid(1), { done: true });
    const after = Date.now();
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.deepEqual(r.json.artDoneBy, { id: ANA.id, name: ANA.name });
    const at = Date.parse(r.json.artDoneAt as string);
    assert.ok(at >= before && at <= after, "artDoneAt é o instante do pedido");
    assert.equal(state.posts[0].artDoneAt?.toISOString(), r.json.artDoneAt);
    assert.equal(state.posts[0].artDoneBy, ANA.id);
    assert.deepEqual(Object.keys(r.json).sort(), ["artDoneAt", "artDoneBy", "ok"]);
  });

  test("done=false limpa os dois campos e não consulta a usuária", async () => {
    const r = await call(uid(2), { done: false });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, artDoneAt: null, artDoneBy: null });
    assert.equal(state.posts[1].artDoneAt, null);
    assert.equal(state.posts[1].artDoneBy, null);
    assert.equal(state.calls.filter((c) => c.op === "user.findUnique").length, 0);
  });

  test("desmarcar post que não estava marcado é idempotente (200)", async () => {
    const r = await call(uid(1), { done: false });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, artDoneAt: null, artDoneBy: null });
  });

  test("sessão sem id no token → acha a usuária pelo e-mail", async () => {
    state.session = { user: { email: ANA.email } };
    const r = await call(uid(1), { done: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.artDoneBy, { id: ANA.id, name: ANA.name });
    assert.equal(state.posts[0].artDoneBy, ANA.id);
  });

  test("usuária da sessão excluída do banco → marca mesmo assim, com artDoneBy null (sem violar a FK)", async () => {
    state.users = [];
    const r = await call(uid(1), { done: true });
    assert.equal(r.status, 200);
    assert.equal(r.json.artDoneBy, null);
    assert.equal(typeof r.json.artDoneAt, "string");
    assert.equal(state.posts[0].artDoneBy, null);
    assert.ok(state.posts[0].artDoneAt instanceof Date);
  });

  test("UUID em maiúsculas encontra o post", async () => {
    const r = await call(uid(1).toUpperCase(), { done: true });
    assert.equal(r.status, 200);
    assert.ok(state.posts[0].artDoneAt);
  });

  test("falha do banco → 500 em pt-BR, sem o texto do Prisma (detalhe só no log)", async () => {
    state.fail = new Error("PrismaClientKnownRequestError P2003: Foreign key constraint failed on the field `art_done_by`");
    const r = await call(uid(1), { done: true });
    assert.equal(r.status, 500);
    assertFriendly(r.json, "Não foi possível atualizar a arte agora. Tente de novo.");
    assert.ok(logs.some((l) => l.includes("P2003")));
  });
});
