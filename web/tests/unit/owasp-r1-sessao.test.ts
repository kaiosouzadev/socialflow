/**
 * OWASP R1 — ciclo de vida da sessão (AC-01/CF-05/CF-01/AC-11) e guarda da última admin (AC-04).
 *
 * Roda o `auth.ts` REAL (next-auth + @auth/core de verdade, JWT cifrado de verdade) com o
 * Prisma trocado por um banco falso em memória e o `next/headers` trocado por cabeçalhos do
 * teste (cookie da sessão). Assim `requireAuth`/`requireAdmin`, as rotas /api/users e o
 * endpoint /api/auth/session passam pelo callback `jwt` real que revalida no banco.
 *
 * Ataques que passavam antes (AUD-1 §S6, ghost.txt) e agora falham:
 *   - admin rebaixada no banco continua admin pelo cookie → agora 403 (papel vem do banco);
 *   - usuária excluída continua entrando → agora 401;
 *   - senha trocada / "Sair" não invalidavam o cookie antigo → agora 401 (session_version);
 *   - token sem versão (sessão de antes) ou login com mais de 30 dias → 401;
 *   - PATCH rebaixa a última admin (inclusive a si mesma) → agora 409; corrida → 1×200 + 1×409.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const SECRET = "r1-teste-segredo-de-sessao-com-32-caracteres-ou-mais";
process.env.AUTH_SECRET = SECRET;
process.env.AUTH_TRUST_HOST = "true";
delete process.env.AUTH_URL;
delete process.env.VERCEL;

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN_A = uid(1);
const ADMIN_B = uid(2);
const STAFF = uid(3);
const COOKIE = "authjs.session-token";
const DAY = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------ banco falso (com travas de linha)

type UserRow = { id: string; name: string; email: string; role: string; passwordHash: string; sessionVersion: number };
type AuditRow = Record<string, unknown>;

const state = {
  users: new Map<string, UserRow>(),
  audit: [] as AuditRow[],
  sql: [] as string[],
  lookups: 0,
  /** espera artificial dentro da transação (deixa as duas corridas tirarem o retrato antes) */
  txDelayMs: 0,
};

function seed() {
  state.users = new Map(
    [
      { id: ADMIN_A, name: "ZZ QA R1 Admin A", email: "zzqa.r1.a@example.com", role: "admin", passwordHash: "x", sessionVersion: 0 },
      { id: ADMIN_B, name: "ZZ QA R1 Admin B", email: "zzqa.r1.b@example.com", role: "admin", passwordHash: "x", sessionVersion: 0 },
      { id: STAFF, name: "ZZ QA R1 Staff", email: "zzqa.r1.s@example.com", role: "staff", passwordHash: "x", sessionVersion: 0 },
    ].map((u) => [u.id, u])
  );
  state.audit = [];
  state.sql = [];
  state.lookups = 0;
  state.txDelayMs = 0;
}

/** Travas por linha (FOR UPDATE): a dona é a transação; as outras esperam na fila. */
const locks = new Map<string, { owner: number; queue: (() => void)[] }>();
async function acquire(id: string, tx: number) {
  const l = locks.get(id);
  if (!l) {
    locks.set(id, { owner: tx, queue: [] });
    return;
  }
  if (l.owner === tx) return;
  await new Promise<void>((resolve) => l.queue.push(resolve));
  l.owner = tx;
}
function releaseAll(tx: number) {
  for (const [id, l] of locks) {
    if (l.owner !== tx) continue;
    const next = l.queue.shift();
    if (next) next();
    else locks.delete(id);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = (u: UserRow, select?: Record<string, boolean>) =>
  select ? Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, (u as Record<string, unknown>)[k]])) : { ...u };

function applyUpdate(u: UserRow, data: Record<string, unknown>) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "increment" in (v as object)) {
      (u as Record<string, unknown>)[k] = ((u as Record<string, unknown>)[k] as number) + (v as { increment: number }).increment;
    } else if (v !== undefined) {
      (u as Record<string, unknown>)[k] = v;
    }
  }
}

let txSeq = 0;
function makeTx(txId: number) {
  return {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?").replace(/\s+/g, " ").trim();
      state.sql.push(sql);
      assert.match(sql, /FOR UPDATE/, "leitura dentro da transação precisa travar");
      if (/role = 'admin'/.test(sql)) {
        assert.match(sql, /ORDER BY id/, "admins travadas em ordem fixa (sem deadlock)");
        const snapshot = [...state.users.values()].filter((u) => u.role === "admin").map((u) => u.id).sort();
        await sleep(state.txDelayMs);
        const out: { id: string }[] = [];
        for (const id of snapshot) {
          await acquire(id, txId);
          // READ COMMITTED: depois de esperar a trava, a linha é reavaliada contra o WHERE
          const now = state.users.get(id);
          if (now && now.role === "admin") out.push({ id });
        }
        return out;
      }
      const id = String(values[0]).toLowerCase();
      await acquire(id, txId);
      const u = state.users.get(id);
      return u ? [{ id: u.id, role: u.role, name: u.name, email: u.email }] : [];
    },
    user: {
      update: async ({ where, data, select }: { where: { id: string }; data: Record<string, unknown>; select?: Record<string, boolean> }) => {
        const u = state.users.get(where.id);
        if (!u) throw new Error("P2025");
        applyUpdate(u, data);
        return pick(u, select);
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const u = state.users.get(where.id);
        if (!u) throw new Error("P2025");
        state.users.delete(where.id);
        return u;
      },
    },
  };
}

const fakePrisma = {
  user: {
    findUnique: async ({ where, select }: { where: { id?: string; email?: string }; select?: Record<string, boolean> }) => {
      state.lookups += 1;
      const u = where.id ? state.users.get(where.id.toLowerCase()) : [...state.users.values()].find((x) => x.email === where.email);
      return u ? pick(u, select) : null;
    },
    findMany: async () => [...state.users.values()],
    create: async ({ data, select }: { data: Record<string, unknown>; select?: Record<string, boolean> }) => {
      const u = { id: uid(100 + state.users.size), sessionVersion: 0, ...data } as UserRow;
      state.users.set(u.id, u);
      return pick(u, select);
    },
    update: async ({ where, data, select }: { where: { id: string }; data: Record<string, unknown>; select?: Record<string, boolean> }) => {
      const u = state.users.get(where.id.toLowerCase());
      if (!u) throw new Error("P2025");
      applyUpdate(u, data);
      return pick(u, select);
    },
    updateMany: async ({ where, data }: { where: { id: string; sessionVersion?: number }; data: Record<string, unknown> }) => {
      const u = state.users.get(where.id.toLowerCase());
      if (!u || (where.sessionVersion !== undefined && u.sessionVersion !== where.sessionVersion)) return { count: 0 };
      applyUpdate(u, data);
      return { count: 1 };
    },
  },
  auditLog: {
    create: async ({ data }: { data: AuditRow }) => {
      state.audit.push(data);
      return data;
    },
  },
  $transaction: async <T>(fn: (tx: ReturnType<typeof makeTx>) => Promise<T>) => {
    const id = ++txSeq;
    try {
      return await fn(makeTx(id));
    } finally {
      releaseAll(id);
    }
  },
};

// ------------------------------------------------------------ hooks de módulo

const g = globalThis as unknown as { __r1s: { prisma: typeof fakePrisma; headers: Headers } };
g.__r1s = { prisma: fakePrisma, headers: new Headers() };

const FAKE_MODULES: Record<string, string> = {
  "@/lib/prisma": "export const prisma = globalThis.__r1s.prisma;",
  "@/generated/prisma/client":
    "export const Prisma = { JsonNull: null, PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {} };",
  "next/headers":
    "export const headers = async () => globalThis.__r1s.headers; export const cookies = async () => ({ get() {}, getAll() { return []; }, set() {}, delete() {} });",
};
type ResolveHook = (specifier: string, context: unknown, nextResolve: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in FAKE_MODULES) {
      return { url: `data:text/javascript,${encodeURIComponent(FAKE_MODULES[specifier])}`, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const base = path.join(SRC, specifier.slice(2));
      return { url: pathToFileURL(`${base}.ts`).href, shortCircuit: true };
    }
    // o pacote "next" não tem mapa de exports: no ESM do Node, "next/server" precisa do .js
    if (/^next\/[a-z-]+$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
    return nextResolve(specifier, context);
  },
});

const { encode, decode } = await import("next-auth/jwt");
const { handlers } = await import("../../src/auth.ts");
const { requireAuth, requireAdmin, getSessionUser } = await import("../../src/lib/api-auth.ts");
const guard = await import("../../src/lib/session-guard.ts");
const usersId = await import("../../src/app/api/users/[id]/route.ts");

// ------------------------------------------------------------ helpers

type TokenInput = { id?: string; sv?: number; loginAt?: number; role?: string; name?: string; email?: string };

async function mint(t: TokenInput, opts: { issuedAt?: number; maxAge?: number } = {}): Promise<string> {
  const realNow = Date.now;
  if (opts.issuedAt) Date.now = () => opts.issuedAt as number;
  try {
    return await encode({ token: { ...t }, secret: SECRET, salt: COOKIE, maxAge: opts.maxAge ?? guard.SESSION_MAX_AGE_S });
  } finally {
    Date.now = realNow;
  }
}

/** Token de login válido agora para a usuária (versão atual do banco). */
async function loginToken(id: string, extra: Partial<TokenInput> = {}) {
  const u = state.users.get(id);
  return mint({ id, sv: u?.sessionVersion ?? 0, loginAt: Date.now(), role: u?.role, name: u?.name, email: u?.email, ...extra });
}

function useCookie(jwt: string | null) {
  const h = new Headers({ host: "localhost:3000", "x-forwarded-proto": "http" });
  if (jwt) h.set("cookie", `${COOKIE}=${jwt}`);
  g.__r1s.headers = h;
}

async function status(r: Response | null) {
  return r === null ? null : { status: r.status, json: (await r.json()) as Record<string, unknown> };
}

async function sessionEndpoint(jwt: string) {
  const res = await handlers.GET(
    new Request("http://localhost:3000/api/auth/session", { headers: { cookie: `${COOKIE}=${jwt}` } }) as never
  );
  return { body: (await res.json()) as Record<string, unknown> | null, setCookie: res.headers.getSetCookie() };
}

async function patchUser(id: string, body: unknown) {
  const res = await usersId.PATCH(
    new Request(`http://localhost/api/users/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never,
    { params: Promise.resolve({ id }) }
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function deleteUser(id: string) {
  const res = await usersId.DELETE(new Request(`http://localhost/api/users/${id}`, { method: "DELETE" }) as never, {
    params: Promise.resolve({ id }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  seed();
  guard.invalidateSessionCache();
  useCookie(null);
});

// ------------------------------------------------------------ revalidação (AC-01/CF-05)

describe("revalidação da sessão no banco a cada requisição", () => {
  test("sessão válida: requireAuth/requireAdmin liberam; papel, nome e e-mail vêm do banco", async () => {
    useCookie(await loginToken(ADMIN_A));
    assert.equal(await requireAuth(), null);
    assert.equal(await requireAdmin(), null);
    const me = await getSessionUser();
    assert.deepEqual(me, { id: ADMIN_A, role: "admin", name: "ZZ QA R1 Admin A", email: "zzqa.r1.a@example.com" });
  });

  test("sem cookie → 401 pt-BR", async () => {
    assert.deepEqual(await status(await requireAuth()), { status: 401, json: { error: "Sua sessão expirou. Entre de novo." } });
  });

  test("ATAQUE admin rebaixada direto no banco (cookie diz admin): requireAdmin → 403 (antes 200)", async () => {
    useCookie(await loginToken(ADMIN_A));
    assert.equal(await requireAdmin(), null);
    state.users.get(ADMIN_A)!.role = "staff"; // como o UPDATE do AUD-4 (sem passar pela API)
    guard.invalidateSessionCache(ADMIN_A); // (sem invalidar, vale no máximo SESSION_CACHE_TTL_MS)
    assert.equal((await status(await requireAdmin()))?.status, 403);
    assert.equal((await getSessionUser())?.role, "staff");
  });

  test("ATAQUE usuária excluída (cookie antigo) → 401 em requireAuth e /api/auth/session devolve null e apaga o cookie (antes 200 e renovava)", async () => {
    const jwt = await loginToken(STAFF);
    useCookie(jwt);
    assert.equal(await requireAuth(), null);
    state.users.delete(STAFF);
    guard.invalidateSessionCache(STAFF);
    assert.equal((await status(await requireAuth()))?.status, 401);
    const s = await sessionEndpoint(jwt);
    assert.equal(s.body, null);
    assert.ok(s.setCookie.some((c) => c.startsWith(`${COOKIE}=;`) || /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)), "cookie apagado");
  });

  test("ATAQUE versão de sessão antiga (senha/papel trocados fora desta instância) → 401", async () => {
    useCookie(await loginToken(STAFF));
    state.users.get(STAFF)!.sessionVersion = 1;
    guard.invalidateSessionCache(STAFF);
    assert.equal((await status(await requireAuth()))?.status, 401);
  });

  test("token de antes desta versão (sem sv/loginAt) → 401: todas entram de novo uma vez", async () => {
    useCookie(await mint({ id: STAFF, role: "staff" }));
    assert.equal((await status(await requireAuth()))?.status, 401);
    useCookie(await mint({ id: STAFF, sv: 0, role: "staff" }));
    assert.equal((await status(await requireAuth()))?.status, 401);
  });

  test("sessão sem id (ou objeto que não é sessão) → 401 (CF-01: identidade, não '!!session')", async () => {
    useCookie(await mint({ sv: 0, loginAt: Date.now(), role: "admin" }));
    assert.equal((await status(await requireAdmin()))?.status, 401);
    useCookie(await mint({ id: "nao-e-uuid", sv: 0, loginAt: Date.now(), role: "admin" }));
    assert.equal((await status(await requireAdmin()))?.status, 401);
  });

  test("teto absoluto: login há 29 dias ainda vale; há 31 dias → 401 mesmo com o cookie renovado", async () => {
    useCookie(await loginToken(STAFF, { loginAt: Date.now() - 29 * DAY }));
    assert.equal(await requireAuth(), null);
    useCookie(await loginToken(STAFF, { loginAt: Date.now() - 31 * DAY }));
    assert.equal((await status(await requireAuth()))?.status, 401);
  });

  test("validade de 7 dias renovada com o uso: cookie regravado com Expires ≈ agora + 7 dias e JWT com exp novo", async () => {
    const jwt = await loginToken(STAFF);
    const s = await sessionEndpoint(jwt);
    assert.equal((s.body?.user as Record<string, unknown>).id, STAFF);
    const set = s.setCookie.find((c) => c.startsWith(`${COOKIE}=`));
    assert.ok(set, "cookie de sessão regravado");
    const expires = Date.parse(/Expires=([^;]+)/i.exec(set!)![1]);
    assert.ok(Math.abs(expires - (Date.now() + 7 * DAY)) < 60_000, `Expires ${new Date(expires).toISOString()}`);
    const renewed = await decode({ token: set!.split(";")[0].slice(COOKIE.length + 1), secret: SECRET, salt: COOKIE });
    assert.ok(renewed && Math.abs((renewed.exp as number) * 1000 - (Date.now() + 7 * DAY)) < 60_000);
    // o teto continua contando do login original (loginAt preservado na renovação)
    assert.equal(typeof renewed?.loginAt, "number");
  });

  test("JWT emitido há 8 dias sem uso (exp vencido) → 401", async () => {
    const jwt = await mint(
      { id: STAFF, sv: 0, loginAt: Date.now() - 8 * DAY, role: "staff" },
      { issuedAt: Date.now() - 8 * DAY }
    );
    useCookie(jwt);
    assert.equal((await status(await requireAuth()))?.status, 401);
  });

  test("cache curto: mudança direta no banco vale em ≤ SESSION_CACHE_TTL_MS; leituras seguidas não vão ao banco", async () => {
    assert.ok(guard.SESSION_CACHE_TTL_MS <= 30_000);
    useCookie(await loginToken(STAFF));
    await requireAuth();
    const before = state.lookups;
    await requireAuth();
    await requireAuth();
    assert.equal(state.lookups, before, "usou o cache");
    state.users.get(STAFF)!.sessionVersion = 5; // mudança sem passar pela API (outra instância)
    const realNow = Date.now;
    Date.now = () => realNow() + guard.SESSION_CACHE_TTL_MS + 1;
    try {
      assert.equal((await status(await requireAuth()))?.status, 401);
    } finally {
      Date.now = realNow;
    }
  });
});

// ------------------------------------------------------------ logout (evento signOut)

describe("Sair invalida o cookie antigo", () => {
  test("ATAQUE: depois do signout, o MESMO valor do cookie → 401 (antes 200)", async () => {
    const jwt = await loginToken(STAFF);
    useCookie(jwt);
    assert.equal(await requireAuth(), null);

    // fluxo real do Auth.js: GET /csrf → POST /signout com o token CSRF
    const csrfRes = await handlers.GET(new Request("http://localhost:3000/api/auth/csrf") as never);
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
    const csrfCookie = csrfRes.headers.getSetCookie().find((c) => c.startsWith("authjs.csrf-token="))!.split(";")[0];
    const out = await handlers.POST(
      new Request("http://localhost:3000/api/auth/signout", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${csrfCookie}; ${COOKIE}=${jwt}` },
        body: new URLSearchParams({ csrfToken }).toString(),
      }) as never
    );
    assert.ok(out.status === 302 || out.status === 200, `signout ${out.status}`);
    assert.equal(state.users.get(STAFF)!.sessionVersion, 1, "versão subiu");

    useCookie(jwt); // cookie copiado antes de sair
    assert.equal((await status(await requireAuth()))?.status, 401);
  });

  test("um cookie VELHO saindo não derruba a sessão atual (só sobe se a versão confere)", async () => {
    const old = await loginToken(STAFF, { sv: 0 });
    state.users.get(STAFF)!.sessionVersion = 3;
    guard.invalidateSessionCache(STAFF);
    await guard.signOutEvent({ token: await decode({ token: old, secret: SECRET, salt: COOKIE }) });
    assert.equal(state.users.get(STAFF)!.sessionVersion, 3);
  });
});

// ------------------------------------------------------------ /api/users: papel, senha, exclusão

describe("PATCH/DELETE /api/users: sessão da afetada cai na hora + trilha", () => {
  test("ATAQUE rebaixar pela API: a sessão da rebaixada perde o admin na hora (antes 200 com cookie antigo)", async () => {
    const victimJwt = await loginToken(ADMIN_B);
    useCookie(await loginToken(ADMIN_A));
    const r = await patchUser(ADMIN_B, { role: "staff" });
    assert.equal(r.status, 200);
    assert.equal(state.users.get(ADMIN_B)!.sessionVersion, 1);
    useCookie(victimJwt);
    assert.equal((await status(await requireAdmin()))?.status, 401, "cookie antigo da rebaixada não vale mais");
    const row = state.audit.find((a) => a.action === "user.role_change");
    assert.deepEqual(
      { actorId: row?.actorId, targetId: row?.targetId, meta: row?.meta },
      { actorId: ADMIN_A, targetId: ADMIN_B, meta: { from: "admin", to: "staff" } }
    );
  });

  test("troca de senha pela admin: cookie antigo da staff → 401; trilha user.password_change sem a senha", async () => {
    const staffJwt = await loginToken(STAFF);
    useCookie(await loginToken(ADMIN_A));
    const r = await patchUser(STAFF, { password: "Ipê roxo floresce em agosto" });
    assert.equal(r.status, 200);
    useCookie(staffJwt);
    assert.equal((await status(await requireAuth()))?.status, 401);
    const row = state.audit.find((a) => a.action === "user.password_change");
    assert.deepEqual(row?.meta, { by: "admin" });
    assert.doesNotMatch(JSON.stringify(state.audit), /Ipê roxo|\$2[aby]\$/);
  });

  test("só o nome muda: sessão continua valendo (sem subir a versão)", async () => {
    const staffJwt = await loginToken(STAFF);
    useCookie(await loginToken(ADMIN_A));
    assert.equal((await patchUser(STAFF, { name: "ZZ QA R1 Staff 2" })).status, 200);
    assert.equal(state.users.get(STAFF)!.sessionVersion, 0);
    useCookie(staffJwt);
    assert.equal(await requireAuth(), null);
    assert.equal((await getSessionUser())?.name, "ZZ QA R1 Staff 2");
  });

  test("política de senha no PATCH: 'aaaaaaaaaa' → 400 pt-BR no campo senha; nada muda", async () => {
    useCookie(await loginToken(ADMIN_A));
    const r = await patchUser(STAFF, { password: "aaaaaaaaaa" });
    assert.equal(r.status, 400);
    assert.equal(r.json.field, "password");
    assert.equal(typeof r.json.error, "string");
    assert.equal(state.users.get(STAFF)!.sessionVersion, 0);
  });

  test("exclusão: cookie da excluída → 401 na hora; trilha user.delete", async () => {
    const staffJwt = await loginToken(STAFF);
    useCookie(await loginToken(ADMIN_A));
    assert.equal((await deleteUser(STAFF)).status, 200);
    useCookie(staffJwt);
    assert.equal((await status(await requireAuth()))?.status, 401);
    const row = state.audit.find((a) => a.action === "user.delete");
    assert.equal(row?.targetId, STAFF);
    assert.equal((row?.meta as Record<string, unknown>).role, "staff");
  });

  test("id inválido → 404 pt-BR (antes 500)", async () => {
    useCookie(await loginToken(ADMIN_A));
    assert.equal((await patchUser("x", { name: "a" })).status, 404);
    assert.equal((await deleteUser("x")).status, 404);
  });

  test("staff não gerencia usuários (403) e rebaixada no meio do caminho também não", async () => {
    useCookie(await loginToken(STAFF));
    assert.equal((await patchUser(ADMIN_A, { role: "staff" })).status, 403);
    assert.equal(state.users.get(ADMIN_A)!.role, "admin");
  });
});

// ------------------------------------------------------------ última admin (AC-04)

describe("guarda da última admin (409), inclusive a si mesma e com corrida", () => {
  test("ATAQUE auto-rebaixamento da ÚNICA admin → 409 (antes 200)", async () => {
    state.users.get(ADMIN_B)!.role = "staff";
    useCookie(await loginToken(ADMIN_A));
    const r = await patchUser(ADMIN_A, { role: "staff" });
    assert.equal(r.status, 409);
    assert.equal(typeof r.json.error, "string");
    assert.match(r.json.error as string, /administrador/);
    assert.equal(state.users.get(ADMIN_A)!.role, "admin");
  });

  test("auto-rebaixamento com outra admin → 200 e a própria sessão cai (entra de novo)", async () => {
    const jwt = await loginToken(ADMIN_A);
    useCookie(jwt);
    assert.equal((await patchUser(ADMIN_A, { role: "staff" })).status, 200);
    assert.equal((await status(await requireAdmin()))?.status, 401);
  });

  test("excluir a última admin → 409", async () => {
    state.users.get(ADMIN_B)!.role = "staff";
    useCookie(await loginToken(ADMIN_B, { role: "staff" }));
    // a B era admin quando entrou; agora é staff → 403 antes de qualquer coisa
    assert.equal((await deleteUser(ADMIN_A)).status, 403);
    state.users.get(ADMIN_B)!.role = "admin";
    state.users.get(ADMIN_B)!.sessionVersion = 0;
    guard.invalidateSessionCache();
    useCookie(await loginToken(ADMIN_B));
    // há duas admins: excluir a A pode
    assert.equal((await deleteUser(ADMIN_A)).status, 200);
    // agora a B é a única: o rebaixamento dela é recusado; excluir a si mesma continua 400
    assert.equal((await patchUser(ADMIN_B, { role: "staff" })).status, 409);
    assert.equal((await deleteUser(ADMIN_B)).status, 400);
  });

  test("ATAQUE corrida: A rebaixa B e B rebaixa A AO MESMO TEMPO → exatamente 1×200 e 1×409; sobra 1 admin", async () => {
    state.txDelayMs = 20; // as duas tiram o "retrato" das admins antes de qualquer uma gravar
    const jwtA = await loginToken(ADMIN_A);
    const jwtB = await loginToken(ADMIN_B);
    // cada chamada lê o cookie na hora (síncrono) — cada uma com a sua sessão
    useCookie(jwtA);
    const p1 = patchUser(ADMIN_B, { role: "staff" });
    useCookie(jwtB);
    const p2 = patchUser(ADMIN_A, { role: "staff" });
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409], JSON.stringify([r1, r2]));
    assert.equal([...state.users.values()].filter((u) => u.role === "admin").length, 1);
  });

  test("ATAQUE corrida: A exclui B e B exclui A ao mesmo tempo → 1×200 e 1×409 (antes as duas saíam: 0 admins)", async () => {
    state.txDelayMs = 20;
    const jwtA = await loginToken(ADMIN_A);
    const jwtB = await loginToken(ADMIN_B);
    useCookie(jwtA);
    const p1 = deleteUser(ADMIN_B);
    useCookie(jwtB);
    const p2 = deleteUser(ADMIN_A);
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409], JSON.stringify([r1, r2]));
    assert.equal([...state.users.values()].filter((u) => u.role === "admin").length, 1);
  });

  test("ordem das travas: admins (ORDER BY id) antes da alvo, tudo FOR UPDATE", async () => {
    useCookie(await loginToken(ADMIN_A));
    await patchUser(ADMIN_B, { role: "staff" });
    assert.match(state.sql[0], /WHERE role = 'admin' ORDER BY id FOR UPDATE/);
    assert.match(state.sql[1], /WHERE id = \?::uuid FOR UPDATE/);
  });
});
