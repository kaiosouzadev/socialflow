/**
 * F7-EMAIL: e-mail principal repetido só para cliente SEM aprovação — POST /api/clients e
 * PATCH /api/clients/[id].
 *   - sem aprovação: pode repetir o e-mail de qualquer outro cliente (ex.: o da agência) → 201/200;
 *   - com aprovação: e-mail de outro cliente COM aprovação (sem diferenciar maiúsculas) → 409
 *     { error: APPROVAL_EMAIL_TAKEN, field: "email" }, nada gravado;
 *   - com aprovação pode coincidir com o e-mail de um cliente sem aprovação;
 *   - PATCH trocando o plano sem → com em conflito → 409 e a transação é desfeita (nem o cliente
 *     nem os posts da fila mudam).
 *
 * Técnica do posts-art.test.ts: hooks de módulo trocam Prisma e a sessão (@/auth) por versões
 * falsas em memória. O banco falso aplica a regra do índice parcial uq_clients_email_aprovacao
 * (lower(email) WHERE plan = 'aprovacao_cliente') e lança P2002 como o Prisma real.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ------------------------------------------------------------ banco e sessão falsos

type ClientRow = {
  id: string;
  name: string;
  email: string;
  plan: string;
  tier: string;
  status: string;
  agencyPublishes: boolean;
  extraEmails: string[];
  credentialsEnc: string | null;
};
type PostRow = { id: string; clientId: string; status: string };
type Session = { user: { id?: string; email?: string | null; role?: string } } | null;

class PrismaClientKnownRequestError extends Error {
  code: string;
  constructor(message: string, opts: { code: string }) {
    super(message);
    this.name = "PrismaClientKnownRequestError";
    this.code = opts.code;
  }
}

const AGENCIA = "zzqa.agencia@example.com"; // fictício (o caso real é o e-mail @coletivoestudio.com.br)

const state = {
  session: { user: { id: uid(900), email: "zzqa.admin@example.com", role: "admin" } } as Session,
  clients: [] as ClientRow[],
  posts: [] as PostRow[],
  calls: [] as string[],
};

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
let nextId = 100;

/** Regra do índice parcial: lower(email) único entre os clientes com plan = 'aprovacao_cliente'. */
function assertPartialIndex(row: ClientRow) {
  if (row.plan !== "aprovacao_cliente") return;
  const clash = state.clients.some(
    (c) => !sameId(c.id, row.id) && c.plan === "aprovacao_cliente" && c.email.toLowerCase() === row.email.toLowerCase()
  );
  if (clash) {
    throw new PrismaClientKnownRequestError(
      'Unique constraint failed on the constraint: `uq_clients_email_aprovacao`',
      { code: "P2002" }
    );
  }
}

function clientDelegate() {
  return {
    create: async (args: { data: Record<string, unknown> }) => {
      state.calls.push("client.create");
      const row: ClientRow = {
        id: uid(nextId++),
        name: String(args.data.name),
        email: String(args.data.email),
        plan: (args.data.plan as string | undefined) ?? "sem_aprovacao",
        tier: (args.data.tier as string | undefined) ?? "completa",
        status: (args.data.status as string | undefined) ?? "ativo",
        agencyPublishes: (args.data.agencyPublishes as boolean | undefined) ?? true,
        extraEmails: (args.data.extraEmails as string[] | undefined) ?? [],
        credentialsEnc: null,
      };
      assertPartialIndex(row);
      state.clients.push(row);
      return { ...row };
    },
    findUnique: async (args: { where: { id: string } }) => {
      state.calls.push("client.findUnique");
      const c = state.clients.find((x) => sameId(x.id, args.where.id));
      return c ? { ...c, extraEmails: [...c.extraEmails] } : null;
    },
    update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      state.calls.push("client.update");
      const i = state.clients.findIndex((x) => sameId(x.id, args.where.id));
      if (i < 0) throw new PrismaClientKnownRequestError("Record not found", { code: "P2025" });
      const next = { ...state.clients[i], ...args.data } as ClientRow;
      assertPartialIndex(next);
      state.clients[i] = next;
      return { ...next };
    },
  };
}

const postDelegate = {
  updateMany: async (args: { where: { clientId: string; status: { in: string[] } }; data: { status: string } }) => {
    state.calls.push("post.updateMany");
    let count = 0;
    for (const p of state.posts) {
      if (sameId(p.clientId, args.where.clientId) && args.where.status.in.includes(p.status)) {
        p.status = args.data.status;
        count += 1;
      }
    }
    return { count };
  },
};

const fakePrisma = {
  client: clientDelegate(),
  post: postDelegate,
  user: { findUnique: async () => assert.fail("nenhum teste manda redatora/designer") },
  // transação de verdade: em erro, desfaz tudo o que o callback gravou
  $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    state.calls.push("$transaction");
    const snapshot = structuredClone({ clients: state.clients, posts: state.posts });
    try {
      return await fn({ client: fakePrisma.client, post: postDelegate });
    } catch (e) {
      state.clients = snapshot.clients;
      state.posts = snapshot.posts;
      throw e;
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
  "@/auth": "export const auth = async () => globalThis.__f7email.state.session;",
  "@/lib/prisma": "export const prisma = globalThis.__f7email.prisma;",
  "@/generated/prisma/client": "export const Prisma = globalThis.__f7email.Prisma;",
  "@/lib/basic-plan": "export const scheduleAllBasicMonths = async () => ({ scheduled: 0 });",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __f7email: unknown }).__f7email = {
  state,
  prisma: fakePrisma,
  Prisma: { PrismaClientKnownRequestError },
};
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

const { POST } = await import("../../src/app/api/clients/route.ts");
const { PATCH } = await import("../../src/app/api/clients/[id]/route.ts");
const { APPROVAL_EMAIL_TAKEN } = await import("../../src/lib/client-emails.ts");

// ------------------------------------------------------------ helpers

type Result = { status: number; json: Record<string, unknown> };

async function create(body: Record<string, unknown>): Promise<Result> {
  const req = new Request("http://localhost/api/clients", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req as unknown as Parameters<typeof POST>[0]);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function patch(id: string, body: Record<string, unknown>): Promise<Result> {
  const req = new Request(`http://localhost/api/clients/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await PATCH(req as unknown as Parameters<typeof PATCH>[0], { params: Promise.resolve({ id }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function assertTaken(r: Result) {
  assert.equal(r.status, 409);
  assert.deepEqual(r.json, { error: APPROVAL_EMAIL_TAKEN, field: "email" });
  assert.doesNotMatch(String(r.json.error), /P20\d\d|Prisma|constraint|uq_|unique/i, "sem detalhe técnico (N-14)");
}

function row(id: string): ClientRow {
  const c = state.clients.find((x) => sameId(x.id, id));
  assert.ok(c, `cliente ${id} existe`);
  return c;
}

const COM_APROVACAO = uid(1); // ZZ QA F7 Com — com aprovação, e-mail próprio
const SEM_AGENCIA = uid(2); // ZZ QA F7 Sem — sem aprovação, e-mail da agência
const SEM_OUTRO = uid(3); // ZZ QA F7 Sem 2 — sem aprovação, e-mail do cliente "Com"

beforeEach(() => {
  state.session = { user: { id: uid(900), email: "zzqa.admin@example.com", role: "admin" } };
  const base = { tier: "completa", status: "ativo", agencyPublishes: true, extraEmails: [], credentialsEnc: null };
  state.clients = [
    { ...base, id: COM_APROVACAO, name: "ZZ QA F7 Com", email: "zzqa.com@example.com", plan: "aprovacao_cliente" },
    { ...base, id: SEM_AGENCIA, name: "ZZ QA F7 Sem", email: AGENCIA, plan: "sem_aprovacao" },
    { ...base, id: SEM_OUTRO, name: "ZZ QA F7 Sem 2", email: "zzqa.com@example.com", plan: "sem_aprovacao" },
  ];
  state.posts = [
    { id: uid(51), clientId: SEM_OUTRO, status: "scheduled" },
    { id: uid(52), clientId: SEM_OUTRO, status: "failed" },
  ];
  state.calls = [];
  logs.length = 0;
});

// ------------------------------------------------------------ POST

describe("POST /api/clients — e-mail principal e plano", () => {
  test("sem aprovação com e-mail já usado por outro cliente (o da agência) → 201", async () => {
    const r = await create({ name: "ZZ QA F7 Novo", email: AGENCIA, plan: "sem_aprovacao" });
    assert.equal(r.status, 201);
    assert.equal(r.json.email, AGENCIA);
    assert.equal(r.json.plan, "sem_aprovacao");
    assert.equal(state.clients.filter((c) => c.email === AGENCIA).length, 2);
  });

  test("sem aprovação é o padrão: e-mail de um cliente COM aprovação, em maiúsculas → 201", async () => {
    const r = await create({ name: "ZZ QA F7 Padrão", email: "ZZQA.COM@example.com" });
    assert.equal(r.status, 201);
    assert.equal(r.json.plan, "sem_aprovacao");
    assert.equal(state.clients.length, 4);
  });

  test("com aprovação e e-mail de outro cliente com aprovação (maiúsculas diferentes) → 409 no campo email, nada criado", async () => {
    const r = await create({ name: "ZZ QA F7 Conflito", email: "ZZQA.Com@Example.com", plan: "aprovacao_cliente" });
    assertTaken(r);
    assert.equal(state.clients.length, 3, "nenhum cliente novo");
  });

  test("com aprovação e e-mail usado só por clientes sem aprovação → 201", async () => {
    const r = await create({ name: "ZZ QA F7 Com 2", email: AGENCIA, plan: "aprovacao_cliente" });
    assert.equal(r.status, 201);
    assert.equal(r.json.plan, "aprovacao_cliente");
  });
});

// ------------------------------------------------------------ PATCH

describe("PATCH /api/clients/[id] — e-mail principal e plano", () => {
  test("sem aprovação trocando para um e-mail já usado (o da agência) → 200 e grava", async () => {
    const r = await patch(SEM_OUTRO, { email: AGENCIA });
    assert.equal(r.status, 200);
    assert.equal(r.json.email, AGENCIA);
    assert.equal(row(SEM_OUTRO).email, AGENCIA);
    assert.equal(state.clients.filter((c) => c.email === AGENCIA).length, 2);
  });

  test("trocar o plano sem → com aprovação com e-mail de outro com aprovação → 409 e nada gravado", async () => {
    const before = structuredClone(state.clients);
    // junto com "publica? → Não": se gravasse, os posts da fila voltariam para draft
    const r = await patch(SEM_OUTRO, { plan: "aprovacao_cliente", name: "ZZ QA F7 Renomeado", agencyPublishes: false });
    assertTaken(r);
    assert.deepEqual(state.clients, before, "cliente intacto (plano, nome e publica)");
    assert.deepEqual(
      state.posts.map((p) => p.status),
      ["scheduled", "failed"],
      "posts da fila intactos"
    );
    assert.ok(!state.calls.includes("post.updateMany"), "não chegou a mexer nos posts");
  });

  test("com aprovação trocando para o e-mail de outro com aprovação → 409", async () => {
    const r1 = await create({ name: "ZZ QA F7 Com 3", email: "zzqa.com3@example.com", plan: "aprovacao_cliente" });
    assert.equal(r1.status, 201);
    const r = await patch(String(r1.json.id), { email: "zzqa.com@example.com" });
    assertTaken(r);
    assert.equal(row(String(r1.json.id)).email, "zzqa.com3@example.com");
  });

  test("trocar o plano sem → com aprovação com e-mail livre entre os com aprovação → 200", async () => {
    const r = await patch(SEM_AGENCIA, { plan: "aprovacao_cliente" });
    assert.equal(r.status, 200);
    assert.equal(row(SEM_AGENCIA).plan, "aprovacao_cliente");
  });
});
