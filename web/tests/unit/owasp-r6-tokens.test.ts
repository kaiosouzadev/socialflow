/**
 * OWASP R6 — tokens da Meta nunca saem do sistema (CR-06/CF-10/AC-14):
 *   - POST /api/internal/tokens/refresh renova DENTRO do app: responde só contagens (nenhum
 *     token, antigo ou novo, nem o app secret na resposta, no log ou na trilha de auditoria);
 *     `client_secret` e `fb_exchange_token` vão no CORPO do POST à Meta, nunca na URL;
 *     o mesmo token (IG+FB da mesma Página) é trocado uma vez só; a conta é regravada cifrada;
 *     sem META_APP_ID/SECRET → 503 sem chamar a Meta; corpo grande/ inválido → 413/400;
 *   - as rotas que devolviam tokens decifrados (internal/accounts/[clientId] e
 *     internal/token/[id]) não existem mais;
 *   - toda rota em app/api/internal/** chama checkInternalKey (nada nasce público);
 *   - lib/meta e lib/meta-publish não põem `access_token` na URL.
 *
 * Mesma técnica dos outros testes de rota: hooks de módulo, Prisma falso em memória,
 * fetch global falso (nenhuma chamada real à Meta), criptografia real com chave de teste.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
process.env.TOKEN_ENC_KEY = "ef".repeat(32);

const KEY = "chave-interna-falsa-r6-tokens";
const APP_ID = "123456789012345";
const APP_SECRET = "segredo-do-app-FALSO-r6-tokens-0123";
const OLD_A = "EAAGzzqaR6antigoA0123456789abcdefghij";
const OLD_B = "EAAGzzqaR6antigoB0123456789abcdefghij";
const NEW_A = "EAAGzzqaR6novoA99999999999999999999999";
const NEW_B = "EAAGzzqaR6novoB99999999999999999999999";
const DAY = 86_400_000;

// ------------------------------------------------------------ banco falso

type Account = {
  id: string;
  clientId: string;
  platform: string;
  status: string;
  accessTokenEnc: string;
  tokenExpiresAt: Date | null;
};

const state = {
  accounts: [] as Account[],
  findManyWhere: [] as Record<string, unknown>[],
  audits: [] as unknown[],
};

const fakePrisma = {
  socialAccount: {
    findMany: async ({ where, take }: { where: Record<string, unknown>; take: number }) => {
      state.findManyWhere.push(where);
      const exp = where.tokenExpiresAt as { not: null; lt: Date };
      const platforms = (where.platform as { in: string[] }).in;
      return state.accounts
        .filter(
          (a) =>
            a.status === where.status &&
            platforms.includes(a.platform) &&
            a.tokenExpiresAt !== null &&
            a.tokenExpiresAt < exp.lt
        )
        .sort((x, y) => x.tokenExpiresAt!.getTime() - y.tokenExpiresAt!.getTime())
        .slice(0, take)
        .map((a) => ({ id: a.id, clientId: a.clientId, accessTokenEnc: a.accessTokenEnc }));
    },
    updateMany: async ({ where, data }: { where: { id: string; accessTokenEnc: string }; data: Partial<Account> }) => {
      const a = state.accounts.find((x) => x.id === where.id && x.accessTokenEnc === where.accessTokenEnc);
      if (!a) return { count: 0 };
      Object.assign(a, data);
      return { count: 1 };
    },
  },
};

// ------------------------------------------------------------ Meta falsa

type Call = { method: string; url: string; body: string; headers: Headers };
const meta = {
  calls: [] as Call[],
  fail: null as string | null,
};
const exchangeMap: Record<string, { access_token: string; expires_in?: number }> = {
  [OLD_A]: { access_token: NEW_A, expires_in: 60 * 86400 },
  [OLD_B]: { access_token: NEW_B },
};

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const body = init?.body ? String(init.body) : "";
  meta.calls.push({ method: init?.method ?? "GET", url, body, headers: new Headers(init?.headers) });
  if (!url.startsWith("https://graph.facebook.com/")) throw new Error(`rede real bloqueada no teste: ${url}`);
  if (meta.fail) {
    return Response.json({ error: { message: meta.fail, type: "OAuthException", code: 190 } }, { status: 400 });
  }
  const form = new URLSearchParams(body);
  const out = exchangeMap[form.get("fb_exchange_token") ?? ""];
  if (!out) return Response.json({ error: { message: "Invalid token", code: 190 } }, { status: 400 });
  return Response.json({ ...out, token_type: "bearer" });
}) as typeof fetch;

// ------------------------------------------------------------ logs

const logs: string[] = [];
console.error = (...args: unknown[]) => {
  logs.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" "));
};

// ------------------------------------------------------------ hooks de módulo

const FAKE_MODULES: Record<string, string> = {
  "next/server": "export class NextRequest extends Request {} export class NextResponse extends Response {}",
  "@/lib/prisma": "export const prisma = globalThis.__r6tok.prisma;",
  "@/lib/audit": "export const audit = async (e, o) => { globalThis.__r6tok.state.audits.push({ e, o }); };",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __r6tok: unknown }).__r6tok = { prisma: fakePrisma, state };
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

const { POST } = await import("../../src/app/api/internal/tokens/refresh/route.ts");
const { encryptToken, decryptToken } = await import("../../src/lib/crypto.ts");

// ------------------------------------------------------------ helpers

async function call(body?: unknown, opts: { key?: string | null; raw?: string } = {}) {
  const key = opts.key === undefined ? KEY : opts.key;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers["x-internal-key"] = key;
  const req = new Request("http://localhost/api/internal/tokens/refresh", {
    method: "POST",
    headers,
    body: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const res = await POST(req as never);
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as Record<string, unknown>, cache: res.headers.get("cache-control") };
}

function seed() {
  const soon = new Date(Date.now() + 2 * DAY);
  state.accounts = [
    // mesma Página: IG e FB com o MESMO token
    { id: "acc-ig", clientId: "c1", platform: "instagram", status: "active", accessTokenEnc: encryptToken(OLD_A), tokenExpiresAt: soon },
    { id: "acc-fb", clientId: "c1", platform: "facebook", status: "active", accessTokenEnc: encryptToken(OLD_A), tokenExpiresAt: soon },
    { id: "acc-b", clientId: "c2", platform: "facebook", status: "active", accessTokenEnc: encryptToken(OLD_B), tokenExpiresAt: soon },
    // token ilegível (cifrado com outra chave)
    { id: "acc-ruim", clientId: "c3", platform: "instagram", status: "active", accessTokenEnc: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", tokenExpiresAt: soon },
    // fora do escopo: vence longe, inativa, LinkedIn, sem validade
    { id: "acc-longe", clientId: "c4", platform: "instagram", status: "active", accessTokenEnc: encryptToken(OLD_B), tokenExpiresAt: new Date(Date.now() + 40 * DAY) },
    { id: "acc-inativa", clientId: "c4", platform: "facebook", status: "inactive", accessTokenEnc: encryptToken(OLD_B), tokenExpiresAt: soon },
    { id: "acc-li", clientId: "c4", platform: "linkedin", status: "active", accessTokenEnc: encryptToken(OLD_B), tokenExpiresAt: soon },
    { id: "acc-sem", clientId: "c4", platform: "instagram", status: "active", accessTokenEnc: encryptToken(OLD_B), tokenExpiresAt: null },
  ];
}

const SECRETS = [OLD_A, OLD_B, NEW_A, NEW_B, APP_SECRET];
const noSecret = (text: string, where: string) => {
  for (const s of SECRETS) assert.ok(!text.includes(s), `${where} contém segredo: ${s.slice(0, 8)}…`);
};

beforeEach(() => {
  process.env.INTERNAL_API_KEY = KEY;
  process.env.META_APP_ID = APP_ID;
  process.env.META_APP_SECRET = APP_SECRET;
  state.accounts = [];
  state.findManyWhere = [];
  state.audits = [];
  meta.calls = [];
  meta.fail = null;
  logs.length = 0;
});

// ------------------------------------------------------------ testes

describe("POST /api/internal/tokens/refresh — renova dentro do sistema", () => {
  test("renova os que vencem em até 7 dias; responde SÓ contagens; nada de token na resposta", async () => {
    seed();
    const r = await call({ days: 7 });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { checked: 4, refreshed: 3, failed: 1, skipped: 0 });
    assert.deepEqual(Object.keys(r.json).sort(), ["checked", "failed", "refreshed", "skipped"]);
    noSecret(r.text, "resposta");
    assert.equal(r.cache, "no-store");
  });

  test("client_secret e tokens vão no CORPO do POST à Meta; a URL é limpa; troca uma vez por token", async () => {
    seed();
    await call({});
    assert.equal(meta.calls.length, 2, "IG e FB da mesma Página com o mesmo token: 1 troca só");
    for (const c of meta.calls) {
      assert.equal(c.method, "POST");
      assert.equal(c.url, "https://graph.facebook.com/v21.0/oauth/access_token");
      noSecret(c.url, "URL");
      assert.equal(c.headers.get("content-type"), "application/x-www-form-urlencoded");
      const form = new URLSearchParams(c.body);
      assert.equal(form.get("grant_type"), "fb_exchange_token");
      assert.equal(form.get("client_id"), APP_ID);
      assert.equal(form.get("client_secret"), APP_SECRET);
      assert.ok([OLD_A, OLD_B].includes(form.get("fb_exchange_token") ?? ""));
    }
  });

  test("conta regravada CIFRADA com o token novo e a nova validade; fora do escopo intocado", async () => {
    seed();
    const before = new Map(state.accounts.map((a) => [a.id, { ...a }]));
    const t0 = Date.now();
    await call({ days: 7 });
    const byId = new Map(state.accounts.map((a) => [a.id, a]));
    for (const id of ["acc-ig", "acc-fb"]) {
      const a = byId.get(id)!;
      assert.ok(!a.accessTokenEnc.includes("EAAG"), "token em claro no banco");
      assert.equal(decryptToken(a.accessTokenEnc), NEW_A);
      const exp = a.tokenExpiresAt!.getTime();
      assert.ok(Math.abs(exp - (t0 + 60 * DAY)) < 10_000);
    }
    // a Meta não informou validade → token sem expiração (sai da lista dos que vencem)
    assert.equal(decryptToken(byId.get("acc-b")!.accessTokenEnc), NEW_B);
    assert.equal(byId.get("acc-b")!.tokenExpiresAt, null);
    for (const id of ["acc-ruim", "acc-longe", "acc-inativa", "acc-li", "acc-sem"]) {
      assert.deepEqual(byId.get(id), before.get(id), id);
    }
  });

  test("trilha de auditoria e log: só contagens/ids, nenhum token nem app secret", async () => {
    seed();
    meta.fail = `Error validating access token for ${OLD_A} client_secret=${APP_SECRET}`;
    const r = await call({});
    assert.equal(r.json.failed, 4);
    assert.equal(r.json.refreshed, 0);
    assert.equal(state.audits.length, 1);
    const audit = JSON.stringify(state.audits[0]);
    assert.match(audit, /tokens\.refresh/);
    noSecret(audit, "auditoria");
    noSecret(logs.join("\n"), "log");
    noSecret(r.text, "resposta");
  });

  test("nenhuma conta vencendo → contagens zeradas, sem chamar a Meta nem auditar", async () => {
    const r = await call({});
    assert.deepEqual(r.json, { checked: 0, refreshed: 0, failed: 0, skipped: 0 });
    assert.equal(meta.calls.length, 0);
    assert.equal(state.audits.length, 0);
  });

  test("sem META_APP_ID/META_APP_SECRET no servidor → 503 sem chamar a Meta e sem mexer nas contas", async () => {
    seed();
    const before = JSON.stringify(state.accounts);
    delete process.env.META_APP_ID;
    const r = await call({});
    assert.equal(r.status, 503);
    assert.equal(meta.calls.length, 0);
    assert.equal(JSON.stringify(state.accounts), before);
    assert.doesNotMatch(r.json.error as string, /META_APP/);
  });

  test("chave interna errada → 401 sem tocar no banco; sem chave configurada → 503", async () => {
    seed();
    assert.equal((await call({}, { key: "errada" })).status, 401);
    delete process.env.INTERNAL_API_KEY;
    assert.equal((await call({}, { key: "" })).status, 503);
    assert.equal(state.findManyWhere.length, 0);
    assert.equal(meta.calls.length, 0);
  });

  test("corpo: grande demais → 413; não-JSON → 400; parâmetro fora da faixa/desconhecido → 400", async () => {
    seed();
    assert.equal((await call(undefined, { raw: JSON.stringify({ days: 7, pad: "x".repeat(4096) }) })).status, 413);
    assert.equal((await call(undefined, { raw: "{days:" })).status, 400);
    assert.equal((await call({ days: 0 })).status, 400);
    assert.equal((await call({ days: 31 })).status, 400);
    assert.equal((await call({ days: 7, token: "x" })).status, 400);
    assert.equal(state.findManyWhere.length, 0);
    // sem corpo → padrão 7 dias
    assert.equal((await call()).status, 200);
  });
});

describe("superfície interna sem token decifrado", () => {
  const INTERNAL = path.join(SRC, "app", "api", "internal");

  test("as rotas que devolviam tokens decifrados não existem mais", () => {
    assert.equal(fs.existsSync(path.join(INTERNAL, "accounts", "[clientId]", "route.ts")), false);
    assert.equal(fs.existsSync(path.join(INTERNAL, "token", "[id]", "route.ts")), false);
  });

  test("toda rota em app/api/internal/** chama checkInternalKey; nenhuma devolve token decifrado", () => {
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === "route.ts") routes.push(p);
      }
    };
    walk(INTERNAL);
    assert.ok(routes.length >= 6, `rotas: ${routes.length}`);
    for (const file of routes) {
      const src = fs.readFileSync(file, "utf8");
      assert.match(src, /checkInternalKey\(req\)/, `${file} sem checkInternalKey`);
      assert.doesNotMatch(src, /decryptToken[\s\S]*Response\.json\(\{[^}]*\btoken\b/, `${file} devolve token`);
    }
  });

  test("lib/meta e lib/meta-publish não põem access_token na URL", () => {
    for (const f of ["meta.ts", "meta-publish.ts"]) {
      const src = fs.readFileSync(path.join(SRC, "lib", f), "utf8");
      assert.doesNotMatch(src, /searchParams\.set\(\s*["']access_token["']/, f);
      assert.doesNotMatch(src, /[?&]access_token=/, f);
    }
  });
});
