/**
 * S33 / N-18 / N-22: o commit da importação (lib/doc-import-commit.ts) grava a
 * legenda também em `captions`, por rede alvo do post, mantendo `caption`.
 *
 * `doc-import-commit.ts` usa o alias "@/" e o Prisma: como no
 * drive-sync-structure.test.ts, hooks de módulo resolvem "@/" para os fontes
 * e trocam Prisma por um banco falso em memória (sem rede e sem banco real).
 * O `commitImport` roda de verdade sobre a fixture sintética do S06.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const FIXTURE = readFileSync(new URL("../fixtures/doc-mensal-sintetico.txt", import.meta.url), "utf8");
const PASSWORD = "SENHA-FALSA-123";
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";

// ------------------------------------------------------------ banco falso

type Row = Record<string, unknown>;
const state = {
  client: null as Row | null,
  users: [] as Row[],
  posts: [] as Row[],
  schedules: [] as Row[],
  pending: [] as Row[],
};

function reset(platforms: string[] = []) {
  state.client = {
    id: CLIENT_ID,
    name: "ZZ QA Captions",
    plan: "aprovacao_cliente",
    agencyPublishes: true,
    responsibleUserId: null,
    briefing: null,
    tradeName: null,
    facebookUrl: null,
    instagramUrl: null,
    website: null,
    city: null,
    phone: null,
    socialAccounts: platforms.map((platform) => ({ platform })),
  };
  state.users = [{ id: "u-stella", name: "Stella" }];
  state.posts = [];
  state.schedules = [];
  state.pending = [];
}

type Range = { gte?: Date; lt?: Date };
const inRange = (d: Date, r?: Range) => !r || ((!r.gte || d >= r.gte) && (!r.lt || d < r.lt));

const tx = {
  $executeRaw: async () => 0,
  client: {
    findUnique: async ({ where }: { where: { id: string } }) => (state.client?.id === where.id ? state.client : null),
    update: async ({ data }: { data: Row }) => Object.assign(state.client as Row, data),
  },
  user: { findMany: async () => state.users },
  post: {
    findMany: async ({ where }: { where: { clientId: string; scheduledAt?: Range } }) =>
      state.posts.filter((p) => p.clientId === where.clientId && inRange(p.scheduledAt as Date, where.scheduledAt)),
    createMany: async ({ data }: { data: Row[] }) => {
      state.posts.push(...data);
      return { count: data.length };
    },
  },
  pendingItem: {
    findMany: async ({ where }: { where: { clientId: string; kind: string } }) =>
      state.pending
        .filter((p) => p.clientId === where.clientId && p.kind === where.kind)
        .map((p) => ({ ...p, resolvedAt: p.resolvedAt ?? null })),
    createMany: async ({ data }: { data: Row[] }) => {
      state.pending.push(...data);
      return { count: data.length };
    },
  },
  schedule: {
    findFirst: async ({ where }: { where: { clientId: string; monthRef: Date } }) =>
      state.schedules.find(
        (s) => s.clientId === where.clientId && (s.monthRef as Date).getTime() === where.monthRef.getTime()
      ) ?? null,
    create: async ({ data }: { data: Row }) => {
      const row: Row = { id: `sch-${state.schedules.length + 1}`, ...data };
      state.schedules.push(row);
      return { id: row.id, status: row.status };
    },
  },
};
const fakePrisma = { ...tx, $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };

// ------------------------------------------------------------ hooks de módulo

const FAKE_MODULES: Record<string, string> = {
  "@/lib/prisma": "export const prisma = globalThis.__p39c.prisma;",
  "@/generated/prisma/client": "export const Prisma = {};",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __p39c: unknown }).__p39c = { prisma: fakePrisma };
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

const { commitImport } = await import("../../src/lib/doc-import-commit.ts");

// ------------------------------------------------------------ testes

const input = (targets?: ("instagram" | "facebook" | "linkedin")[]) => ({
  text: FIXTURE,
  refMonth: "2026-09",
  options: targets ? { targets } : undefined,
});

describe("commitImport grava a legenda em captions por rede alvo (N-18)", () => {
  beforeEach(() => reset());

  test("cliente sem contas → IG + FB: captions {instagram, facebook} = caption; posts sempre draft", async () => {
    const result = await commitImport(CLIENT_ID, input());
    assert.equal(result.created.posts, 13);
    assert.equal(state.posts.length, 13);
    const withCaption = state.posts.filter((p) => p.caption);
    assert.ok(withCaption.length >= 12, `posts com legenda: ${withCaption.length}`);
    for (const p of state.posts) {
      assert.equal(p.status, "draft");
      assert.deepEqual(p.targets, ["instagram", "facebook"]);
      if (p.caption) assert.deepEqual(p.captions, { instagram: p.caption, facebook: p.caption }, String(p.theme));
      else assert.equal(p.captions, undefined, String(p.theme));
    }
  });

  test("redes das contas do cliente (instagram + linkedin) → captions só dessas redes", async () => {
    reset(["instagram", "linkedin", "instagram"]);
    await commitImport(CLIENT_ID, input());
    const p = state.posts.find((x) => x.caption);
    assert.ok(p);
    assert.deepEqual(p.targets, ["instagram", "linkedin"]);
    assert.deepEqual(p.captions, { instagram: p.caption, linkedin: p.caption });
  });

  test("options.targets ['instagram'] → captions só {instagram}", async () => {
    await commitImport(CLIENT_ID, input(["instagram"]));
    for (const p of state.posts.filter((x) => x.caption)) assert.deepEqual(p.captions, { instagram: p.caption });
  });

  test("a senha falsa não chega a nenhuma linha gravada; reimportar cria 0", async () => {
    await commitImport(CLIENT_ID, input());
    assert.ok(!JSON.stringify(state).includes(PASSWORD));
    const again = await commitImport(CLIENT_ID, input());
    assert.equal(again.created.posts, 0);
    assert.equal(again.created.pendingItems, 0);
    assert.equal(state.posts.length, 13);
  });
});
