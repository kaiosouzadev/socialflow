/**
 * OWASP R2 — papel mínimo e trilha de auditoria nas ações de alto impacto (AC-07, AC-13, settings).
 *   - contas de publicação (POST/PATCH/DELETE /api/accounts*): só admin (staff → 403 pt-BR, banco
 *     intocado); admin → `client.account_change` com o que mudou, NUNCA o token;
 *   - ligar Página do Meta a cliente (POST /api/meta/connect) e listar Páginas de uma conexão: só
 *     admin; admin → `client.meta_link`; texto da Graph nunca chega à tela;
 *   - conectar LinkedIn (start/callback): só admin;
 *   - excluir post PUBLICADO (DELETE /api/posts/[id]): só admin + `post.delete`; staff exclui rascunho;
 *   - "Aprovar sem o cliente" (approve-internal) grava `schedule.approve_internal` com quem aprovou;
 *   - Modelos de IA: `settings.ai_model` (de → para) e `settings.openai_key` (salvou/removeu; nunca a chave).
 *
 * Técnica dos demais testes de rota: hooks de módulo trocam Prisma, a sessão (@/auth) e os módulos
 * de rede (Meta, LinkedIn) e de configuração de IA por falsos em memória. Rotas, zod, crypto e
 * lib/audit rodam de verdade.
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

type Session = { user: { id?: string; email?: string; role?: string } } | null;
type AuditRow = { action: string; actorId: string | null; actorEmail: string | null; targetId: string | null; clientId: string | null; meta: unknown };
type Account = { id: string; clientId: string; platform: string; externalId: string; accessTokenEnc: string; status: string; dailyPostLimit: number; metaConnectionId?: string | null };
type Post = { id: string; clientId: string; status: string; theme: string | null; scheduleId?: string | null };

const STAFF: Session = { user: { id: uid(901), email: "zzqa.r2.staff@example.com", role: "staff" } };
const ADMIN: Session = { user: { id: uid(900), email: "zzqa.r2.admin@example.com", role: "admin" } };
const CLIENT = uid(1);
const CONN = uid(50);
const ACC = uid(60);
const SCHEDULE = uid(70);
const TOKEN = "TOKEN-FALSO-R2-abcdef123456";
const KEY = "sk-ZZQAr2fakekeyQWERTYzxcvXy9K";

class PrismaClientKnownRequestError extends Error {
  code: string;
  constructor(message: string, opts: { code: string }) {
    super(message);
    this.code = opts.code;
  }
}

const state = {
  session: STAFF as Session,
  accounts: [] as Account[],
  posts: [] as Post[],
  schedule: null as null | { id: string; status: string; monthRef: Date; clientId: string },
  audit: [] as AuditRow[],
  dbCalls: 0,
  graphCalls: 0,
  graphFail: null as Error | null,
  textModel: { provider: "google", model: "gemini-3.7-flash" } as { provider: string; model: string | null } | null,
  keySource: null as null | "saved" | "env",
  logs: [] as string[],
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
let seq = 2000;

const accountDelegate = {
  create: async ({ data }: { data: Omit<Account, "id" | "status" | "dailyPostLimit"> & Partial<Account> }) => {
    state.dbCalls++;
    if (!same(data.clientId, CLIENT)) throw new PrismaClientKnownRequestError("FK", { code: "P2003" });
    const row: Account = { status: "active", dailyPostLimit: 25, ...data, id: uid(seq++) } as Account;
    state.accounts.push(row);
    return { ...row, client: { name: "ZZ QA R2 Cliente" } };
  },
  findUnique: async ({ where }: { where: { id: string } }) => {
    state.dbCalls++;
    const a = state.accounts.find((x) => same(x.id, where.id));
    return a ? { ...a, client: { name: "ZZ QA R2 Cliente" } } : null;
  },
  findFirst: async ({ where }: { where: { clientId: string; platform: string; externalId: string } }) => {
    state.dbCalls++;
    const a = state.accounts.find((x) => same(x.clientId, where.clientId) && x.platform === where.platform && x.externalId === where.externalId);
    return a ? { id: a.id } : null;
  },
  update: async ({ where, data }: { where: { id: string }; data: Partial<Account> }) => {
    state.dbCalls++;
    const i = state.accounts.findIndex((x) => same(x.id, where.id));
    if (i < 0) throw new PrismaClientKnownRequestError("not found", { code: "P2025" });
    state.accounts[i] = { ...state.accounts[i], ...data };
    return state.accounts[i];
  },
  delete: async ({ where }: { where: { id: string } }) => {
    state.dbCalls++;
    const i = state.accounts.findIndex((x) => same(x.id, where.id));
    if (i < 0) throw new PrismaClientKnownRequestError("not found", { code: "P2025" });
    return state.accounts.splice(i, 1)[0];
  },
};

const fakePrisma = {
  socialAccount: accountDelegate,
  client: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      state.dbCalls++;
      return same(where.id, CLIENT) ? { id: CLIENT, name: "ZZ QA R2 Cliente" } : null;
    },
  },
  metaConnection: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      state.dbCalls++;
      // token da conexão cifrado com a chave de teste
      const { encryptToken } = await import("../../src/lib/crypto.ts");
      return same(where.id, CONN) ? { accessTokenEnc: encryptToken("TOKEN-CONEXAO-R2"), status: "active" } : null;
    },
  },
  post: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      state.dbCalls++;
      const p = state.posts.find((x) => same(x.id, where.id));
      return p ? { ...p, client: { name: "ZZ QA R2 Cliente" } } : null;
    },
    deleteMany: async ({ where }: { where: { id: string; status?: { not: string } } }) => {
      state.dbCalls++;
      const before = state.posts.length;
      state.posts = state.posts.filter((p) => !(same(p.id, where.id) && (!where.status || p.status !== where.status.not)));
      return { count: before - state.posts.length };
    },
    updateMany: async () => {
      const n = state.posts.filter((p) => p.scheduleId === SCHEDULE && p.status === "draft");
      n.forEach((p) => (p.status = "scheduled"));
      return { count: n.length };
    },
  },
  schedule: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      state.dbCalls++;
      return state.schedule && same(state.schedule.id, where.id)
        ? { ...state.schedule, client: { agencyPublishes: true, name: "ZZ QA R2 Cliente" } }
        : null;
    },
    update: async ({ data }: { data: { status: string } }) => {
      state.schedule!.status = data.status;
      return state.schedule;
    },
  },
  $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  auditLog: {
    create: async ({ data }: { data: AuditRow }) => {
      state.audit.push({ action: data.action, actorId: data.actorId, actorEmail: data.actorEmail, targetId: data.targetId, clientId: data.clientId, meta: data.meta });
      return data;
    },
  },
};

// IA: o estado das configurações em memória (as rotas leem/gravam por estas funções)
const aiModels = {
  OPENAI_KEY_MISSING: "Configure a chave da OpenAI antes de usar o ChatGPT.",
  isValidModelId: (m: string) => /^[a-z0-9.-]+$/.test(m),
  normalizeModelId: (m: string) => m.trim().toLowerCase(),
  modelLabel: (m: string) => m,
  readTextModelInfo: async () => ({ available: true, setting: state.textModel, updatedAt: null, updatedByName: null, system: {} }),
  saveTextModelSetting: async (s: { provider: string; model: string | null }) => {
    state.textModel = s;
  },
};
const openaiKey = {
  getOpenAiKey: async () => (state.keySource ? KEY : null),
  encryptionReady: () => true,
  hasEnvOpenAiKey: () => false,
  readOpenAiKeyStatus: async () => ({ available: true, configured: !!state.keySource, source: state.keySource, last4: state.keySource ? KEY.slice(-4) : null }),
  saveOpenAiKey: async () => {
    state.keySource = "saved";
  },
  removeOpenAiKey: async () => {
    state.keySource = null;
  },
};

for (const level of ["error", "info", "warn", "log"] as const) {
  console[level] = (...a: unknown[]) => void state.logs.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : String(x))).join(" "));
}

const FAKE_MODULES: Record<string, string> = {
  "next/server": "export class NextRequest extends Request {} export class NextResponse extends Response {}",
  "next/headers": "export const cookies = async () => ({ get: () => undefined, delete: () => {} });",
  "@/auth": "export const auth = async () => globalThis.__r2p.state.session;",
  "@/lib/prisma": "export const prisma = globalThis.__r2p.prisma;",
  "@/generated/prisma/client": "export const Prisma = globalThis.__r2p.Prisma;",
  "@/lib/meta": `
    const g = globalThis.__r2p;
    export const getAsset = async (_t, pageId) => { g.state.graphCalls++; if (g.state.graphFail) throw g.state.graphFail;
      return pageId === "123" ? { pageId: "123", pageName: "ZZ QA R2 Página", pageAccessToken: "TOKEN-PAGINA-R2", instagramId: "17840000000000001", instagramUsername: "zzqa.r2" } : null; };
    export const listAssets = async () => { g.state.graphCalls++; return []; };`,
  "@/lib/linkedin": "export const linkedinConfigured = () => false; export const getAuthorizeUrl = () => 'x'; export const exchangeCode = async () => { throw new Error('rede'); }; export const getMember = async () => { throw new Error('rede'); };",
  "@/lib/ai-models": "const m = globalThis.__r2p.aiModels; export const { OPENAI_KEY_MISSING, isValidModelId, normalizeModelId, modelLabel, readTextModelInfo, saveTextModelSetting } = m;",
  "@/lib/openai-key": "const k = globalThis.__r2p.openaiKey; export const { getOpenAiKey, encryptionReady, hasEnvOpenAiKey, readOpenAiKeyStatus, saveOpenAiKey, removeOpenAiKey } = k;",
  "@/lib/session-user": "export const sessionUserId = async () => globalThis.__r2p.state.session?.user?.id ?? null;",
};
type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
(globalThis as unknown as { __r2p: unknown }).__r2p = {
  state,
  prisma: fakePrisma,
  Prisma: { PrismaClientKnownRequestError, JsonNull: null },
  aiModels,
  openaiKey,
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

const accountsRoute = await import("../../src/app/api/accounts/route.ts");
const accountRoute = await import("../../src/app/api/accounts/[id]/route.ts");
const metaConnect = await import("../../src/app/api/meta/connect/route.ts");
const metaAssets = await import("../../src/app/api/meta/connections/[id]/assets/route.ts");
const linkedinStart = await import("../../src/app/api/linkedin/start/route.ts");
const linkedinCallback = await import("../../src/app/api/linkedin/callback/route.ts");
const postRoute = await import("../../src/app/api/posts/[id]/route.ts");
const approveInternal = await import("../../src/app/api/schedules/[id]/approve-internal/route.ts");
const modelRoute = await import("../../src/app/api/settings/ai-model/route.ts");
const keyRoute = await import("../../src/app/api/settings/ai-model/openai-key/route.ts");
const { ADMIN_ONLY } = await import("../../src/lib/permissions.ts");
const { decryptToken } = await import("../../src/lib/crypto.ts");

type Result = { status: number; json: Record<string, unknown>; text: string };
async function read(res: Response): Promise<Result> {
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = {};
  }
  return { status: res.status, json, text };
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, method = "GET", body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }) as never;

beforeEach(() => {
  state.session = STAFF;
  state.accounts = [
    { id: ACC, clientId: CLIENT, platform: "instagram", externalId: "17840000000000009", accessTokenEnc: "x", status: "active", dailyPostLimit: 25 },
  ];
  state.posts = [];
  state.schedule = null;
  state.audit = [];
  state.dbCalls = 0;
  state.graphCalls = 0;
  state.graphFail = null;
  state.textModel = { provider: "google", model: "gemini-3.7-flash" };
  state.keySource = null;
  state.logs = [];
});

const noSecret = (...secrets: string[]) => {
  const saved = JSON.stringify(state.audit);
  for (const s of secrets) assert.ok(!saved.includes(s), `segredo no registro: ${s.slice(0, 6)}…`);
};

// ------------------------------------------------------------ contas de publicação

describe("AC-07: contas de publicação só admin, com registro (sem token)", () => {
  test("ataque que passava antes: staff POST/PATCH/DELETE → 403 pt-BR e nenhuma consulta ao banco", async () => {
    const calls = [
      await read(await accountsRoute.POST(req("/api/accounts", "POST", { clientId: CLIENT, platform: "instagram", externalId: "1", accessToken: TOKEN }))),
      await read(await accountRoute.PATCH(req(`/api/accounts/${ACC}`, "PATCH", { accessToken: TOKEN }), ctx(ACC))),
      await read(await accountRoute.DELETE(req(`/api/accounts/${ACC}`, "DELETE"), ctx(ACC))),
    ];
    for (const r of calls) {
      assert.equal(r.status, 403);
      assert.deepEqual(r.json, { error: ADMIN_ONLY.accounts });
    }
    assert.equal(state.dbCalls, 0);
    assert.equal(state.accounts.length, 1);
    assert.equal(state.accounts[0].accessTokenEnc, "x");
    assert.equal(state.audit.length, 0);
  });

  test("sem sessão → 401", async () => {
    state.session = null;
    assert.equal((await accountRoute.DELETE(req(`/api/accounts/${ACC}`, "DELETE"), ctx(ACC))).status, 401);
  });

  test("admin POST → 201, token cifrado e client.account_change {op: create} sem o token", async () => {
    state.session = ADMIN;
    const r = await read(await accountsRoute.POST(req("/api/accounts", "POST", { clientId: CLIENT, platform: "facebook", externalId: "123", accessToken: TOKEN })));
    assert.equal(r.status, 201);
    const created = state.accounts.find((a) => a.externalId === "123")!;
    assert.equal(decryptToken(created.accessTokenEnc), TOKEN);
    assert.equal(state.audit.length, 1);
    assert.equal(state.audit[0].action, "client.account_change");
    assert.equal(state.audit[0].actorId, uid(900));
    assert.equal(state.audit[0].clientId, CLIENT);
    assert.deepEqual(state.audit[0].meta, { op: "create", platform: "facebook", externalId: "123", clientName: "ZZ QA R2 Cliente" });
    noSecret(TOKEN, created.accessTokenEnc);
  });

  test("admin POST com cliente inexistente → 404 pt-BR (sem registro)", async () => {
    state.session = ADMIN;
    const r = await read(await accountsRoute.POST(req("/api/accounts", "POST", { clientId: uid(9), platform: "facebook", externalId: "1", accessToken: TOKEN })));
    assert.equal(r.status, 404);
    assert.equal(state.audit.length, 0);
  });

  test("admin PATCH (token + status + limite) → registro com de → para e tokenReplaced, sem o token", async () => {
    state.session = ADMIN;
    const r = await read(await accountRoute.PATCH(req(`/api/accounts/${ACC}`, "PATCH", { accessToken: TOKEN, status: "inactive", dailyPostLimit: 10 }), ctx(ACC)));
    assert.equal(r.status, 200);
    assert.equal(state.audit.length, 1);
    assert.deepEqual(state.audit[0].meta, {
      op: "update",
      platform: "instagram",
      externalId: "17840000000000009",
      clientName: "ZZ QA R2 Cliente",
      changes: { status: { from: "active", to: "inactive" }, dailyPostLimit: { from: 25, to: 10 }, tokenReplaced: true },
    });
    noSecret(TOKEN, state.accounts[0].accessTokenEnc);
  });

  test("admin DELETE → 200 e registro {op: delete}; id inválido → 400; inexistente → 404", async () => {
    state.session = ADMIN;
    assert.equal((await accountRoute.DELETE(req("/x", "DELETE"), ctx("abc"))).status, 400);
    assert.equal((await accountRoute.DELETE(req("/x", "DELETE"), ctx(uid(99)))).status, 404);
    const r = await read(await accountRoute.DELETE(req(`/api/accounts/${ACC}`, "DELETE"), ctx(ACC)));
    assert.equal(r.status, 200);
    assert.equal(state.accounts.length, 0);
    assert.equal(state.audit.length, 1);
    assert.deepEqual(state.audit[0].meta, { op: "delete", platform: "instagram", externalId: "17840000000000009", clientName: "ZZ QA R2 Cliente" });
  });
});

// ------------------------------------------------------------ Meta / LinkedIn

describe("AC-07: ligar Página do Meta / LinkedIn só admin", () => {
  const body = { clientId: CLIENT, connectionId: CONN, pageId: "123" };

  test("ataque que passava antes: staff POST /api/meta/connect → 403, sem banco nem Graph", async () => {
    const r = await read(await metaConnect.POST(req("/api/meta/connect", "POST", body)));
    assert.equal(r.status, 403);
    assert.deepEqual(r.json, { error: ADMIN_ONLY.metaLink });
    assert.equal(state.dbCalls + state.graphCalls, 0);
  });

  test("staff listando as Páginas de uma conexão → 403 (mesmo papel da lista de conexões)", async () => {
    const r = await read(await metaAssets.GET(req(`/api/meta/connections/${CONN}/assets`), ctx(CONN)));
    assert.equal(r.status, 403);
    assert.equal(state.graphCalls, 0);
  });

  test("admin vincula → contas criadas e client.meta_link com a Página, sem tokens", async () => {
    state.session = ADMIN;
    state.accounts = [];
    const r = await read(await metaConnect.POST(req("/api/meta/connect", "POST", body)));
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.connected, ["facebook", "instagram"]);
    assert.equal(state.audit.length, 1);
    assert.equal(state.audit[0].action, "client.meta_link");
    assert.equal(state.audit[0].clientId, CLIENT);
    assert.deepEqual(state.audit[0].meta, {
      clientName: "ZZ QA R2 Cliente",
      connectionId: CONN,
      pageId: "123",
      pageName: "ZZ QA R2 Página",
      instagramId: "17840000000000001",
      connected: ["facebook", "instagram"],
    });
    noSecret("TOKEN-PAGINA-R2", "TOKEN-CONEXAO-R2");
  });

  test("admin: falha da Graph → 502 pt-BR sem o texto da Meta (N-14), detalhe só no log", async () => {
    state.session = ADMIN;
    state.graphFail = new Error("(#190) Error validating access token: Session has expired");
    const r = await read(await metaConnect.POST(req("/api/meta/connect", "POST", body)));
    assert.equal(r.status, 502);
    assert.equal(r.json.error, "Não foi possível consultar a Página na Meta agora. Tente de novo em instantes.");
    assert.ok(state.logs.some((l) => l.includes("#190")));
    assert.equal(state.audit.length, 0);
  });

  test("LinkedIn: staff → 403 no início e no retorno do OAuth", async () => {
    const start = await read(await linkedinStart.GET(req(`/api/linkedin/start?clientId=${CLIENT}`)));
    assert.equal(start.status, 403);
    assert.deepEqual(start.json, { error: ADMIN_ONLY.linkedin });
    const cb = await read(await linkedinCallback.GET(req("/api/linkedin/callback?code=x&state=y")));
    assert.equal(cb.status, 403);
  });
});

// ------------------------------------------------------------ excluir post publicado

describe("AC-07: excluir post PUBLICADO (DELETE /api/posts/[id]) só admin", () => {
  const P = uid(301);
  const D = uid(302);
  beforeEach(() => {
    state.posts = [
      { id: P, clientId: CLIENT, status: "published", theme: "ZZ QA R2 publicado" },
      { id: D, clientId: CLIENT, status: "draft", theme: "ZZ QA R2 rascunho" },
    ];
  });

  test("ataque que passava antes: staff apaga publicado pela API → 403 pt-BR e o post fica", async () => {
    const r = await read(await postRoute.DELETE(req(`/api/posts/${P}`, "DELETE"), ctx(P)));
    assert.equal(r.status, 403);
    assert.deepEqual(r.json, { error: ADMIN_ONLY.deletePublished });
    assert.ok(state.posts.some((p) => p.id === P));
    assert.equal(state.audit.length, 0);
  });

  test("staff apaga rascunho → 200 (sem registro: não é ação restrita)", async () => {
    const r = await read(await postRoute.DELETE(req(`/api/posts/${D}`, "DELETE"), ctx(D)));
    assert.equal(r.status, 200);
    assert.ok(!state.posts.some((p) => p.id === D));
    assert.equal(state.audit.length, 0);
  });

  test("admin apaga publicado → 200 e post.delete", async () => {
    state.session = ADMIN;
    const r = await read(await postRoute.DELETE(req(`/api/posts/${P}`, "DELETE"), ctx(P)));
    assert.equal(r.status, 200);
    assert.equal(state.audit.length, 1);
    assert.equal(state.audit[0].action, "post.delete");
    assert.equal(state.audit[0].targetId, P);
    assert.deepEqual(state.audit[0].meta, { status: "published", clientName: "ZZ QA R2 Cliente", theme: "ZZ QA R2 publicado" });
  });
});

// ------------------------------------------------------------ AC-13

describe("AC-13: aprovar sem o cliente registra quem aprovou", () => {
  test("staff aprova → 200 e schedule.approve_internal com autor, mês e posts na fila", async () => {
    state.schedule = { id: SCHEDULE, status: "rascunho", monthRef: new Date("2099-02-01T00:00:00Z"), clientId: CLIENT };
    state.posts = [{ id: uid(401), clientId: CLIENT, status: "draft", theme: null, scheduleId: SCHEDULE }];
    const r = await read(await approveInternal.POST(req(`/api/schedules/${SCHEDULE}/approve-internal`, "POST"), ctx(SCHEDULE)));
    assert.equal(r.status, 200);
    assert.equal(state.audit.length, 1);
    const a = state.audit[0];
    assert.equal(a.action, "schedule.approve_internal");
    assert.equal(a.actorId, uid(901));
    assert.equal(a.actorEmail, "zzqa.r2.staff@example.com");
    assert.equal(a.targetId, SCHEDULE);
    assert.equal(a.clientId, CLIENT);
    assert.deepEqual(a.meta, { clientName: "ZZ QA R2 Cliente", monthRef: "2099-02-01", previousStatus: "rascunho", queued: 1, noPublish: false });
  });

  test("já aprovado → 409 sem registro; id inválido → 400", async () => {
    state.schedule = { id: SCHEDULE, status: "aprovado_cliente", monthRef: new Date("2099-02-01T00:00:00Z"), clientId: CLIENT };
    assert.equal((await approveInternal.POST(req("/x", "POST"), ctx(SCHEDULE))).status, 409);
    assert.equal((await approveInternal.POST(req("/x", "POST"), ctx("abc"))).status, 400);
    assert.equal(state.audit.length, 0);
  });
});

// ------------------------------------------------------------ Modelos de IA

describe("Modelos de IA: trocas registradas (nunca a chave)", () => {
  test("PUT modelo → settings.ai_model com de → para e a admin que trocou", async () => {
    state.session = ADMIN;
    const r = await read(await modelRoute.PUT(req("/api/settings/ai-model", "PUT", { provider: "google", model: "gemini-3.8-flash" })));
    assert.equal(r.status, 200);
    assert.equal(state.audit.length, 1);
    assert.equal(state.audit[0].action, "settings.ai_model");
    assert.equal(state.audit[0].actorId, uid(900));
    assert.deepEqual(state.audit[0].meta, {
      from: { provider: "google", model: "gemini-3.7-flash" },
      to: { provider: "google", model: "gemini-3.8-flash" },
    });
  });

  test("PUT padrão do sistema → para null", async () => {
    state.session = ADMIN;
    await modelRoute.PUT(req("/api/settings/ai-model", "PUT", { provider: "google", model: null }));
    assert.deepEqual((state.audit[0].meta as { to: unknown }).to, null);
  });

  test("staff → 403 e nada registrado", async () => {
    assert.equal((await modelRoute.PUT(req("/api/settings/ai-model", "PUT", { model: null }))).status, 403);
    assert.equal(state.audit.length, 0);
  });

  test("chave da OpenAI: salvar, substituir e remover → settings.openai_key sem a chave nem os 4 últimos", async () => {
    state.session = ADMIN;
    assert.equal((await keyRoute.PUT(req("/api/settings/ai-model/openai-key", "PUT", { key: KEY }))).status, 200);
    assert.equal((await keyRoute.PUT(req("/api/settings/ai-model/openai-key", "PUT", { key: KEY }))).status, 200);
    assert.equal((await keyRoute.DELETE()).status, 200);
    assert.deepEqual(
      state.audit.map((a) => [a.action, a.meta]),
      [
        ["settings.openai_key", { op: "saved" }],
        ["settings.openai_key", { op: "replaced" }],
        ["settings.openai_key", { op: "removed", modelReset: false }],
      ]
    );
    assert.ok(state.audit.every((a) => a.actorId === uid(900)));
    noSecret(KEY, KEY.slice(-4), "sk-");
  });
});
