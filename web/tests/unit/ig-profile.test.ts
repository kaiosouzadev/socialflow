/**
 * P4-F (ADENDO 2) + P4-F2: lib/ig-profile — prévia do perfil do Instagram para "Ver como feed".
 *   - SÓ o perfil: 1 chamada à Graph e 0 a /media (a grade mostra só os planejados — P4-F2);
 *   - token SÓ no header Authorization (a URL que o fetch recebe nunca tem o token);
 *   - campos certos (e nada além deles: sem token, sem ids da conta, sem `recent`);
 *   - timeout de 3 s → cadastro; erro → cadastro (log sem token);
 *   - cache de 6 h (2ª chamada não faz fetch); falha não fica em cache além de 5 min;
 *   - sem conta / token vencido / token ilegível → cadastro sem chamar a Graph.
 *
 * Como nos outros testes de rota: hooks de módulo resolvem "@/" para os fontes e trocam
 * o Prisma por um banco falso em memória. O fetch global é falso (nenhuma rede real) e a
 * criptografia é a de verdade (lib/crypto) com uma chave de teste.
 */
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
process.env.TOKEN_ENC_KEY = "ab".repeat(32);
delete process.env.META_GRAPH_BASE_URL;
delete process.env.META_APP_SECRET;

const CLIENT_ID = "cli-p4f";
const IG_ID = "17841400000000001";
const TOKEN = "EAAG-token-FALSO-zzqa-p4f-0123456789";

// ------------------------------------------------------------ banco falso

type Row = Record<string, unknown>;
const state = {
  client: null as Row | null,
  accounts: [] as Row[],
  accountWhere: [] as Row[],
};

function pick(row: Row, select: Record<string, boolean>): Row {
  return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
}

const fakePrisma = {
  client: {
    findUnique: async ({ where, select }: { where: { id: string }; select: Record<string, boolean> }) =>
      state.client && state.client.id === where.id ? pick(state.client, select) : null,
  },
  socialAccount: {
    findFirst: async ({ where, select }: { where: Row; select: Record<string, boolean> }) => {
      state.accountWhere.push(where);
      const rows = state.accounts
        .filter((a) => a.clientId === where.clientId && a.platform === where.platform && a.status === where.status)
        .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
      return rows[0] ? pick(rows[0], select) : null;
    },
  },
};

// ------------------------------------------------------------ hooks de módulo

const FAKE_MODULES: Record<string, string> = {
  "@/lib/prisma": "export const prisma = globalThis.__p4f.prisma;",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __p4f: unknown }).__p4f = { prisma: fakePrisma };
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

const { encryptToken } = await import("../../src/lib/crypto.ts");
const lib = await import("../../src/lib/ig-profile.ts");
const {
  getInstagramProfilePreview,
  clearInstagramProfileCache,
  graphBaseUrl,
  usernameFromInstagramUrl,
  IG_CACHE_TTL_MS,
  IG_FAILURE_TTL_MS,
  IG_TIMEOUT_MS,
  IG_GRAPH_DEFAULT_BASE,
} = lib;

// ------------------------------------------------------------ Graph falsa

type Call = { url: string; headers: Record<string, string>; signal: AbortSignal | null };
let calls: Call[] = [];
type Handler = (url: URL, init: RequestInit) => Promise<Response>;
let handler: Handler;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const PROFILE = {
  id: IG_ID,
  username: "grupo.coletivo",
  name: "Grupo Coletivo",
  biography: "🎓 | Agência de Marketing para todos os negócios.\n🏆 | +1700 clientes atendidos.\n❤️ | Profissionalismo sem palavras...\nlinha 4",
  website: "https://clikbio.com.br/coletivoestudio",
  profile_picture_url: "https://cdn.example.com/perfil.jpg",
  followers_count: 583,
  follows_count: 322,
  media_count: 107,
};

function mediaList(n: number) {
  const types = ["IMAGE", "VIDEO", "CAROUSEL_ALBUM"];
  return Array.from({ length: n }, (_, i) => {
    const type = types[i % 3];
    const day = String(30 - i).padStart(2, "0");
    return {
      id: `m${i + 1}`,
      media_type: type,
      media_url: type === "VIDEO" ? `https://cdn.example.com/${i + 1}.mp4` : `https://cdn.example.com/${i + 1}.jpg`,
      ...(type === "VIDEO" ? { thumbnail_url: `https://cdn.example.com/${i + 1}-thumb.jpg` } : {}),
      timestamp: `2026-09-${day}T12:00:00+0000`,
      permalink: `https://www.instagram.com/p/zzqa${i + 1}/`,
    };
  });
}

// a Graph falsa responde /media como a de verdade: os testes provam que a lib NÃO pede
const okHandler: Handler = async (url) =>
  url.pathname.endsWith("/media") ? json({ data: mediaList(14), paging: { next: "x" } }) : json(PROFILE);

const mediaCalls = () => calls.filter((c) => new URL(c.url).pathname.endsWith("/media"));

const realFetch = globalThis.fetch;
const warnings: string[] = [];
const realWarn = console.warn;

beforeEach(() => {
  clearInstagramProfileCache();
  delete process.env.META_GRAPH_BASE_URL;
  delete process.env.META_APP_SECRET;
  calls = [];
  warnings.length = 0;
  handler = okHandler;
  state.client = {
    id: CLIENT_ID,
    name: "ZZ QA P4F Cliente",
    tradeName: null,
    logoUrl: "https://pub.example.com/logo.png",
    instagramUrl: "https://www.instagram.com/zzqa.cadastro/",
  };
  state.accounts = [
    {
      id: "acc-old",
      clientId: CLIENT_ID,
      platform: "instagram",
      status: "active",
      externalId: "ig-antigo",
      accessTokenEnc: encryptToken("token-antigo"),
      tokenExpiresAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    {
      id: "acc-1",
      clientId: CLIENT_ID,
      platform: "instagram",
      status: "active",
      externalId: IG_ID,
      accessTokenEnc: encryptToken(TOKEN),
      tokenExpiresAt: null,
      createdAt: new Date("2026-06-01T00:00:00Z"),
    },
    {
      id: "acc-fb",
      clientId: CLIENT_ID,
      platform: "facebook",
      status: "active",
      externalId: "fb-page",
      accessTokenEnc: encryptToken("token-fb"),
      tokenExpiresAt: null,
      createdAt: new Date("2026-09-01T00:00:00Z"),
    },
  ];
  state.accountWhere = [];
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push({
      url: url.toString(),
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      signal: init.signal ?? null,
    });
    return handler(url, init);
  }) as typeof fetch;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
});

const flush = () => new Promise<void>((r) => setImmediate(r));

// ------------------------------------------------------------ testes

describe("token só no header Authorization", () => {
  test("a chamada leva Bearer no header e a URL não tem o token", async () => {
    const r = await getInstagramProfilePreview(CLIENT_ID);
    assert.equal(r.source, "instagram");
    assert.equal(calls.length, 1);
    for (const c of calls) {
      assert.equal(c.headers.authorization, `Bearer ${TOKEN}`);
      assert.ok(!c.url.includes(TOKEN), "token apareceu na URL");
      assert.ok(!/access_token/i.test(c.url), "access_token na query string");
      assert.ok(c.signal instanceof AbortSignal, "sem AbortSignal (timeout)");
    }
  });

  test("com META_APP_SECRET vai só o appsecret_proof (HMAC), nunca o token", async () => {
    process.env.META_APP_SECRET = "segredo-de-teste";
    await getInstagramProfilePreview(CLIENT_ID);
    assert.equal(calls.length, 1);
    for (const c of calls) {
      const u = new URL(c.url);
      assert.match(u.searchParams.get("appsecret_proof") ?? "", /^[0-9a-f]{64}$/);
      assert.ok(!c.url.includes(TOKEN));
      assert.equal(c.headers.authorization, `Bearer ${TOKEN}`);
    }
  });

  test("o resultado não carrega token, ids da conta nem postagens", async () => {
    const r = await getInstagramProfilePreview(CLIENT_ID);
    const text = JSON.stringify(r);
    for (const proibido of [TOKEN, IG_ID, "acc-1", "permalink", "instagram.com/p/", ".mp4", "cdn.example.com/1.jpg"]) {
      assert.ok(!text.includes(proibido), `vazou ${proibido}`);
    }
    assert.ok(!("recent" in r), "o campo recent voltou");
  });
});

describe("P4-F2: sem /media", () => {
  test("com conta conectada: 1 chamada (perfil) e 0 a /media", async () => {
    const r = await getInstagramProfilePreview(CLIENT_ID);
    assert.equal(r.source, "instagram");
    assert.equal(calls.length, 1);
    assert.equal(mediaCalls().length, 0, "a lib pediu /media");
    assert.equal(new URL(calls[0].url).pathname, `/v21.0/${IG_ID}`);
  });

  test("cache, chamadas simultâneas e erro também não pedem /media", async () => {
    await Promise.all([getInstagramProfilePreview(CLIENT_ID), getInstagramProfilePreview(CLIENT_ID)]);
    await getInstagramProfilePreview(CLIENT_ID); // cache
    clearInstagramProfileCache();
    handler = async () => json({ error: { type: "OAuthException", code: 190 } }, 400);
    assert.equal((await getInstagramProfilePreview(CLIENT_ID)).source, "cadastro");
    assert.equal(calls.length, 2);
    assert.equal(mediaCalls().length, 0);
  });
});

describe("campos", () => {
  test("perfil mapeado do jeito certo (sem postagens)", async () => {
    const r = await getInstagramProfilePreview(CLIENT_ID);
    assert.deepEqual(Object.keys(r).sort(), [
      "avatarUrl", "biography", "followers", "following", "mediaCount", "name", "source", "username", "website",
    ]);
    assert.equal(r.source, "instagram");
    assert.equal(r.username, "grupo.coletivo");
    assert.equal(r.name, "Grupo Coletivo");
    assert.equal(r.biography, PROFILE.biography);
    assert.equal(r.website, "https://clikbio.com.br/coletivoestudio");
    assert.equal(r.avatarUrl, "https://cdn.example.com/perfil.jpg");
    assert.equal(r.mediaCount, 107);
    assert.equal(r.followers, 583);
    assert.equal(r.following, 322);
  });

  test("pede os campos certos à conta IG ativa mais recente", async () => {
    await getInstagramProfilePreview(CLIENT_ID);
    assert.deepEqual(state.accountWhere[0], { clientId: CLIENT_ID, platform: "instagram", status: "active" });
    assert.equal(calls.length, 1);
    const profile = new URL(calls[0].url);
    assert.equal(`${profile.origin}${profile.pathname}`, `${IG_GRAPH_DEFAULT_BASE}/${IG_ID}`);
    assert.deepEqual(profile.searchParams.get("fields")!.split(",").sort(), [
      "biography", "followers_count", "follows_count", "media_count", "name", "profile_picture_url", "username", "website",
    ]);
    assert.deepEqual([...profile.searchParams.keys()], ["fields"], "parâmetro a mais na URL");
  });

  test("site sem esquema vira https; javascript: e foto não-http são descartados", async () => {
    handler = async () =>
      json({ ...PROFILE, website: "clikbio.com.br/coletivo", profile_picture_url: "javascript:alert(1)", name: "" });
    const r = await getInstagramProfilePreview(CLIENT_ID);
    assert.equal(r.website, "https://clikbio.com.br/coletivo");
    assert.equal(r.avatarUrl, "https://pub.example.com/logo.png", "sem foto válida → logo do cadastro");
    assert.equal(r.name, "ZZ QA P4F Cliente", "sem nome no IG → nome do cadastro");
    clearInstagramProfileCache();
    handler = async () => json({ ...PROFILE, website: "javascript:alert(1)" });
    const r2 = await getInstagramProfilePreview(CLIENT_ID);
    assert.equal(r2.website, undefined);
  });

  test("META_GRAPH_BASE_URL só aceita https ou http local (stub de teste)", async () => {
    process.env.META_GRAPH_BASE_URL = "http://127.0.0.1:4599/v21.0/";
    assert.equal(graphBaseUrl(), "http://127.0.0.1:4599/v21.0");
    await getInstagramProfilePreview(CLIENT_ID);
    assert.ok(calls.every((c) => c.url.startsWith("http://127.0.0.1:4599/v21.0/")));
    process.env.META_GRAPH_BASE_URL = "http://graph.example.com/v21.0";
    assert.equal(graphBaseUrl(), IG_GRAPH_DEFAULT_BASE);
    process.env.META_GRAPH_BASE_URL = "não é url";
    assert.equal(graphBaseUrl(), IG_GRAPH_DEFAULT_BASE);
  });
});

describe("falhas → cadastro", () => {
  const CADASTRO = {
    source: "cadastro",
    username: "zzqa.cadastro",
    name: "ZZ QA P4F Cliente",
    avatarUrl: "https://pub.example.com/logo.png",
  };

  test("timeout de 3 s → cadastro, sem esperar mais", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let fetched!: () => void;
    const started = new Promise<void>((r) => (fetched = r));
    handler = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        fetched();
      });
    const p = getInstagramProfilePreview(CLIENT_ID);
    await started;
    let settled = false;
    void p.then(() => (settled = true));
    t.mock.timers.tick(IG_TIMEOUT_MS - 1);
    await flush();
    assert.equal(settled, false, "resolveu antes dos 3 s");
    t.mock.timers.tick(1);
    const r = await p;
    assert.equal(IG_TIMEOUT_MS, 3000);
    assert.deepEqual(r, CADASTRO);
    assert.equal(calls.length, 1);
    assert.equal(mediaCalls().length, 0);
    assert.ok(calls.every((c) => c.signal?.aborted), "fetch não foi abortado");
    assert.match(warnings.join("\n"), /timeout/);
  });

  test("erro da Graph → cadastro sem contadores nem bio; log sem token", async () => {
    // a Graph às vezes ecoa dados da chamada na mensagem: o log não pode repetir
    handler = async () =>
      json({ error: { message: `Invalid OAuth access token - ${TOKEN}`, type: "OAuthException", code: 190 } }, 400);
    const r = await getInstagramProfilePreview(CLIENT_ID);
    assert.deepEqual(r, CADASTRO);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /HTTP 400 \(OAuthException 190\)/);
    assert.ok(!warnings[0].includes(TOKEN), "token no log");
    assert.ok(!warnings[0].includes("graph.facebook.com"), "URL no log");
  });

  test("rede caiu / JSON sem username → cadastro", async () => {
    handler = async () => {
      throw new TypeError(`fetch failed ${TOKEN}`);
    };
    assert.deepEqual(await getInstagramProfilePreview(CLIENT_ID), CADASTRO);
    assert.ok(!warnings.join("\n").includes(TOKEN));
    clearInstagramProfileCache();
    handler = async () => json({ id: IG_ID });
    assert.deepEqual(await getInstagramProfilePreview(CLIENT_ID), CADASTRO);
  });

  test("sem conta IG ativa → cadastro, sem chamar a Graph", async () => {
    state.accounts = state.accounts.map((a) => (a.platform === "instagram" ? { ...a, status: "inactive" } : a));
    const r = await getInstagramProfilePreview(CLIENT_ID);
    assert.deepEqual(r, CADASTRO);
    assert.equal(calls.length, 0);
    assert.ok(!("mediaCount" in r) && !("followers" in r) && !("biography" in r));
  });

  test("token vencido ou ilegível → cadastro, sem chamar a Graph", async () => {
    state.accounts = [{ ...state.accounts[1], tokenExpiresAt: new Date(Date.now() - 1000) }];
    assert.deepEqual(await getInstagramProfilePreview(CLIENT_ID), CADASTRO);
    state.accounts = [{ ...state.accounts[0], tokenExpiresAt: null, accessTokenEnc: "isto-nao-decifra" }];
    assert.deepEqual(await getInstagramProfilePreview(CLIENT_ID), CADASTRO);
    assert.equal(calls.length, 0);
  });

  test("cadastro: nome fantasia, @ do instagramUrl e sem logo", async () => {
    state.accounts = [];
    state.client = { ...state.client!, tradeName: "ZZ QA Fantasia", logoUrl: null, instagramUrl: null };
    assert.deepEqual(await getInstagramProfilePreview(CLIENT_ID), {
      source: "cadastro",
      username: null,
      name: "ZZ QA Fantasia",
    });
  });

  test("@ do cadastro: URL, @usuario, usuario e lixo", () => {
    assert.equal(usernameFromInstagramUrl("https://www.instagram.com/grupo.coletivo/"), "grupo.coletivo");
    assert.equal(usernameFromInstagramUrl("instagram.com/grupo.coletivo?igsh=abc"), "grupo.coletivo");
    assert.equal(usernameFromInstagramUrl("@grupo.coletivo"), "grupo.coletivo");
    assert.equal(usernameFromInstagramUrl(" grupo_coletivo "), "grupo_coletivo");
    assert.equal(usernameFromInstagramUrl("https://www.instagram.com/p/abc123/"), null);
    assert.equal(usernameFromInstagramUrl("https://facebook.com/grupo"), null);
    assert.equal(usernameFromInstagramUrl(""), null);
    assert.equal(usernameFromInstagramUrl(null), null);
  });
});

describe("cache", () => {
  test("2ª chamada dentro de 6 h não faz fetch; depois de 6 h busca de novo", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-02T12:00:00Z") });
    const r1 = await getInstagramProfilePreview(CLIENT_ID);
    assert.equal(calls.length, 1);
    t.mock.timers.tick(IG_CACHE_TTL_MS - 1);
    const r2 = await getInstagramProfilePreview(CLIENT_ID);
    assert.equal(calls.length, 1, "a 2ª chamada fez fetch");
    assert.deepEqual(r2, r1);
    t.mock.timers.tick(2);
    await getInstagramProfilePreview(CLIENT_ID);
    assert.equal(calls.length, 2);
  });

  test("chamadas simultâneas dividem uma só busca", async () => {
    const [a, b, c] = await Promise.all([
      getInstagramProfilePreview(CLIENT_ID),
      getInstagramProfilePreview(CLIENT_ID),
      getInstagramProfilePreview(CLIENT_ID),
    ]);
    assert.equal(calls.length, 1);
    assert.deepEqual(a, b);
    assert.deepEqual(b, c);
  });

  test("falha fica no cache só até 5 min; depois tenta de novo", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-02T12:00:00Z") });
    handler = async () => json({ error: { type: "OAuthException", code: 2 } }, 500);
    assert.equal((await getInstagramProfilePreview(CLIENT_ID)).source, "cadastro");
    assert.equal(calls.length, 1);
    handler = okHandler; // a Graph voltou
    t.mock.timers.tick(IG_FAILURE_TTL_MS - 1);
    assert.equal((await getInstagramProfilePreview(CLIENT_ID)).source, "cadastro");
    assert.equal(calls.length, 1, "falha não deveria refazer a busca antes de 5 min");
    t.mock.timers.tick(2);
    assert.equal((await getInstagramProfilePreview(CLIENT_ID)).source, "instagram");
    assert.equal(calls.length, 2);
    assert.ok(IG_FAILURE_TTL_MS <= 5 * 60 * 1000);
  });

  test("a chave do cache é a conta, não o token", async () => {
    await getInstagramProfilePreview(CLIENT_ID);
    // outro token cifrado para a MESMA conta: continua no cache (o token não entra na chave)
    state.accounts = state.accounts.map((a) => (a.id === "acc-1" ? { ...a, accessTokenEnc: encryptToken("outro-token") } : a));
    await getInstagramProfilePreview(CLIENT_ID);
    assert.equal(calls.length, 1);
  });
});
