/**
 * OWASP R1 — login (AC-06/CF-07/CR-11), IP confiável (AC-08) e política de senha (AC-10).
 *
 * O login roda pelo `auth.ts` REAL (POST /api/auth/callback/credentials do next-auth, com CSRF)
 * sobre um Prisma falso em memória. Ataques que passavam antes e agora falham:
 *   - 5 senhas erradas de um IP travavam a dona da conta em QUALQUER IP, até com a senha certa
 *     → agora o limite é por e-mail+IP (e por IP) e só falhas contam;
 *   - password spraying (12 e-mails, mesma senha, mesmo IP) sem limite → agora 20 falhas/IP;
 *   - e-mail inexistente respondia ~15× mais rápido (sem bcrypt) → agora sempre há um bcrypt;
 *   - X-Forwarded-For com o 1º valor trocado a cada requisição furava o limite → agora só o
 *     último salto (ou o cabeçalho da Vercel) conta;
 *   - POST /api/users com senha "aaaaaaaa" → 201 → agora 400 pt-BR.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const SECRET = "r1-teste-segredo-de-login-com-32-caracteres-ou-mais";
process.env.AUTH_SECRET = SECRET;
process.env.AUTH_TRUST_HOST = "true";
delete process.env.AUTH_URL;
delete process.env.VERCEL;
delete process.env.TRUSTED_PROXY_HOPS;

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const COOKIE = "authjs.session-token";

// ------------------------------------------------------------ banco falso

type UserRow = { id: string; name: string; email: string; role: string; passwordHash: string; sessionVersion: number };
const state = { users: new Map<string, UserRow>(), audit: [] as Record<string, unknown>[] };

const fakePrisma = {
  user: {
    findUnique: async ({ where, select }: { where: { id?: string; email?: string }; select?: Record<string, boolean> }) => {
      const u = where.id ? state.users.get(where.id.toLowerCase()) : [...state.users.values()].find((x) => x.email === where.email);
      if (!u) return null;
      return select ? Object.fromEntries(Object.keys(select).map((k) => [k, (u as Record<string, unknown>)[k]])) : { ...u };
    },
    create: async ({ data, select }: { data: Record<string, unknown>; select?: Record<string, boolean> }) => {
      if ([...state.users.values()].some((u) => u.email === data.email)) {
        const e = new (g.__r1l.Prisma.PrismaClientKnownRequestError)("unique");
        (e as unknown as { code: string }).code = "P2002";
        throw e;
      }
      const u = { id: uid(500 + state.users.size), sessionVersion: 0, ...data } as UserRow;
      state.users.set(u.id, u);
      return select ? Object.fromEntries(Object.keys(select).map((k) => [k, (u as Record<string, unknown>)[k]])) : u;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const u = state.users.get(where.id.toLowerCase())!;
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === "object" && "increment" in v) (u as Record<string, unknown>)[k] = (u.sessionVersion as number) + 1;
        else (u as Record<string, unknown>)[k] = v;
      }
      return { id: u.id };
    },
    updateMany: async () => ({ count: 0 }),
  },
  auditLog: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.audit.push(data);
      return data;
    },
  },
};

class PrismaClientKnownRequestError extends Error {}
const g = globalThis as unknown as {
  __r1l: { prisma: typeof fakePrisma; headers: Headers; Prisma: { PrismaClientKnownRequestError: typeof PrismaClientKnownRequestError } };
};
g.__r1l = { prisma: fakePrisma, headers: new Headers(), Prisma: { PrismaClientKnownRequestError } };

const FAKE_MODULES: Record<string, string> = {
  "@/lib/prisma": "export const prisma = globalThis.__r1l.prisma;",
  "@/generated/prisma/client":
    "export const Prisma = { JsonNull: null, PrismaClientKnownRequestError: globalThis.__r1l.Prisma.PrismaClientKnownRequestError };",
  "next/headers":
    "export const headers = async () => globalThis.__r1l.headers; export const cookies = async () => ({ get() {}, getAll() { return []; }, set() {}, delete() {} });",
};
type ResolveHook = (specifier: string, context: unknown, nextResolve: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in FAKE_MODULES) {
      return { url: `data:text/javascript,${encodeURIComponent(FAKE_MODULES[specifier])}`, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return { url: pathToFileURL(`${path.join(SRC, specifier.slice(2))}.ts`).href, shortCircuit: true };
    }
    if (/^next\/[a-z-]+$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
    return nextResolve(specifier, context);
  },
});

const bcrypt = (await import("bcryptjs")).default;
const { encode, decode } = await import("next-auth/jwt");
const { handlers, DUMMY_PASSWORD_HASH } = await import("../../src/auth.ts");
const rl = await import("../../src/lib/rate-limit.ts");
const { checkPasswordPolicy, PASSWORD_MESSAGES } = await import("../../src/lib/password-policy.ts");
const usersRoute = await import("../../src/app/api/users/route.ts");
const ownPassword = await import("../../src/app/api/users/me/password/route.ts");
const guard = await import("../../src/lib/session-guard.ts");

// ------------------------------------------------------------ fixtures e helpers

const ANA = { id: uid(1), name: "ZZ QA R1 Ana", email: "zzqa.r1.ana@example.com", password: "Jabuticaba no quintal 7" };
const ADMIN = { id: uid(2), name: "ZZ QA R1 Admin", email: "zzqa.r1.admin@example.com", password: "Maracujá azedo na feira 9" };
const FAST = 4; // custo baixo só nas fixtures (o hash falso do login é custo 12, como as senhas reais)

function seed() {
  state.users = new Map(
    [ANA, ADMIN].map((u) => [
      u.id,
      { id: u.id, name: u.name, email: u.email, role: u === ADMIN ? "admin" : "staff", passwordHash: bcrypt.hashSync(u.password, FAST), sessionVersion: 0 },
    ])
  );
  state.audit = [];
}

/** Login pelo fluxo real do next-auth (como o signIn do navegador com redirect:false). */
async function login(email: string, password: string, ip: string, extraHeaders: Record<string, string> = {}) {
  const csrfRes = await handlers.GET(new Request("http://localhost:3000/api/auth/csrf") as never);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const csrfCookie = csrfRes.headers.getSetCookie().find((c) => c.startsWith("authjs.csrf-token="))!.split(";")[0];
  const res = await handlers.POST(
    new Request("http://localhost:3000/api/auth/callback/credentials", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-auth-return-redirect": "1",
        "x-forwarded-for": ip,
        cookie: csrfCookie,
        ...extraHeaders,
      },
      body: new URLSearchParams({ email, password, csrfToken, callbackUrl: "http://localhost:3000/" }).toString(),
    }) as never
  );
  const { url } = (await res.json()) as { url: string };
  const params = new URL(url).searchParams;
  const session = res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`) && !c.startsWith(`${COOKIE}=;`));
  return {
    ok: !params.get("error"),
    code: params.get("code"),
    jwt: session ? session.split(";")[0].slice(COOKIE.length + 1) : null,
  };
}

function useSession(jwt: string) {
  g.__r1l.headers = new Headers({ host: "localhost:3000", "x-forwarded-proto": "http", cookie: `${COOKIE}=${jwt}` });
}

async function tokenFor(u: UserRow) {
  return encode({ token: { id: u.id, sv: u.sessionVersion, loginAt: Date.now(), role: u.role }, secret: SECRET, salt: COOKIE });
}

beforeEach(() => {
  seed();
  rl.resetRateLimitsForTests();
  guard.invalidateSessionCache();
});

// ------------------------------------------------------------ política de senha

describe("política de senha (AC-10)", () => {
  const ctx = { email: "maria.silva@agencia.com.br", name: "Maria Silva" };
  for (const [pwd, why] of [
    ["aaaaaaaa", "8 caracteres (o ataque do AUD-1 §S6 criou usuária com ela)"],
    ["agencia1", "curta"],
    ["aaaaaaaaaa", "repetição"],
    ["1234567890", "sequência"],
    ["0987654321", "sequência invertida"],
    ["qwertyuiop", "fileira do teclado"],
    ["abcabcabcabc", "repetição de pedaço"],
    ["password123", "lista de comuns"],
    ["senha12345", "lista de comuns (pt-BR)"],
    ["Senha@12345", "palavra óbvia + números"],
    ["Coletivo2025!", "nome da agência + ano"],
    ["socialflow2026", "nome do sistema + ano"],
    ["abcdefghi!", "sequência + 1 símbolo"],
    ["11223344556677", "poucos caracteres distintos"],
    ["MariaSilva#77x", "contém o nome"],
    ["xx.maria.silva.xx", "contém o e-mail"],
    ["ç".repeat(37), "mais de 72 bytes"],
  ] as const) {
    test(`recusa ${JSON.stringify(pwd)} (${why})`, () => {
      const r = checkPasswordPolicy(pwd, ctx);
      assert.equal(r.ok, false);
      if (!r.ok) assert.ok(Object.values(PASSWORD_MESSAGES).includes(r.message as never), r.message);
    });
  }
  for (const pwd of ["Jabuticaba no quintal 7", "cavalo-correto-bateria-grampo", "Xk9#mQ2!vL", "rio tem 3 pontes azuis", "Ipê roxo floresce em agosto"]) {
    test(`aceita ${JSON.stringify(pwd)}`, () => assert.deepEqual(checkPasswordPolicy(pwd, ctx), { ok: true }));
  }
});

// ------------------------------------------------------------ limitador (só falhas, e-mail+IP e IP)

describe("limite de tentativas de login (puro)", () => {
  const IP = "198.51.100.7";
  const T0 = 1_800_000_000_000;

  test("4 falhas não esperam; a 5ª inicia 1 min; depois 2, 4, 8 e no máximo 15 min (progressivo e curto)", () => {
    for (let i = 0; i < 4; i++) {
      assert.equal(rl.loginFailed(IP, "x@example.com", T0 + i).lockedNow, null);
      assert.equal(rl.loginGate(IP, "x@example.com", T0 + i).blocked, false);
    }
    const fifth = rl.loginFailed(IP, "x@example.com", T0 + 10);
    assert.equal(fifth.lockedNow, "ip_email");
    assert.equal(fifth.retryAfter, 60);
    assert.equal(rl.loginGate(IP, "x@example.com", T0 + 30_000).blocked, true);
    assert.equal(rl.loginGate(IP, "x@example.com", T0 + 61_000).blocked, false);
    let t = T0 + 61_000;
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      const f = rl.loginFailed(IP, "x@example.com", t);
      waits.push(f.retryAfter);
      assert.equal(f.lockedNow, null, "só a 1ª espera vai para a trilha");
      t += f.retryAfter * 1000 + 1000;
    }
    assert.deepEqual(waits, [120, 240, 480, 900, 900]);
  });

  test("tentativa durante a espera não conta nem prolonga o bloqueio", () => {
    for (let i = 0; i < 5; i++) rl.loginFailed(IP, "y@example.com", T0);
    for (let i = 0; i < 50; i++) assert.equal(rl.loginGate(IP, "y@example.com", T0 + 1000 + i).blocked, true);
    assert.equal(rl.loginGate(IP, "y@example.com", T0 + 60_001).blocked, false);
  });

  test("login certo zera o e-mail+IP; a mesma conta de OUTRO IP nunca foi travada", () => {
    for (let i = 0; i < 5; i++) rl.loginFailed(IP, "z@example.com", T0);
    assert.equal(rl.loginGate("203.0.113.50", "z@example.com", T0 + 1).blocked, false, "dona da conta em outro IP");
    rl.loginSucceeded(IP, "z@example.com");
    assert.equal(rl.loginGate(IP, "z@example.com", T0 + 2).blocked, false);
  });

  test("por IP: 20 falhas em e-mails diferentes (spraying) → bloqueia o IP por 15 min para qualquer e-mail", () => {
    let locked: string | null = null;
    for (let i = 1; i <= 20; i++) {
      const f = rl.loginFailed(IP, `pessoa${i}@example.com`, T0 + i);
      if (f.lockedNow) locked = `${f.lockedNow}@${i}`;
    }
    assert.equal(locked, "ip@20");
    const g = rl.loginGate(IP, "outra@example.com", T0 + 100);
    assert.deepEqual([g.blocked, g.scope], [true, "ip"]);
    assert.ok(g.retryAfter > 14 * 60 && g.retryAfter <= 15 * 60);
    assert.equal(rl.loginGate("203.0.113.9", "outra@example.com", T0 + 100).blocked, false, "outro IP livre");
  });

  test("e-mail mascarado para a trilha", () => {
    assert.equal(rl.maskEmailForLog("Maria.Silva@Agencia.com.br"), "ma***@agencia.com.br");
    assert.equal(rl.maskEmailForLog("a@b.co"), "a***@b.co");
    assert.equal(rl.maskEmailForLog("sem-arroba"), "se***");
  });
});

// ------------------------------------------------------------ IP confiável (AC-08)

describe("clientIp: só cabeçalhos confiáveis", () => {
  const req = (h: Record<string, string>) => new Request("http://localhost/x", { headers: h });

  test("fora da Vercel: usa o ÚLTIMO salto do X-Forwarded-For (o 1º é forjável)", () => {
    assert.equal(rl.clientIp(req({ "x-forwarded-for": "203.0.113.1, 10.0.0.1" })), "10.0.0.1");
    assert.equal(rl.clientIp(req({ "x-forwarded-for": "203.0.113.2, 10.0.0.1" })), "10.0.0.1");
    assert.equal(rl.clientIp(req({ "x-forwarded-for": "198.51.100.4" })), "198.51.100.4");
  });

  test("fora da Vercel: x-vercel-forwarded-for é ignorado (qualquer um manda); x-real-ip só sem XFF", () => {
    assert.equal(rl.clientIp(req({ "x-vercel-forwarded-for": "1.2.3.4", "x-forwarded-for": "10.0.0.9" })), "10.0.0.9");
    assert.equal(rl.clientIp(req({ "x-real-ip": "10.0.0.8" })), "10.0.0.8");
  });

  test("TRUSTED_PROXY_HOPS=2: n-ésimo a partir do fim", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    try {
      assert.equal(rl.clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.1" })), "203.0.113.7");
    } finally {
      delete process.env.TRUSTED_PROXY_HOPS;
    }
  });

  test("na Vercel: x-vercel-forwarded-for (a plataforma sobrescreve), depois x-real-ip", () => {
    process.env.VERCEL = "1";
    try {
      assert.equal(
        rl.clientIp(req({ "x-vercel-forwarded-for": "198.51.100.10", "x-real-ip": "198.51.100.11", "x-forwarded-for": "6.6.6.6" })),
        "198.51.100.10"
      );
      assert.equal(rl.clientIp(req({ "x-real-ip": "198.51.100.11", "x-forwarded-for": "6.6.6.6" })), "198.51.100.11");
    } finally {
      delete process.env.VERCEL;
    }
  });

  test("ATAQUE AUD-1 §S4: XFF rotativo no 1º valor não fura mais o limite (antes 22×404, nunca 429)", () => {
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) {
      const ip = rl.clientIp(req({ "x-forwarded-for": `203.0.113.${i}, 10.0.0.1` }));
      codes.push(rl.enforceRateLimit(`aprovar-changes:${ip}`, 20, 60_000)?.status ?? 404);
    }
    assert.deepEqual(codes.slice(-3), [404, 429, 429]);
  });
});

// ------------------------------------------------------------ login real (next-auth)

describe("login pelo next-auth real", () => {
  test("senha certa entra; JWT leva id, versão de sessão e data do login", async () => {
    const r = await login(ANA.email, ANA.password, "198.51.100.20");
    assert.equal(r.ok, true);
    const t = await decode({ token: r.jwt!, secret: SECRET, salt: COOKIE });
    assert.equal(t?.id, ANA.id);
    assert.equal(t?.sv, 0);
    assert.ok(typeof t?.loginAt === "number" && Math.abs((t.loginAt as number) - Date.now()) < 60_000);
    assert.ok(Math.abs((t!.exp as number) * 1000 - (Date.now() + 7 * 24 * 3600 * 1000)) < 60_000, "validade de 7 dias");
  });

  test("ATAQUE trava da dona: 5 erros de um IP → aquele IP espera; a dona em OUTRO IP entra com a senha certa (antes: rate_limited em qualquer IP)", async () => {
    const attacker = "203.0.113.66";
    const codes: (string | null)[] = [];
    for (let i = 0; i < 6; i++) codes.push((await login(ANA.email, `errada-${i}`, attacker)).code);
    assert.deepEqual(codes, ["credentials", "credentials", "credentials", "credentials", "credentials", "rate_limited"]);
    // mesmo com a senha certa, o IP do atacante continua esperando (não confere a senha)
    assert.equal((await login(ANA.email, ANA.password, attacker)).code, "rate_limited");
    // a dona, do IP dela
    assert.equal((await login(ANA.email, ANA.password, "198.51.100.21")).ok, true);
    // trilha: 1 registro de bloqueio, e-mail mascarado, IP do atacante
    const blocked = state.audit.filter((a) => a.action === "auth.login_blocked");
    assert.equal(blocked.length, 1);
    assert.deepEqual(blocked[0].meta, { email: "zz***@example.com", scope: "ip_email", retryAfterSeconds: 60 });
    assert.equal(blocked[0].ip, attacker);
    assert.equal(blocked[0].actorId, null);
    assert.doesNotMatch(JSON.stringify(state.audit), /zzqa\.r1\.ana/);
  });

  test("só falhas contam: 10 logins certos seguidos não bloqueiam; um acerto zera as falhas", async () => {
    const ip = "198.51.100.30";
    for (let i = 0; i < 4; i++) assert.equal((await login(ANA.email, "errada", ip)).code, "credentials");
    assert.equal((await login(ANA.email, ANA.password, ip)).ok, true);
    for (let i = 0; i < 4; i++) assert.equal((await login(ANA.email, "errada", ip)).code, "credentials", "contador zerado");
    for (let i = 0; i < 10; i++) assert.equal((await login(ADMIN.email, ADMIN.password, "198.51.100.31")).ok, true);
  });

  test("ATAQUE spraying: mesma senha em 25 e-mails do mesmo IP → bloqueado a partir da 21ª (antes: nunca)", async () => {
    const ip = "203.0.113.77";
    const codes: (string | null)[] = [];
    for (let i = 0; i < 25; i++) codes.push((await login(`pessoa${i}@example.com`, "Primavera2026", ip)).code);
    assert.deepEqual(codes.slice(0, 20), Array(20).fill("credentials"));
    assert.deepEqual(codes.slice(20), Array(5).fill("rate_limited"));
    assert.equal(state.audit.filter((a) => a.action === "auth.login_blocked" && (a.meta as { scope: string }).scope === "ip").length, 1);
  });

  test("ATAQUE enumeração por tempo: e-mail inexistente também faz um bcrypt (hash falso custo 12)", async () => {
    assert.equal(bcrypt.getRounds(DUMMY_PASSWORD_HASH), 12);
    const real = bcrypt.compare;
    const seen: string[] = [];
    bcrypt.compare = (async (pw: string, hash: string) => {
      seen.push(hash);
      return real(pw, hash);
    }) as typeof bcrypt.compare;
    try {
      const r = await login("ninguem@example.com", "qualquer-coisa", "198.51.100.40");
      assert.equal(r.code, "credentials");
      assert.deepEqual(seen, [DUMMY_PASSWORD_HASH]);
    } finally {
      bcrypt.compare = real;
    }
  });

  test("tempo parecido com e sem conta (mediana de 3; antes ~15× de diferença)", async () => {
    state.users.get(ANA.id)!.passwordHash = bcrypt.hashSync(ANA.password, 12); // custo real
    const time = async (email: string, ip: string) => {
      const t = performance.now();
      await login(email, "errada-de-proposito", ip);
      return performance.now() - t;
    };
    const exist: number[] = [];
    const missing: number[] = [];
    for (let i = 0; i < 3; i++) {
      exist.push(await time(ANA.email, `198.51.100.${50 + i}`));
      missing.push(await time(`nao-existe-${i}@example.com`, `198.51.100.${60 + i}`));
    }
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[1];
    const ratio = med(exist) / med(missing);
    assert.ok(ratio > 0.5 && ratio < 2, `existe ${med(exist).toFixed(0)} ms × inexistente ${med(missing).toFixed(0)} ms`);
  });
});

// ------------------------------------------------------------ criar usuária e trocar a própria senha

describe("POST /api/users e POST /api/users/me/password", () => {
  async function createUser(body: unknown) {
    const res = await usersRoute.POST(
      new Request("http://localhost/api/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never
    );
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }
  async function changeOwn(body: unknown) {
    const res = await ownPassword.POST(
      new Request("http://localhost/api/users/me/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    );
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  test("ATAQUE AUD-1 §S6: criar usuária com senha 'aaaaaaaa' → 400 pt-BR (antes 201)", async () => {
    useSession(await tokenFor(state.users.get(ADMIN.id)!));
    const r = await createUser({ name: "ZZ QA R1 Nova", email: "zzqa.r1.nova@example.com", password: "aaaaaaaa", role: "staff" });
    assert.deepEqual(r, { status: 400, json: { error: PASSWORD_MESSAGES.tooShort, field: "password" } });
    assert.equal(state.users.size, 2);
  });

  test("criar com senha boa → 201 e trilha user.create (sem senha/hash)", async () => {
    useSession(await tokenFor(state.users.get(ADMIN.id)!));
    const r = await createUser({ name: "ZZ QA R1 Nova", email: "zzqa.r1.nova@example.com", password: "Pitanga madura no pé 3", role: "staff" });
    assert.equal(r.status, 201);
    const row = state.audit.find((a) => a.action === "user.create");
    assert.equal(row?.actorId, ADMIN.id);
    assert.deepEqual(row?.meta, { role: "staff", email: "zzqa.r1.nova@example.com" });
    assert.doesNotMatch(JSON.stringify(state.audit), /Pitanga|\$2[aby]\$/);
  });

  test("staff não cria usuária (403)", async () => {
    useSession(await tokenFor(state.users.get(ANA.id)!));
    assert.equal((await createUser({ name: "x", email: "zzqa.r1.x@example.com", password: "Pitanga madura no pé 3" })).status, 403);
  });

  test("trocar a própria senha: pede a atual; política; sobe a versão (cookie antigo → 401); trilha by=self", async () => {
    const jwt = await tokenFor(state.users.get(ANA.id)!);
    useSession(jwt);
    assert.equal((await changeOwn({ currentPassword: "errada", newPassword: "Caju doce de dezembro 4" })).json.field, "currentPassword");
    const weak = await changeOwn({ currentPassword: ANA.password, newPassword: "1234567890" });
    assert.deepEqual([weak.status, weak.json.field], [400, "newPassword"]);
    const ok = await changeOwn({ currentPassword: ANA.password, newPassword: "Caju doce de dezembro 4" });
    assert.deepEqual(ok, { status: 200, json: { ok: true } });
    assert.equal(state.users.get(ANA.id)!.sessionVersion, 1);
    assert.ok(bcrypt.compareSync("Caju doce de dezembro 4", state.users.get(ANA.id)!.passwordHash));
    // o mesmo cookie não vale mais
    useSession(jwt);
    assert.equal((await changeOwn({ currentPassword: "Caju doce de dezembro 4", newPassword: "Outra senha bem longa 5" })).status, 401);
    const row = state.audit.find((a) => a.action === "user.password_change");
    assert.deepEqual([row?.actorId, row?.targetId, row?.meta], [ANA.id, ANA.id, { by: "self" }]);
  });

  test("trocar a própria senha: 5 tentativas a cada 15 min (6ª → 429)", async () => {
    useSession(await tokenFor(state.users.get(ANA.id)!));
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await changeOwn({ currentPassword: `errada-${i}`, newPassword: "Caju doce de dezembro 4" })).status);
    assert.deepEqual(codes, [400, 400, 400, 400, 400, 429]);
  });

  test("sem sessão → 401", async () => {
    g.__r1l.headers = new Headers({ host: "localhost:3000", "x-forwarded-proto": "http" });
    assert.equal((await changeOwn({ currentPassword: "a", newPassword: "b" })).status, 401);
  });
});
