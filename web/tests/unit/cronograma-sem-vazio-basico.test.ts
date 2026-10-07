/**
 * F13-APROVACOES (causa dos cronogramas vazios): plano básico — lib/basic-plan.ts.
 *
 * Antes: `scheduleBasicMonth` criava o cronograma do mês ANTES do laço dos templates. Com todos os
 * dias do mês já passados (o cadastro de cliente básico agenda TODOS os meses do banco de artes),
 * ou com todos os templates já agendados, o cronograma ficava vazio em /aprovacoes.
 * Agora: o cronograma só nasce junto com o 1º post, na mesma transação.
 *
 * O banco falso recusa `schedule.create` fora da transação e desfaz a transação que falha.
 * IA, R2, Drive e geração de arte são módulos falsos (nunca chamados aqui).
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;
const state = {
  templates: [] as Row[],
  posts: [] as Row[],
  schedules: [] as Row[],
  inTx: false,
  transactions: 0,
  failPostCreate: false,
};

const db = {
  client: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === CLIENT_ID ? { id: CLIENT_ID, name: "ZZ QA F13 Básico", tier: "basica", briefing: null, socialAccounts: [] } : null,
  },
  artTemplate: {
    findMany: async ({ where, distinct }: { where: { month?: string | { not: null } }; distinct?: string[] }) => {
      const rows = state.templates.filter((t) => (typeof where.month === "string" ? t.month === where.month : true));
      if (!distinct) return rows;
      const seen = new Set<unknown>();
      return rows.filter((t) => !seen.has(t.month) && seen.add(t.month));
    },
    update: async () => ({}),
  },
  post: {
    findMany: async ({ where }: { where: { clientId: string; artTemplateId?: { in: string[] } } }) =>
      state.posts.filter(
        (p) => p.clientId === where.clientId && (!where.artTemplateId || where.artTemplateId.in.includes(p.artTemplateId as string))
      ),
    create: async ({ data }: { data: Row }) => {
      if (state.failPostCreate) throw new Error("falha ao gravar o post");
      assert.ok(data.scheduleId, "post sem cronograma");
      const row = { id: `post-${state.posts.length + 1}`, ...data };
      state.posts.push(row);
      return row;
    },
  },
  schedule: {
    findFirst: async ({ where }: { where: { clientId: string; monthRef: Date } }) =>
      state.schedules.find(
        (s) => s.clientId === where.clientId && (s.monthRef as Date).getTime() === where.monthRef.getTime()
      ) ?? null,
    create: async ({ data }: { data: Row }) => {
      assert.ok(state.inTx, "cronograma criado fora da transação do 1º post");
      const row = { id: `sch-${state.schedules.length + 1}`, ...data };
      state.schedules.push(row);
      return { id: row.id };
    },
  },
};
const fakePrisma = {
  ...db,
  $transaction: async (fn: (t: typeof db) => Promise<unknown>) => {
    state.transactions += 1;
    const snapshot = { posts: [...state.posts], schedules: [...state.schedules] };
    state.inTx = true;
    try {
      return await fn(db);
    } catch (e) {
      state.posts = snapshot.posts;
      state.schedules = snapshot.schedules;
      throw e;
    } finally {
      state.inTx = false;
    }
  },
};

// ------------------------------------------------------------ hooks de módulo

const FAKE_MODULES: Record<string, string> = {
  "@/lib/prisma": "export const prisma = globalThis.__f13b.prisma;",
  "@/generated/prisma/client": "export const Prisma = {};",
  "@/lib/art-gen": "export async function generateArt() { throw new Error('arte não deve ser gerada'); }",
  "@/lib/gemini":
    "export async function generateText() { throw new Error('IA não deve ser chamada'); } export function parseModelJson() { return {}; }",
  "@/lib/ai-models": "export async function getTextModel() { return { provider: 'gemini', model: 'x' }; }",
  "@/lib/ai-text": "export async function generateAiText() { throw new Error('IA não deve ser chamada'); }",
  "@/lib/r2": "export const r2Configured = () => false; export async function uploadToR2() {}",
  "@/lib/google-drive":
    "export const driveConfigured = () => false; export async function ensureYearMonthFolders() {} export async function uploadToDrive() {} export const serviceAccountEmail = () => null;",
  "@/lib/drive-sync": "export async function ensureClientDriveFolder() {} export function monthIndexFor() { return 0; }",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __f13b: unknown }).__f13b = { prisma: fakePrisma };
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

const { scheduleBasicMonth, scheduleAllBasicMonths } = await import("../../src/lib/basic-plan.ts");

// ------------------------------------------------------------ testes

const PAST = "2020-01"; // todos os dias já passaram
const FUTURE = "2099-05";
const tpl = (id: string, month: string, day: number) => ({
  id,
  name: `ZZ QA F13 tema ${id}`,
  month,
  day,
  time: "18:00",
  active: true,
  captions: { shared: "Legenda padrão" }, // com legenda: a IA não é chamada
});

beforeEach(() => {
  state.templates = [tpl("p1", PAST, 5), tpl("p2", PAST, 20), tpl("f1", FUTURE, 3), tpl("f2", FUTURE, 15)];
  state.posts = [];
  state.schedules = [];
  state.transactions = 0;
  state.failPostCreate = false;
});

describe("plano básico não deixa cronograma vazio", () => {
  test("mês com todos os dias já passados → nenhum post e NENHUM cronograma", async () => {
    const r = await scheduleBasicMonth(CLIENT_ID, PAST);
    assert.equal(r.scheduled, 0);
    assert.equal(r.skipped.length, 2);
    assert.equal(state.schedules.length, 0);
  });

  test("templates do mês já agendados → nenhum cronograma novo", async () => {
    state.posts = [
      { id: "x1", clientId: CLIENT_ID, artTemplateId: "f1" },
      { id: "x2", clientId: CLIENT_ID, artTemplateId: "f2" },
    ];
    const r = await scheduleBasicMonth(CLIENT_ID, FUTURE);
    assert.equal(r.scheduled, 0);
    assert.equal(state.schedules.length, 0);
  });

  test("mês futuro → 1 cronograma, criado na transação do 1º post; todos os posts nele", async () => {
    const r = await scheduleBasicMonth(CLIENT_ID, FUTURE);
    assert.equal(r.scheduled, 2);
    assert.equal(state.schedules.length, 1);
    assert.equal(state.transactions, 1);
    const sid = state.schedules[0].id;
    assert.deepEqual(state.posts.map((p) => p.scheduleId), [sid, sid]);
    assert.equal(state.schedules[0].status, "rascunho");
    assert.equal((state.schedules[0].monthRef as Date).toISOString().slice(0, 7), FUTURE);
  });

  test("cronograma do mês já existe → reaproveita, sem transação nova", async () => {
    const monthRef = new Date(`${FUTURE}-01T00:00:00-03:00`);
    state.schedules = [{ id: "sch-existente", clientId: CLIENT_ID, monthRef, status: "rascunho" }];
    const r = await scheduleBasicMonth(CLIENT_ID, FUTURE);
    assert.equal(r.scheduled, 2);
    assert.equal(state.schedules.length, 1);
    assert.equal(state.transactions, 0);
    assert.ok(state.posts.every((p) => p.scheduleId === "sch-existente"));
  });

  test("falha ao gravar o 1º post → a transação desfaz: nenhum cronograma", async () => {
    state.failPostCreate = true;
    await assert.rejects(() => scheduleBasicMonth(CLIENT_ID, FUTURE));
    assert.equal(state.schedules.length, 0);
    assert.equal(state.posts.length, 0);
  });

  test("cadastro de cliente básico (todos os meses do banco): só o mês com post ganha cronograma", async () => {
    const r = await scheduleAllBasicMonths(CLIENT_ID);
    assert.equal(r.scheduled, 2);
    assert.equal(state.schedules.length, 1);
    assert.equal((state.schedules[0].monthRef as Date).toISOString().slice(0, 7), FUTURE);
  });
});
