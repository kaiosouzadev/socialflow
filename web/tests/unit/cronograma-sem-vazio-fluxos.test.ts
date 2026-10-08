/**
 * F13-APROVACOES: os outros fluxos que criam cronograma não deixam cronograma vazio
 * (código conferido; estes testes travam o comportamento):
 *   - importação do .docx (lib/doc-import-commit.ts `commitImport`): só cria o cronograma do mês
 *     que recebe post, na mesma transação dos posts; tudo desmarcado/em conflito → nenhum;
 *   - "Salvar cronograma" da IA (api/ai/calendar/commit): exige ≥ 1 post e cria o cronograma
 *     dentro da transação dos posts; falha ao gravar → nada fica.
 *
 * Banco falso em memória: recusa `schedule.create` fora de transação e desfaz a transação que
 * falha. Técnica dos testes doc-import-captions / posts-bulk-delete (hooks de módulo).
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const FIXTURE = readFileSync(new URL("../fixtures/doc-mensal-sintetico.txt", import.meta.url), "utf8");
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";

type Row = Record<string, unknown>;
const state = {
  session: { user: { id: "00000000-0000-4000-8000-0000000000a5", role: "staff" } } as { user: { id?: string; role?: string } } | null,
  client: null as Row | null,
  users: [] as Row[],
  posts: [] as Row[],
  schedules: [] as Row[],
  pending: [] as Row[],
  inTx: false,
  failCreatePosts: false,
};

function reset() {
  state.client = {
    id: CLIENT_ID,
    name: "ZZ QA F13 Fluxos",
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
    driveFolderId: null,
    credentialsEnc: null,
    socialAccounts: [],
  };
  state.users = [{ id: "u-stella", name: "Stella" }];
  state.posts = [];
  state.schedules = [];
  state.pending = [];
  state.failCreatePosts = false;
}

type Range = { gte?: Date; lt?: Date };
const inRange = (d: Date, r?: Range) => !r || ((!r.gte || d >= r.gte) && (!r.lt || d < r.lt));

const db = {
  $executeRaw: async () => 0,
  client: {
    findUnique: async ({ where }: { where: { id: string } }) => (state.client?.id === where.id ? state.client : null),
    update: async ({ data }: { data: Row }) => Object.assign(state.client as Row, data),
  },
  user: { findMany: async () => state.users },
  post: {
    findMany: async ({ where }: { where: { clientId?: string; scheduleId?: string; scheduledAt?: Range } }) =>
      where.scheduleId !== undefined
        ? state.posts.filter((p) => p.scheduleId === where.scheduleId)
        : state.posts.filter((p) => p.clientId === where.clientId && inRange(p.scheduledAt as Date, where.scheduledAt)),
    createMany: async ({ data }: { data: Row[] }) => {
      if (state.failCreatePosts) throw new Error("falha ao gravar os posts");
      state.posts.push(...data);
      return { count: data.length };
    },
    createManyAndReturn: async ({ data }: { data: Row[] }) => {
      if (state.failCreatePosts) throw new Error("falha ao gravar os posts");
      const rows = data.map((d, i) => ({ id: `post-${state.posts.length + i + 1}`, ...d }));
      state.posts.push(...rows);
      return rows;
    },
  },
  pendingItem: {
    findMany: async ({ where }: { where: { clientId: string; kind: string } }) =>
      state.pending.filter((p) => p.clientId === where.clientId && p.kind === where.kind).map((p) => ({ ...p, resolvedAt: null })),
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
      assert.ok(state.inTx, "cronograma criado fora da transação dos posts");
      const row: Row = { id: `sch-${state.schedules.length + 1}`, ...data };
      state.schedules.push(row);
      return { id: row.id, status: row.status };
    },
  },
};
const fakePrisma = {
  ...db,
  $transaction: async (fn: (t: typeof db) => Promise<unknown>) => {
    const snapshot = { posts: [...state.posts], schedules: [...state.schedules], pending: [...state.pending] };
    state.inTx = true;
    try {
      return await fn(db);
    } catch (e) {
      Object.assign(state, snapshot);
      throw e;
    } finally {
      state.inTx = false;
    }
  },
};

console.error = () => {};

// ------------------------------------------------------------ hooks de módulo

const FAKE_MODULES: Record<string, string> = {
  "next/server":
    "export class NextRequest extends Request {} export class NextResponse extends Response {} export function after() {}",
  "@/auth": "export const auth = async () => globalThis.__f13f.state.session;",
  "@/lib/prisma": "export const prisma = globalThis.__f13f.prisma;",
  "@/generated/prisma/client": "export const Prisma = {};",
  "@/lib/drive-sync":
    "export async function prepareClientDriveFolders() { return {}; } export function spMonthKey(d) { return d.toISOString().slice(0, 7); }",
  "@/lib/calendar-captions": "export async function fillMissingCaptions() { return { failed: 0 }; } export function needsContent() { return false; }",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __f13f: unknown }).__f13f = { state, prisma: fakePrisma };
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

const { analyzeImport, commitImport } = await import("../../src/lib/doc-import-commit.ts");
const { POST: CALENDAR_COMMIT } = await import("../../src/app/api/ai/calendar/commit/route.ts");

/** Todo cronograma tem ≥ 1 post. */
function assertNoEmptySchedule() {
  for (const s of state.schedules) {
    assert.ok(state.posts.some((p) => p.scheduleId === s.id), `cronograma ${String(s.id)} ficou sem posts`);
  }
}

// ------------------------------------------------------------ importação do .docx

describe("importação do documento", () => {
  beforeEach(() => reset());
  const input = (exclude?: number[]) => ({ text: FIXTURE, refMonth: "2026-09", options: exclude ? { exclude } : undefined });

  test("importação normal: cronograma só do mês com posts, cada um com posts", async () => {
    const r = await commitImport(CLIENT_ID, input());
    assert.ok(r.created.posts > 0);
    assert.equal(r.created.schedules, state.schedules.length);
    assert.ok(state.schedules.length >= 1);
    assertNoEmptySchedule();
  });

  test("todos os posts desmarcados na prévia → nenhum cronograma", async () => {
    const a = await analyzeImport(CLIENT_ID, input());
    const lines = a.items.filter((i) => i.kind !== "stand_by").map((i) => i.line);
    assert.ok(lines.length > 0);
    const r = await commitImport(CLIENT_ID, input(lines));
    assert.equal(r.created.posts, 0);
    assert.equal(r.created.schedules, 0);
    assert.equal(state.schedules.length, 0);
  });

  test("reimportar (tudo em conflito) → nenhum cronograma novo", async () => {
    await commitImport(CLIENT_ID, input());
    const before = state.schedules.length;
    const again = await commitImport(CLIENT_ID, input());
    assert.equal(again.created.posts, 0);
    assert.equal(again.created.schedules, 0);
    assert.equal(state.schedules.length, before);
    assertNoEmptySchedule();
  });

  test("falha ao gravar os posts → a transação desfaz o cronograma", async () => {
    state.failCreatePosts = true;
    await assert.rejects(() => commitImport(CLIENT_ID, input()));
    assert.equal(state.schedules.length, 0);
  });
});

// ------------------------------------------------------------ "Salvar cronograma" da IA

async function saveCalendar(posts: unknown[]) {
  const req = new Request("http://localhost/api/ai/calendar/commit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 200)}` },
    body: JSON.stringify({ clientId: CLIENT_ID, month: "2027-02", posts }),
  });
  const res = await CALENDAR_COMMIT(req as unknown as Parameters<typeof CALENDAR_COMMIT>[0]);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const post = (day: number) => ({
  theme: `ZZ QA F13 tema ${day}`,
  format: "feed",
  scheduledAt: new Date(`2027-02-${String(day).padStart(2, "0")}T18:00:00-03:00`).toISOString(),
  targets: ["instagram"],
});

describe("Salvar cronograma da IA", () => {
  beforeEach(() => reset());

  test("sem posts → 400 e nenhum cronograma", async () => {
    const r = await saveCalendar([]);
    assert.equal(r.status, 400);
    assert.equal(state.schedules.length, 0);
  });

  test("com posts → 201; 1 cronograma, com os posts", async () => {
    const r = await saveCalendar([post(3), post(10)]);
    assert.equal(r.status, 201);
    assert.equal(state.schedules.length, 1);
    assert.equal(state.posts.length, 2);
    assertNoEmptySchedule();
  });

  test("falha ao gravar os posts → 500 e o cronograma recém-criado não fica", async () => {
    state.failCreatePosts = true;
    const r = await saveCalendar([post(3)]);
    assert.equal(r.status, 500);
    assert.equal(state.schedules.length, 0);
  });
});
