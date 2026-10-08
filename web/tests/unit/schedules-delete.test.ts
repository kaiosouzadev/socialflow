/**
 * F13-APROVACOES: exclusão de cronogramas SEM posts.
 *   DELETE /api/schedules/[id]          → 200 só com 0 posts; 409 pt-BR com posts; 404; 401 sem sessão
 *   POST   /api/schedules/cleanup-empty → lote com ids explícitos; revalida "0 posts" no servidor,
 *                                         numa transação; relata withPosts e notFound; 400 pt-BR
 *
 * A FK posts.schedule_id é ON DELETE CASCADE: o banco falso abaixo aplica a cascata de verdade,
 * então qualquer exclusão de cronograma com posts apagaria os posts e o teste veria. Ele também
 * exige a ordem segura dentro da transação: trava (SELECT … FOR UPDATE) → recontagem → exclusão.
 *
 * Técnica do posts-bulk-delete.test.ts: hooks de módulo resolvem "@/" para os fontes e trocam
 * Prisma e a sessão (@/auth) por versões falsas em memória (sem rede e sem banco real).
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ------------------------------------------------------------ banco e sessão falsos

type Schedule = { id: string; status: string; approvalToken: string | null };
type Post = { id: string; scheduleId: string | null };
type Session = { user: { id?: string; role?: string } } | null;

const state = {
  session: { user: { id: "00000000-0000-4000-8000-0000000000a5", role: "staff" } } as Session,
  schedules: [] as Schedule[],
  posts: [] as Post[],
  calls: [] as string[],
  inTx: false,
  transactions: 0,
  locked: new Set<string>(),
  fail: null as Error | null,
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const lowerIn = (list: string[], id: string) => list.some((x) => same(x, id));

function outsideTx(op: string): never {
  assert.fail(`${op} fora da transação`);
}

const tx = {
  $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (!state.inTx) outsideTx("$queryRaw");
    const sql = strings.join("?");
    state.calls.push("lock");
    assert.match(sql, /FROM schedules/i);
    assert.match(sql, /FOR UPDATE/i, "a recontagem precisa da linha travada");
    assert.match(sql, /ORDER BY id/i, "travas em ordem fixa (sem deadlock entre limpezas)");
    if (state.fail) throw state.fail;
    const ids = values[0] as string[];
    assert.ok(Array.isArray(ids), "ids como lista (ANY)");
    const rows = state.schedules.filter((s) => lowerIn(ids, s.id)).map((s) => ({ id: s.id.toLowerCase() }));
    for (const r of rows) state.locked.add(r.id);
    return rows.sort((a, b) => a.id.localeCompare(b.id));
  },
  post: {
    groupBy: async ({ by, where }: { by: string[]; where: { scheduleId: { in: string[] } } }) => {
      if (!state.inTx) outsideTx("post.groupBy");
      state.calls.push("count");
      assert.deepEqual(by, ["scheduleId"]);
      for (const id of where.scheduleId.in) assert.ok(state.locked.has(id.toLowerCase()), `contou ${id} sem travar`);
      const counts = new Map<string, number>();
      for (const p of state.posts) {
        if (p.scheduleId && lowerIn(where.scheduleId.in, p.scheduleId)) counts.set(p.scheduleId, (counts.get(p.scheduleId) ?? 0) + 1);
      }
      return [...counts.entries()].map(([scheduleId, n]) => ({ scheduleId, _count: { _all: n } }));
    },
  },
  schedule: {
    deleteMany: async ({ where }: { where: { id: { in: string[] }; posts?: { none: object } } }) => {
      if (!state.inTx) outsideTx("schedule.deleteMany");
      state.calls.push("delete");
      assert.deepEqual(where.posts, { none: {} }, "o DELETE repete a regra 0 posts");
      const before = state.schedules.length;
      const gone = state.schedules.filter((s) => lowerIn(where.id.in, s.id) && !state.posts.some((p) => p.scheduleId === s.id));
      state.schedules = state.schedules.filter((s) => !gone.includes(s));
      // cascata real da FK (só por garantia: com o filtro acima, nunca há posts aqui)
      state.posts = state.posts.filter((p) => !gone.some((s) => s.id === p.scheduleId));
      return { count: before - state.schedules.length };
    },
    // a exclusão por id único (sem o filtro de posts) nunca é usada
    delete: async () => assert.fail("use deleteMany com posts: { none: {} }"),
  },
};

const fakePrisma = {
  ...tx,
  $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
    state.transactions += 1;
    const snapshot = { schedules: [...state.schedules], posts: [...state.posts] };
    state.inTx = true;
    try {
      return await fn(tx);
    } catch (e) {
      state.schedules = snapshot.schedules;
      state.posts = snapshot.posts;
      throw e;
    } finally {
      state.inTx = false;
      state.locked.clear();
    }
  },
};

const logs: string[] = [];
console.error = (...args: unknown[]) => {
  logs.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" "));
};

// ------------------------------------------------------------ hooks de módulo

const FAKE_MODULES: Record<string, string> = {
  "next/server": "export class NextRequest extends Request {} export class NextResponse extends Response {}",
  "@/auth": "export const auth = async () => globalThis.__f13d.state.session;",
  "@/lib/prisma": "export const prisma = globalThis.__f13d.prisma;",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __f13d: unknown }).__f13d = { state, prisma: fakePrisma };
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

const { DELETE } = await import("../../src/app/api/schedules/[id]/route.ts");
const { POST: CLEANUP } = await import("../../src/app/api/schedules/cleanup-empty/route.ts");

// ------------------------------------------------------------ helpers

async function del(id: string) {
  const res = await DELETE(new Request(`http://localhost/api/schedules/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function cleanup(body: unknown, raw = false) {
  const res = await CLEANUP(
    new Request("http://localhost/api/schedules/cleanup-empty", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    })
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
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

const HAS_POSTS = "Este cronograma tem posts. Exclua ou mova os posts antes.";

beforeEach(() => {
  state.session = { user: { id: "00000000-0000-4000-8000-0000000000a5", role: "staff" } };
  state.schedules = [
    { id: uid(1), status: "rascunho", approvalToken: null }, // vazio
    { id: uid(2), status: "enviado_cliente", approvalToken: "tok-vazio" }, // vazio, link enviado
    { id: uid(3), status: "rascunho", approvalToken: null }, // 2 posts
    { id: uid(4), status: "aprovado_cliente", approvalToken: null }, // vazio
  ];
  state.posts = [
    { id: uid(31), scheduleId: uid(3) },
    { id: uid(32), scheduleId: uid(3) },
  ];
  state.calls = [];
  state.transactions = 0;
  state.fail = null;
  logs.length = 0;
});

// ------------------------------------------------------------ DELETE /api/schedules/[id]

describe("DELETE /api/schedules/[id]", () => {
  test("sem sessão → 401 pt-BR e nenhuma consulta", async () => {
    state.session = null;
    const r = await del(uid(1));
    assert.equal(r.status, 401);
    assertFriendly(r.json, "Sua sessão expirou. Entre de novo.");
    assert.deepEqual(state.calls, []);
    assert.equal(state.schedules.length, 4);
  });

  test("cronograma vazio → 200; só ele sai; trava → recontagem → exclusão numa transação", async () => {
    const r = await del(uid(1));
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, deleted: 1 });
    assert.deepEqual(state.schedules.map((s) => s.id), [uid(2), uid(3), uid(4)]);
    assert.equal(state.posts.length, 2);
    assert.deepEqual(state.calls, ["lock", "count", "delete"]);
    assert.equal(state.transactions, 1);
  });

  test("mesma autorização das outras ações: equipe (staff) e admin podem", async () => {
    state.session = { user: { id: "00000000-0000-4000-8000-0000000000a1", role: "admin" } };
    assert.equal((await del(uid(4))).status, 200);
    state.session = { user: { id: "00000000-0000-4000-8000-0000000000a5" } }; // sem papel = equipe
    assert.equal((await del(uid(2))).status, 200);
  });

  test("com posts → 409 pt-BR; cronograma e posts intactos", async () => {
    const r = await del(uid(3));
    assert.equal(r.status, 409);
    assertFriendly(r.json, HAS_POSTS);
    assert.equal(state.schedules.length, 4);
    assert.equal(state.posts.length, 2);
    assert.ok(!state.calls.includes("delete"));
  });

  test("post gravado depois que a tela carregou: o servidor reconta e recusa (409)", async () => {
    state.posts.push({ id: uid(11), scheduleId: uid(1) });
    const r = await del(uid(1));
    assert.equal(r.status, 409);
    assert.ok(state.schedules.some((s) => s.id === uid(1)));
    assert.ok(state.posts.some((p) => p.id === uid(11)));
  });

  test("inexistente ou id inválido → 404 pt-BR", async () => {
    const r = await del(uid(99));
    assert.equal(r.status, 404);
    assertFriendly(r.json, "Cronograma não encontrado");
    const bad = await del("abc");
    assert.equal(bad.status, 404);
    assertFriendly(bad.json, "Cronograma não encontrado");
  });

  test("maiúsculas no id: o mesmo cronograma", async () => {
    state.schedules.push({ id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", status: "rascunho", approvalToken: null });
    const r = await del("AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE");
    assert.equal(r.status, 200);
    assert.ok(!state.schedules.some((s) => s.id.startsWith("aaaa")));
  });

  test("falha do banco → 500 pt-BR sem texto do Prisma; nada muda", async () => {
    state.fail = new Error("PrismaClientKnownRequestError P2010: connection reset");
    const r = await del(uid(1));
    assert.equal(r.status, 500);
    assertFriendly(r.json);
    assert.equal(state.schedules.length, 4);
    assert.ok(logs.some((l) => l.includes("schedules/delete")));
  });
});

// ------------------------------------------------------------ POST /api/schedules/cleanup-empty

describe("POST /api/schedules/cleanup-empty", () => {
  test("sem sessão → 401 pt-BR", async () => {
    state.session = null;
    const r = await cleanup({ ids: [uid(1)] });
    assert.equal(r.status, 401);
    assertFriendly(r.json);
    assert.equal(state.schedules.length, 4);
  });

  test("corpo inválido → 400 com frase pt-BR", async () => {
    const cases: [unknown, string, boolean?][] = [
      [{ ids: [] }, "Selecione ao menos um cronograma para excluir."],
      [{}, "Envie a lista de cronogramas a excluir."],
      [{ ids: "x" }, "Envie a lista de cronogramas a excluir."],
      ["não é json", "Envie a lista de cronogramas a excluir.", true],
      [{ ids: ["abc"] }, "A lista tem um cronograma com identificador inválido."],
      [{ ids: [uid(1), uid(1).toUpperCase()] }, "A lista tem cronogramas repetidos."],
      [{ ids: Array.from({ length: 201 }, (_, i) => uid(1000 + i)) }, "Dá para excluir no máximo 200 cronogramas por vez."],
    ];
    for (const [body, message, raw] of cases) {
      const r = await cleanup(body, raw);
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
      assertFriendly(r.json, message);
    }
    assert.equal(state.transactions, 0);
  });

  test("lote: exclui só os vazios, revalidando no servidor; uma transação; relata os que ficaram", async () => {
    // a tela achava que o 3 estava vazio (ganhou posts depois) e o 99 já tinha sido excluído
    const r = await cleanup({ ids: [uid(1), uid(2).toUpperCase(), uid(3), uid(4), uid(99)] });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.deleted, 3);
    assert.deepEqual(r.json.deletedIds, [uid(1), uid(2), uid(4)]);
    assert.deepEqual(r.json.withPosts, [uid(3)]);
    assert.deepEqual(r.json.notFound, [uid(99)]);
    assert.deepEqual(state.schedules.map((s) => s.id), [uid(3)]);
    assert.equal(state.posts.length, 2, "nenhum post apagado");
    assert.equal(state.transactions, 1);
    assert.deepEqual(state.calls, ["lock", "count", "delete"]);
  });

  test("só cronogramas com posts → nada excluído", async () => {
    const r = await cleanup({ ids: [uid(3)] });
    assert.equal(r.status, 200);
    assert.equal(r.json.deleted, 0);
    assert.deepEqual(r.json.withPosts, [uid(3)]);
    assert.equal(state.schedules.length, 4);
    assert.ok(!state.calls.includes("delete"));
  });

  test("falha do banco → 500 pt-BR; a transação desfaz", async () => {
    state.fail = new Error("Prisma ECONNRESET");
    const r = await cleanup({ ids: [uid(1), uid(2)] });
    assert.equal(r.status, 500);
    assertFriendly(r.json);
    assert.equal(state.schedules.length, 4);
  });
});
