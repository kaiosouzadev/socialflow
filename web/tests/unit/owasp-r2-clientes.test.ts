/**
 * OWASP R2 — cadastro de clientes, credenciais e exclusão de cliente.
 *   AC-02/CR-03: GET /api/clients e GET/PATCH /api/clients/[id] nunca devolvem `credentialsEnc`
 *                (select explícito + `hasCredentials`), com `Cache-Control: no-store`;
 *   AC-03/CR-04: revelar credenciais grava `credential.reveal` (quem, cliente, redes — nunca login/
 *                senha), limita 30 revelações/hora por pessoa (31ª → 429 pt-BR + Retry-After) e
 *                falha FECHADA se a trilha não grava; PUT grava `credential.update` (só nomes de redes);
 *   AC-07:       DELETE /api/clients/[id] só admin (staff → 403 pt-BR, nada apagado) + `client.delete`
 *                com nome e contagens;
 *   AUD2-04:     website/instagramUrl/facebookUrl/logoUrl só https: (javascript:/data:/… → 400 pt-BR
 *                por campo; "www.x.com" e http:// → https://).
 *
 * Técnica dos demais testes de rota: hooks de módulo resolvem "@/" para os fontes e trocam Prisma e a
 * sessão (@/auth) por versões falsas em memória. As rotas, o zod, o crypto (AES-GCM real, chave de
 * teste) e o lib/audit rodam de verdade.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.TOKEN_ENC_KEY = randomBytes(32).toString("hex");

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ------------------------------------------------------------ banco e sessão falsos

type Session = { user: { id?: string; email?: string; role?: string } } | null;
type ClientRow = Record<string, unknown> & { id: string; name: string; credentialsEnc: string | null };
type AuditRow = {
  id: string;
  at: Date;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  clientId: string | null;
  meta: unknown;
  ip: string | null;
};

const STAFF: Session = { user: { id: uid(901), email: "zzqa.r2.staff@example.com", role: "staff" } };
const STAFF2: Session = { user: { id: uid(902), email: "zzqa.r2.staff2@example.com", role: "staff" } };
const ADMIN: Session = { user: { id: uid(900), email: "zzqa.r2.admin@example.com", role: "admin" } };
const A = uid(1);
const B = uid(2);

class PrismaClientKnownRequestError extends Error {
  code: string;
  constructor(message: string, opts: { code: string }) {
    super(message);
    this.code = opts.code;
  }
}

const state = {
  session: STAFF as Session,
  clients: [] as ClientRow[],
  posts: [] as { id: string; clientId: string; status: string }[],
  audit: [] as AuditRow[],
  calls: [] as { op: string; args: unknown }[],
  failAuditCreate: false,
  failAuditCount: false,
  /** true = o banco falso ignora a trava (para provar que o teste de concorrência pega a corrida) */
  ignoreLock: false,
  lockKeys: [] as string[],
};

/** Latência de E/S do banco falso: deixa os pedidos simultâneos se intercalarem como no Postgres. */
const tick = () => new Promise<void>((r) => setImmediate(r));
/** pg_advisory_xact_lock falso: uma trava por chave, solta no fim da transação. */
const advisoryLocks = new Map<string, Promise<void>>();

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
let seq = 1000;

/** Projeção do `select` do Prisma (só o que a rota pediu sai do banco falso). */
function project(row: ClientRow, select: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(select)) {
    if (!v) continue;
    if (k === "_count") {
      const counts: Record<string, number> = {};
      for (const c of Object.keys((v as { select: Record<string, boolean> }).select)) {
        counts[c] = c === "posts" ? state.posts.filter((p) => sameId(p.clientId, row.id)).length : 0;
      }
      out._count = counts;
    } else if (k === "socialAccounts") out.socialAccounts = [];
    else out[k] = row[k];
  }
  return out;
}

function auditMatches(r: AuditRow, where: Record<string, unknown>): boolean {
  if (where.action !== undefined && r.action !== where.action) return false;
  if (where.actorId !== undefined && r.actorId !== where.actorId) return false;
  if (where.actorEmail !== undefined && r.actorEmail !== where.actorEmail) return false;
  const at = where.at as { gte?: Date } | undefined;
  if (at?.gte && r.at < at.gte) return false;
  return true;
}

const clientDelegate = {
  findMany: async (args: { select?: Record<string, unknown>; include?: unknown }) => {
    state.calls.push({ op: "client.findMany", args });
    return state.clients.map((c) => project(c, args.select));
  },
  findUnique: async (args: { where: { id: string }; select?: Record<string, unknown> }) => {
    state.calls.push({ op: "client.findUnique", args });
    const c = state.clients.find((x) => sameId(x.id, args.where.id));
    return c ? project(c, args.select) : null;
  },
  create: async (args: { data: Record<string, unknown>; select?: Record<string, unknown> }) => {
    state.calls.push({ op: "client.create", args });
    const row = { credentialsEnc: null, extraEmails: [], ...args.data, id: uid(seq++) } as unknown as ClientRow;
    state.clients.push(row);
    return project(row, args.select);
  },
  update: async (args: { where: { id: string }; data: Record<string, unknown>; select?: Record<string, unknown> }) => {
    state.calls.push({ op: "client.update", args });
    const i = state.clients.findIndex((x) => sameId(x.id, args.where.id));
    if (i < 0) throw new PrismaClientKnownRequestError("Record not found", { code: "P2025" });
    state.clients[i] = { ...state.clients[i], ...args.data } as ClientRow;
    return project(state.clients[i], args.select);
  },
  delete: async (args: { where: { id: string } }) => {
    state.calls.push({ op: "client.delete", args });
    const i = state.clients.findIndex((x) => sameId(x.id, args.where.id));
    if (i < 0) throw new PrismaClientKnownRequestError("Record not found", { code: "P2025" });
    const [row] = state.clients.splice(i, 1);
    state.posts = state.posts.filter((p) => !sameId(p.clientId, row.id));
    return row;
  },
};

const postDelegate = {
  count: async (args: { where: { clientId: string; status?: string | { in: string[] } } }) => {
    return state.posts.filter((p) => {
      if (!sameId(p.clientId, args.where.clientId)) return false;
      const st = args.where.status;
      if (typeof st === "string") return p.status === st;
      if (st && "in" in st) return st.in.includes(p.status);
      return true;
    }).length;
  },
  updateMany: async () => ({ count: 0 }),
};

const fakePrisma = {
  client: clientDelegate,
  post: postDelegate,
  user: { findUnique: async () => null },
  auditLog: {
    create: async ({ data }: { data: Omit<AuditRow, "id" | "at"> }) => {
      state.calls.push({ op: "auditLog.create", args: data });
      await tick();
      if (state.failAuditCreate) throw new Error("relation audit_log does not exist");
      const row = { id: uid(seq++), at: new Date(), ...data } as AuditRow;
      state.audit.push(row);
      return row;
    },
    count: async ({ where }: { where: Record<string, unknown> }) => {
      await tick();
      if (state.failAuditCount) throw Object.assign(new Error("relation audit_log does not exist"), { code: "P2021" });
      return state.audit.filter((r) => auditMatches(r, where)).length;
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      const rows = state.audit.filter((r) => auditMatches(r, where)).sort((a, b) => +a.at - +b.at);
      return rows[0] ? { at: rows[0].at } : null;
    },
  },
  $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
    const release: (() => void)[] = [];
    const tx = {
      client: clientDelegate,
      post: postDelegate,
      auditLog: fakePrisma.auditLog,
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        assert.match(strings.join("?"), /SELECT pg_advisory_xact_lock\(hashtext\(\?::text\)\)/);
        const key = String(values[0]);
        state.lockKeys.push(key);
        if (state.ignoreLock) return 1;
        while (advisoryLocks.has(key)) await advisoryLocks.get(key);
        let done!: () => void;
        advisoryLocks.set(key, new Promise<void>((r) => (done = r)));
        release.push(() => {
          advisoryLocks.delete(key);
          done();
        });
        return 1;
      },
    };
    try {
      return await fn(tx);
    } finally {
      for (const r of release) r(); // a trava da transação cai no commit/rollback
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
  "@/auth": "export const auth = async () => globalThis.__r2c.state.session;",
  "@/lib/prisma": "export const prisma = globalThis.__r2c.prisma;",
  "@/generated/prisma/client": "export const Prisma = globalThis.__r2c.Prisma;",
  "@/lib/basic-plan": "export const scheduleAllBasicMonths = async () => ({ scheduled: 0 });",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __r2c: unknown }).__r2c = {
  state,
  prisma: fakePrisma,
  Prisma: { PrismaClientKnownRequestError, JsonNull: null },
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

const listRoute = await import("../../src/app/api/clients/route.ts");
const itemRoute = await import("../../src/app/api/clients/[id]/route.ts");
const credRoute = await import("../../src/app/api/clients/[id]/credentials/route.ts");
const { encryptCredentials } = await import("../../src/lib/client-credentials.ts");
const { ADMIN_ONLY } = await import("../../src/lib/permissions.ts");
const { REVEAL_LIMIT_PER_HOUR } = await import("../../src/lib/credential-audit.ts");

// ------------------------------------------------------------ helpers

type Result = { status: number; json: Record<string, unknown> & unknown[]; text: string; headers: Headers };

async function read(res: Response): Promise<Result> {
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json: json as Result["json"], text, headers: res.headers };
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, init?: RequestInit) =>
  new Request(`http://localhost${url}`, { ...init, headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" } });

const PASSWORD = "SENHA-FALSA-R2-123";
const LOGIN = "zzqa.r2.login";

function seed() {
  state.clients = [
    {
      id: A,
      name: "ZZ QA R2 Cliente A",
      email: "zzqa.r2.a@example.com",
      plan: "sem_aprovacao",
      tier: "completa",
      status: "ativo",
      agencyPublishes: true,
      extraEmails: [],
      briefing: { products: "x" },
      phone: "11 99999-0000",
      whatsapp: "11 99999-0000",
      website: null,
      credentialsEnc: encryptCredentials([
        { network: "Instagram", login: LOGIN, password: PASSWORD },
        { network: "Facebook", login: `${LOGIN}.fb`, password: `${PASSWORD}fb` },
      ]),
    },
    {
      id: B,
      name: "ZZ QA R2 Cliente B",
      email: "zzqa.r2.b@example.com",
      plan: "sem_aprovacao",
      tier: "completa",
      status: "ativo",
      agencyPublishes: true,
      extraEmails: [],
      credentialsEnc: null,
    },
  ];
  state.posts = [
    { id: uid(101), clientId: A, status: "draft" },
    { id: uid(102), clientId: A, status: "published" },
    { id: uid(103), clientId: A, status: "published" },
  ];
}

function assertNoStore(h: Headers) {
  assert.match(h.get("cache-control") ?? "", /no-store/, "Cache-Control: no-store");
}

beforeEach(() => {
  state.session = STAFF;
  state.audit = [];
  state.calls = [];
  state.failAuditCreate = false;
  state.failAuditCount = false;
  state.ignoreLock = false;
  state.lockKeys = [];
  advisoryLocks.clear();
  logs.length = 0;
  seed();
});

// ------------------------------------------------------------ AC-02 / CR-03

describe("AC-02/CR-03: o cofre cifrado nunca sai nas respostas", () => {
  test("ataque que passava antes: GET /api/clients (staff) trazia credentialsEnc de todos → agora nenhum", async () => {
    const r = await read(await listRoute.GET());
    assert.equal(r.status, 200);
    assert.equal(r.json.length, 2);
    for (const c of r.json as Record<string, unknown>[]) {
      assert.ok(!("credentialsEnc" in c), "sem a chave credentialsEnc");
      assert.equal(typeof c.hasCredentials, "boolean");
    }
    assert.equal((r.json as Record<string, unknown>[]).find((c) => c.id === A)?.hasCredentials, true);
    assert.equal((r.json as Record<string, unknown>[]).find((c) => c.id === B)?.hasCredentials, false);
    assert.ok(!r.text.includes(String(state.clients[0].credentialsEnc)), "o blob não aparece no corpo");
    assertNoStore(r.headers);
  });

  test("lista usa select explícito (sem include) e não traz briefing nem telefones", async () => {
    const r = await read(await listRoute.GET());
    const call = state.calls.find((c) => c.op === "client.findMany")!.args as { select?: Record<string, unknown>; include?: unknown };
    assert.ok(call.select, "select explícito");
    assert.equal(call.include, undefined);
    for (const k of ["briefing", "phone", "whatsapp", "driveFolderId"]) assert.ok(!(k in call.select!), `sem ${k}`);
    const a = (r.json as Record<string, unknown>[]).find((c) => c.id === A)!;
    assert.ok(!("briefing" in a) && !("phone" in a));
    assert.deepEqual(a._count, { socialAccounts: 0, posts: 3 });
  });

  test("GET /api/clients/[id]: sem credentialsEnc, com hasCredentials e no-store", async () => {
    const r = await read(await itemRoute.GET(req(`/api/clients/${A}`) as never, ctx(A)));
    assert.equal(r.status, 200);
    assert.ok(!("credentialsEnc" in r.json));
    assert.equal(r.json.hasCredentials, true);
    assert.deepEqual(r.json.briefing, { products: "x" });
    assertNoStore(r.headers);
  });

  test("PATCH devolve o cadastro sem credentialsEnc", async () => {
    const r = await read(
      await itemRoute.PATCH(req(`/api/clients/${A}`, { method: "PATCH", body: JSON.stringify({ city: "São Paulo - SP" }) }) as never, ctx(A))
    );
    assert.equal(r.status, 200);
    assert.ok(!("credentialsEnc" in r.json));
    assert.equal(r.json.hasCredentials, true);
    assertNoStore(r.headers);
  });

  test("POST devolve o cliente criado sem credentialsEnc", async () => {
    const r = await read(
      await listRoute.POST(
        req("/api/clients", { method: "POST", body: JSON.stringify({ name: "ZZ QA R2 novo", email: "zzqa.r2.novo@example.com" }) }) as never
      )
    );
    assert.equal(r.status, 201);
    assert.ok(!("credentialsEnc" in r.json));
    assert.equal(r.json.hasCredentials, false);
  });
});

// ------------------------------------------------------------ AUD2-04 (URLs do cadastro)

describe("AUD2-04: endereços do cliente só https:", () => {
  const refused: [string, string, string][] = [
    ["website", "javascript:alert(1)", "O site precisa ser um endereço da web, como www.cliente.com.br."],
    ["website", "JavaScript:alert(document.cookie)", "O site precisa ser um endereço da web, como www.cliente.com.br."],
    ["website", "ftp://arquivos.example.com", "O site precisa ser um endereço da web, como www.cliente.com.br."],
    ["website", "https://usuario:senha@example.com", "O site precisa ser um endereço da web, como www.cliente.com.br."],
    ["website", "https://exemplo .com", "O site precisa ser um endereço da web, como www.cliente.com.br."],
    ["instagramUrl", "data:text/html,<script>alert(1)</script>", "O Instagram precisa ser um endereço da web, como instagram.com/cliente."],
    ["facebookUrl", "javascript:alert('fb')", "O Facebook precisa ser um endereço da web, como facebook.com/cliente."],
    ["facebookUrl", "vbscript:msgbox(1)", "O Facebook precisa ser um endereço da web, como facebook.com/cliente."],
    ["logoUrl", "javascript:alert('logo')", "A logo não tem um endereço válido. Envie a imagem de novo."],
    ["logoUrl", "data:image/png;base64,AAAA", "A logo não tem um endereço válido. Envie a imagem de novo."],
  ];
  for (const [field, value, message] of refused) {
    test(`PATCH ${field}=${value.slice(0, 24)} → 400 pt-BR no campo, nada gravado`, async () => {
      const before = JSON.stringify(state.clients);
      const r = await read(
        await itemRoute.PATCH(req(`/api/clients/${B}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }) as never, ctx(B))
      );
      assert.equal(r.status, 400);
      assert.deepEqual(r.json, { error: message, field });
      assert.equal(JSON.stringify(state.clients), before);
      assert.equal(state.calls.filter((c) => c.op === "client.update").length, 0);
    });
  }

  const normalized: [string, string, string | null][] = [
    ["website", "http://zzqa-r2.example.com", "https://zzqa-r2.example.com"],
    ["website", "www.cliente.com.br", "https://www.cliente.com.br"],
    ["website", "HTTPS://Cliente.com.br/contato", "https://Cliente.com.br/contato"],
    ["website", "//cdn.example.com/x", "https://cdn.example.com/x"],
    ["instagramUrl", "instagram.com/zzqa.r2", "https://instagram.com/zzqa.r2"],
    ["instagramUrl", "@zzqa.r2", "https://www.instagram.com/zzqa.r2"],
    ["facebookUrl", "https://facebook.com/zzqa", "https://facebook.com/zzqa"],
    ["logoUrl", "https://pub.example.r2.dev/logos/a.png", "https://pub.example.r2.dev/logos/a.png"],
    ["website", "", null],
  ];
  for (const [field, value, stored] of normalized) {
    test(`PATCH ${field}="${value}" → grava ${stored}`, async () => {
      const r = await read(
        await itemRoute.PATCH(req(`/api/clients/${B}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }) as never, ctx(B))
      );
      assert.equal(r.status, 200);
      assert.equal(state.clients.find((c) => c.id === B)![field], stored);
      assert.equal(r.json[field], stored);
    });
  }

  test("POST com site javascript: → 400 no campo, nenhum cliente criado", async () => {
    const r = await read(
      await listRoute.POST(
        req("/api/clients", {
          method: "POST",
          body: JSON.stringify({ name: "ZZ QA R2 x", email: "zzqa.r2.x@example.com", website: "javascript:alert(1)" }),
        }) as never
      )
    );
    assert.equal(r.status, 400);
    assert.deepEqual(r.json, { error: "O site precisa ser um endereço da web, como www.cliente.com.br.", field: "website" });
    assert.equal(state.clients.length, 2);
  });

  test("POST com site sem esquema → https://", async () => {
    const r = await read(
      await listRoute.POST(
        req("/api/clients", {
          method: "POST",
          body: JSON.stringify({ name: "ZZ QA R2 y", email: "zzqa.r2.y@example.com", website: "site.com.br", instagramUrl: "@zzqa" }),
        }) as never
      )
    );
    assert.equal(r.status, 201);
    assert.equal(r.json.website, "https://site.com.br");
    assert.equal(r.json.instagramUrl, "https://www.instagram.com/zzqa");
  });
});

// ------------------------------------------------------------ AC-07 excluir cliente

describe("AC-07: excluir cliente só admin, com registro", () => {
  test("ataque que passava antes: staff DELETE → 403 pt-BR e o cliente continua", async () => {
    const r = await read(await itemRoute.DELETE(req(`/api/clients/${A}`, { method: "DELETE" }) as never, ctx(A)));
    assert.equal(r.status, 403);
    assert.deepEqual(r.json, { error: ADMIN_ONLY.deleteClient });
    assert.ok(state.clients.some((c) => c.id === A));
    assert.equal(state.calls.filter((c) => c.op === "client.delete").length, 0);
    assert.equal(state.audit.length, 0);
  });

  test("sem sessão → 401", async () => {
    state.session = null;
    const r = await read(await itemRoute.DELETE(req(`/api/clients/${A}`, { method: "DELETE" }) as never, ctx(A)));
    assert.equal(r.status, 401);
    assert.ok(state.clients.some((c) => c.id === A));
  });

  test("admin → 200, cliente apagado e client.delete com nome e contagens", async () => {
    state.session = ADMIN;
    const r = await read(await itemRoute.DELETE(req(`/api/clients/${A}`, { method: "DELETE" }) as never, ctx(A)));
    assert.equal(r.status, 200);
    assert.ok(!state.clients.some((c) => c.id === A));
    assert.equal(state.audit.length, 1);
    const a = state.audit[0];
    assert.equal(a.action, "client.delete");
    assert.equal(a.actorId, uid(900));
    assert.equal(a.clientId, A);
    assert.equal(a.targetId, A);
    assert.equal(a.ip, "203.0.113.9");
    assert.deepEqual(a.meta, {
      clientName: "ZZ QA R2 Cliente A",
      posts: 3,
      publishedPosts: 2,
      schedules: 0,
      weeklyReviews: 0,
      accounts: 0,
      pendingItems: 0,
    });
  });

  test("admin: id inválido → 400; inexistente → 404 (sem registro)", async () => {
    state.session = ADMIN;
    assert.equal((await itemRoute.DELETE(req("/api/clients/x", { method: "DELETE" }) as never, ctx("abc"))).status, 400);
    assert.equal((await itemRoute.DELETE(req("/api/clients/x", { method: "DELETE" }) as never, ctx(uid(77)))).status, 404);
    assert.equal(state.audit.length, 0);
  });
});

// ------------------------------------------------------------ AC-03 / CR-04 credenciais

describe("AC-03/CR-04: revelar credenciais (staff, com registro e limite)", () => {
  const reveal = async (id = A) => read(await credRoute.GET(req(`/api/clients/${id}/credentials`) as never, ctx(id)));

  test("staff revela → 200, no-store, e credential.reveal com quem/cliente/redes (nunca login nem senha)", async () => {
    const r = await reveal();
    assert.equal(r.status, 200);
    assert.ok(r.text.includes(PASSWORD), "a equipe continua vendo (decisão do usuário)");
    assertNoStore(r.headers);
    assert.equal(state.audit.length, 1);
    const a = state.audit[0];
    assert.equal(a.action, "credential.reveal");
    assert.equal(a.actorId, uid(901));
    assert.equal(a.actorEmail, "zzqa.r2.staff@example.com");
    assert.equal(a.clientId, A);
    assert.equal(a.ip, "203.0.113.9");
    assert.deepEqual(a.meta, { clientName: "ZZ QA R2 Cliente A", networks: ["Instagram", "Facebook"], count: 2 });
    const saved = JSON.stringify(state.audit);
    assert.ok(!saved.includes(PASSWORD) && !saved.includes(LOGIN), "senha e login nunca vão para o registro");
  });

  test(`limite: ${REVEAL_LIMIT_PER_HOUR} por hora; a seguinte → 429 pt-BR com Retry-After, sem senha, aviso único na trilha`, async () => {
    for (let i = 0; i < REVEAL_LIMIT_PER_HOUR; i++) assert.equal((await reveal()).status, 200, `revelação ${i + 1}`);
    const r = await reveal();
    assert.equal(r.status, 429);
    assert.match(String(r.json.error), /^Você chegou ao limite de 30 revelações de senhas por hora\. Tente de novo em \d+ minutos?\./);
    assert.ok(Number(r.headers.get("retry-after")) >= 60);
    assert.ok(!r.text.includes(PASSWORD));
    assertNoStore(r.headers);
    const again = await reveal();
    assert.equal(again.status, 429);
    assert.equal(state.audit.filter((x) => x.action === "credential.reveal").length, REVEAL_LIMIT_PER_HOUR);
    assert.equal(state.audit.filter((x) => x.action === "credential.reveal_blocked").length, 1, "um aviso por janela");
  });

  test("o limite é por pessoa e por hora: outra staff revela; revelações de 2 h atrás não contam", async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (let i = 0; i < REVEAL_LIMIT_PER_HOUR; i++) {
      state.audit.push({
        id: uid(5000 + i), at: old, action: "credential.reveal", actorId: uid(901), actorEmail: "zzqa.r2.staff@example.com",
        targetType: "client", targetId: A, clientId: A, meta: null, ip: null,
      });
    }
    assert.equal((await reveal()).status, 200, "as antigas não contam");
    for (let i = 0; i < REVEAL_LIMIT_PER_HOUR - 1; i++) await reveal();
    assert.equal((await reveal()).status, 429);
    state.session = STAFF2;
    assert.equal((await reveal()).status, 200, "outra pessoa não é afetada");
  });

  test("gate G1: 45 pedidos SIMULTÂNEOS da mesma staff → exatamente 30×200, 15×429, 1 só reveal_blocked", async () => {
    const all = await Promise.all(Array.from({ length: 45 }, () => reveal()));
    const ok = all.filter((r) => r.status === 200);
    assert.equal(ok.length, REVEAL_LIMIT_PER_HOUR);
    assert.equal(all.filter((r) => r.status === 429).length, 45 - REVEAL_LIMIT_PER_HOUR);
    assert.equal(state.audit.filter((x) => x.action === "credential.reveal").length, REVEAL_LIMIT_PER_HOUR, "um registro por senha entregue");
    assert.equal(state.audit.filter((x) => x.action === "credential.reveal_blocked").length, 1);
    assert.ok(all.filter((r) => r.status !== 200).every((r) => !r.text.includes(PASSWORD)));
    assert.ok(state.lockKeys.every((k) => k === `credential-reveal:${uid(901)}`), "trava por pessoa");
  });

  test("controle: sem a trava, os mesmos 45 simultâneos passariam do limite (o teste pega a corrida)", async () => {
    state.ignoreLock = true;
    const all = await Promise.all(Array.from({ length: 45 }, () => reveal()));
    assert.ok(all.filter((r) => r.status === 200).length > REVEAL_LIMIT_PER_HOUR);
  });

  test("o limite é da pessoa: o histórico de outra staff não conta, nem com 35 simultâneos", async () => {
    for (let i = 0; i < REVEAL_LIMIT_PER_HOUR; i++) {
      state.audit.push({
        id: uid(6000 + i), at: new Date(), action: "credential.reveal", actorId: uid(902), actorEmail: "zzqa.r2.staff2@example.com",
        targetType: "client", targetId: A, clientId: A, meta: null, ip: null,
      });
    }
    const all = await Promise.all(Array.from({ length: 35 }, () => reveal()));
    assert.equal(all.filter((r) => r.status === 200).length, REVEAL_LIMIT_PER_HOUR);
    assert.deepEqual([...new Set(state.lockKeys)], [`credential-reveal:${uid(901)}`]);
  });

  test("falha fechada: sem gravar o registro, a senha não sai (503 pt-BR)", async () => {
    state.failAuditCreate = true;
    const r = await reveal();
    assert.equal(r.status, 503);
    assert.ok(!r.text.includes(PASSWORD));
    assert.equal(r.json.error, "Não foi possível revelar as credenciais agora. Tente de novo em instantes.");
  });

  test("falha fechada: trilha indisponível (sem a tabela) → 503 antes de decifrar", async () => {
    state.failAuditCount = true;
    const r = await reveal();
    assert.equal(r.status, 503);
    assert.ok(!r.text.includes(PASSWORD));
  });

  test("id inválido → 400; sem sessão → 401; cliente inexistente → 404 (nada registrado)", async () => {
    assert.equal((await credRoute.GET(req("/x") as never, ctx("nao-e-uuid"))).status, 400);
    assert.equal((await reveal(uid(77))).status, 404);
    state.session = null;
    assert.equal((await reveal()).status, 401);
    assert.equal(state.audit.length, 0);
  });

  test("PUT grava credential.update com as redes incluídas/alteradas/removidas — sem valores", async () => {
    const body = {
      credentials: [
        { network: "Instagram", login: LOGIN, password: "SENHA-NOVA-R2-999" }, // alterada
        { network: "LinkedIn", login: "zzqa.r2.li", password: "SENHA-LI-R2" }, // incluída
        // Facebook removido
      ],
    };
    const r = await read(
      await credRoute.PUT(req(`/api/clients/${A}/credentials`, { method: "PUT", body: JSON.stringify(body) }) as never, ctx(A))
    );
    assert.equal(r.status, 200);
    assertNoStore(r.headers);
    assert.equal(state.audit.length, 1);
    const a = state.audit[0];
    assert.equal(a.action, "credential.update");
    assert.equal(a.actorId, uid(901));
    assert.deepEqual(a.meta, {
      clientName: "ZZ QA R2 Cliente A",
      networks: ["Instagram", "LinkedIn"],
      added: ["LinkedIn"],
      removed: ["Facebook"],
      changed: ["Instagram"],
    });
    const saved = JSON.stringify(state.audit);
    for (const secret of ["SENHA-NOVA-R2-999", "SENHA-LI-R2", PASSWORD, LOGIN]) assert.ok(!saved.includes(secret), secret);
  });
});
