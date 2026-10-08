/**
 * OWASP R6 — publicação idempotente e segura (POST /api/internal/publish/[postId]):
 *   - CF-06: tomada ATÔMICA do post (duas chamadas simultâneas → só uma publica, a outra 409);
 *     post fora da fila → 409 sem chamar a Graph; nova tentativa depois de falha parcial só
 *     repete a rede que falhou; tentativa morta (carimbo velho) é fechada e o post retomado;
 *   - CF-11: `daily_post_limit` da conta (últimas 24 h) e cota da Meta (content_publishing_limit)
 *     checados ANTES de publicar; excedido → não publica, post volta para `scheduled` mais tarde,
 *     sem somar tentativa, com o motivo em `last_error`;
 *   - CR-07: token SÓ no header Authorization (nenhuma URL chamada tem o token ou `access_token`);
 *     erros sem token (banco, resposta, log);
 *   - ids da Meta (conta, Página, container) só com dígitos antes de virar caminho;
 *   - rotas internas: falha fechada sem INTERNAL_API_KEY, 401 com chave errada, `no-store`.
 *
 * Técnica dos outros testes de rota: hooks de módulo resolvem "@/" para os fontes e trocam o
 * Prisma por um banco falso em memória que imita a trava de linha do Postgres (`FOR UPDATE`
 * dentro de `$transaction`) e intercala as operações (setImmediate) para expor corridas.
 * O fetch global é falso: NENHUMA chamada real à Graph.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
process.env.TOKEN_ENC_KEY = "cd".repeat(32);
process.env.INTERNAL_API_KEY = "chave-interna-falsa-r6";
process.env.META_APP_SECRET = "segredo-do-app-falso-r6";

const KEY = "chave-interna-falsa-r6";
const TOKEN = "EAAGzzqaR6tokenFALSO0123456789abcdef";
const IG_ID = "17841400000000001";
const PAGE_ID = "100000000000001";
const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const POST_ID = "00000000-0000-4000-8000-000000000001";

const tick = () => new Promise<void>((r) => setImmediate(r));
const MIN = 60_000;

// ------------------------------------------------------------ banco falso

type Row = Record<string, unknown>;
type Pub = { id: string; postId: string; platform: string; status: string; externalPostId: string | null; error: string | null; publishedAt: Date | null };

const state = {
  posts: new Map<string, Row>(),
  clients: new Map<string, { agencyPublishes: boolean }>(),
  accounts: [] as Row[],
  pubs: [] as Pub[],
  locks: new Map<string, Promise<void>>(),
  rawSql: [] as string[],
  seq: 0,
};

function cmp(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : (a as number | string);
  const y = b instanceof Date ? b.getTime() : (b as number | string);
  return x < y ? -1 : x > y ? 1 : 0;
}

function matchField(v: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== "object" || cond instanceof Date) {
    return v == null || cond == null ? v == cond : cmp(v, cond) === 0;
  }
  for (const [op, arg] of Object.entries(cond as Row)) {
    if (op === "in") {
      if (!(arg as unknown[]).some((a) => matchField(v, a))) return false;
    } else if (op === "not") {
      if (matchField(v, arg)) return false;
    } else if (op === "gt") {
      if (v == null || cmp(v, arg) <= 0) return false;
    } else if (op === "gte") {
      if (v == null || cmp(v, arg) < 0) return false;
    } else if (op === "lt") {
      if (v == null || cmp(v, arg) >= 0) return false;
    } else {
      throw new Error(`fake: operador não suportado: ${op}`);
    }
  }
  return true;
}

function matchRow(row: Row, where: Row): boolean {
  for (const [k, cond] of Object.entries(where)) {
    if (k === "post") {
      // publication → post → client → socialAccounts.some (limite por conta)
      const some = ((cond as Row).client as Row).socialAccounts as Row;
      const post = state.posts.get(row.postId as string);
      if (!post) return false;
      const filter = some.some as Row;
      if (!state.accounts.some((a) => a.clientId === post.clientId && matchRow(a, filter))) return false;
    } else if (!matchField(row[k], cond)) {
      return false;
    }
  }
  return true;
}

function apply(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && !(v instanceof Date) && "increment" in (v as Row)) {
      row[k] = (row[k] as number) + ((v as Row).increment as number);
    } else {
      row[k] = v;
    }
  }
}

async function queryRaw(strings: TemplateStringsArray, values: unknown[], held: (() => void)[] | null) {
  const sql = strings.join("$");
  state.rawSql.push(sql);
  assert.match(sql, /SELECT status FROM posts WHERE id = \$::uuid FOR UPDATE/);
  const id = values[0] as string;
  if (held) {
    // trava de linha: a próxima transação espera esta terminar
    const prev = state.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    state.locks.set(id, prev.then(() => mine));
    await prev;
    held.push(release);
  }
  await tick();
  const p = state.posts.get(id);
  return p ? [{ status: p.status }] : [];
}

const fakePrisma: Row = {
  async $transaction(fn: (tx: unknown) => Promise<unknown>) {
    const held: (() => void)[] = [];
    const tx = { ...fakePrisma, $queryRaw: (s: TemplateStringsArray, ...v: unknown[]) => queryRaw(s, v, held) };
    try {
      return await fn(tx);
    } finally {
      held.forEach((r) => r());
    }
  },
  $queryRaw: (s: TemplateStringsArray, ...v: unknown[]) => queryRaw(s, v, null),
  post: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      await tick();
      const p = state.posts.get(where.id);
      if (!p) return null;
      return { ...p, targets: [...(p.targets as string[])], client: { ...state.clients.get(p.clientId as string)! } };
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      await tick();
      const p = state.posts.get(where.id)!;
      apply(p, data);
      return p;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      await tick();
      let count = 0;
      for (const p of state.posts.values()) {
        if (matchRow(p, where)) {
          apply(p, data);
          count++;
        }
      }
      return { count };
    },
  },
  publication: {
    count: async ({ where }: { where: Row }) => {
      await tick();
      return state.pubs.filter((p) => matchRow(p, where)).length;
    },
    findMany: async ({ where }: { where: Row }) => {
      await tick();
      return state.pubs.filter((p) => matchRow(p, where)).map((p) => ({ ...p }));
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      await tick();
      let count = 0;
      for (const p of state.pubs) {
        if (matchRow(p, where)) {
          apply(p, data);
          count++;
        }
      }
      return { count };
    },
    createMany: async ({ data }: { data: Row[] }) => {
      await tick();
      for (const d of data) state.pubs.push(newPub(d));
      return { count: data.length };
    },
    create: async ({ data }: { data: Row }) => {
      await tick();
      const p = newPub(data);
      state.pubs.push(p);
      return p;
    },
    deleteMany: async ({ where }: { where: Row }) => {
      await tick();
      const before = state.pubs.length;
      state.pubs = state.pubs.filter((p) => !matchRow(p, where));
      return { count: before - state.pubs.length };
    },
    aggregate: async ({ where }: { where: Row }) => {
      await tick();
      const rows = state.pubs.filter((p) => matchRow(p, where));
      const min = rows.reduce<Date | null>((m, r) => (r.publishedAt && (!m || r.publishedAt < m) ? r.publishedAt : m), null);
      return { _count: { _all: rows.length }, _min: { publishedAt: min } };
    },
  },
  socialAccount: {
    findMany: async ({ where }: { where: Row }) => {
      await tick();
      return state.accounts.filter((a) => matchRow(a, where)).map((a) => ({ ...a }));
    },
  },
};

/**
 * Gancho de corrida (gate G1): quando a 1ª chamada grava o estado FINAL de uma rede
 * (success/failed) — fim da rede, antes de fechar o post — dispara a 2ª chamada e espera
 * até 50 ms por ela. Sem trava/tentativa viva nesse ponto, a 2ª toma o post e repete a rede.
 */
let raceHook: (() => Promise<unknown>) | null = null;
const FINAL = new Set(["success", "failed"]);
async function fireRace() {
  const hook = raceHook;
  raceHook = null;
  if (hook) await hook();
}
{
  const pub = fakePrisma.publication as Row;
  const origUpdateMany = pub.updateMany as (a: { where: Row; data: Row }) => Promise<{ count: number }>;
  const origCreate = pub.create as (a: { data: Row }) => Promise<Pub>;
  pub.updateMany = async (a: { where: Row; data: Row }) => {
    const r = await origUpdateMany(a);
    if (r.count > 0 && FINAL.has(a.data.status as string)) await fireRace();
    return r;
  };
  pub.create = async (a: { data: Row }) => {
    const r = await origCreate(a);
    if (FINAL.has(a.data.status as string)) await fireRace();
    return r;
  };
}

function newPub(d: Row): Pub {
  return {
    id: `pub-${++state.seq}`,
    postId: d.postId as string,
    platform: d.platform as string,
    status: (d.status as string) ?? "pending",
    externalPostId: (d.externalPostId as string) ?? null,
    error: (d.error as string) ?? null,
    publishedAt: (d.publishedAt as Date) ?? null,
  };
}

// ------------------------------------------------------------ Graph falsa (fetch global)

type Call = { method: string; url: URL; headers: Headers; body: string };
const graph = {
  calls: [] as Call[],
  quotaUsage: 0,
  fbError: null as string | null,
  igError: null as string | null,
  containerId: null as string | null,
  next: 1000,
  /** chamado a cada requisição (antes da resposta) */
  onCall: null as ((method: string, path: string) => void) | null,
};

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method ?? "GET";
  const headers = new Headers(init?.headers);
  const body = init?.body ? String(init.body) : "";
  graph.calls.push({ method, url, headers, body });
  await tick();
  if (url.hostname !== "graph.facebook.com") throw new Error(`rede real bloqueada no teste: ${url.href}`);
  const p = url.pathname.replace(/^\/v21\.0/, "");
  graph.onCall?.(method, p);
  const ok = (j: unknown) => Response.json(j);
  const fail = (msg: string) => Response.json({ error: { message: msg, code: 200 } }, { status: 400 });

  if (method === "GET" && p === `/${IG_ID}/content_publishing_limit`) {
    return ok({ data: [{ quota_usage: graph.quotaUsage, config: { quota_total: 50, quota_duration: 86400 } }] });
  }
  if (method === "POST" && p === `/${IG_ID}/media`) {
    if (graph.igError) return fail(graph.igError);
    return ok({ id: graph.containerId ?? String(++graph.next) });
  }
  if (method === "POST" && p === `/${IG_ID}/media_publish`) return ok({ id: `1790${++graph.next}` });
  if (method === "POST" && p === `/${PAGE_ID}/photos`) {
    if (graph.fbError) return fail(graph.fbError);
    const id = String(++graph.next);
    return ok({ id, post_id: `${PAGE_ID}_${id}` });
  }
  if (method === "GET" && /^\/\d+$/.test(p)) return ok({ status_code: "FINISHED" });
  return fail(`rota não simulada: ${method} ${p}`);
}) as typeof fetch;

const publishCalls = (platform: "instagram" | "facebook") =>
  graph.calls.filter((c) =>
    platform === "instagram" ? c.url.pathname.endsWith("/media_publish") : c.url.pathname.endsWith(`/${PAGE_ID}/photos`)
  ).length;

// ------------------------------------------------------------ logs

const logs: string[] = [];
const capture = (...args: unknown[]) => {
  logs.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" "));
};
console.error = capture;
console.warn = capture;

// ------------------------------------------------------------ hooks de módulo

const FAKE_MODULES: Record<string, string> = {
  "next/server": "export class NextRequest extends Request {} export class NextResponse extends Response {}",
  "@/lib/prisma": "export const prisma = globalThis.__r6pub.prisma;",
  "@/lib/media-thumb": "export const thumbFromUrl = async () => null;",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __r6pub: unknown }).__r6pub = { prisma: fakePrisma };
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

const { POST } = await import("../../src/app/api/internal/publish/[postId]/route.ts");
const { encryptToken } = await import("../../src/lib/crypto.ts");
const { getAsset, validateToken } = await import("../../src/lib/meta.ts");
const { INTERRUPTED_ERROR, ATTEMPT_TTL_MINUTES } = await import("../../src/lib/publish-queue.ts");

// ------------------------------------------------------------ helpers

type Res = { status: number; json: Record<string, unknown>; text: string; cache: string | null };

async function call(id = POST_ID, key: string | null = KEY): Promise<Res> {
  const headers: Record<string, string> = key === null ? {} : { "x-internal-key": key };
  const req = new Request(`http://localhost/api/internal/publish/${id}`, { method: "POST", headers });
  const res = await POST(req as never, { params: Promise.resolve({ postId: id }) });
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text) as Record<string, unknown>, text, cache: res.headers.get("cache-control") };
}

function seedPost(over: Row = {}) {
  state.posts.set(POST_ID, {
    id: POST_ID,
    clientId: CLIENT,
    status: "scheduled",
    format: "feed",
    caption: "Legenda ZZ QA OWASP-R6",
    captions: null,
    mediaUrl: "https://midia.example.com/zzqa-r6.jpg",
    mediaItems: null,
    targets: ["instagram", "facebook"],
    retryCount: 0,
    lastError: null,
    scheduledAt: new Date(Date.now() - 2 * MIN),
    mediaThumb: null,
    ...over,
  });
}

function seedAccounts(over: { ig?: Row; fb?: Row } = {}) {
  const enc = encryptToken(TOKEN);
  state.accounts = [
    { id: "acc-ig", clientId: CLIENT, platform: "instagram", externalId: IG_ID, accessTokenEnc: enc, dailyPostLimit: 25, status: "active", ...over.ig },
    { id: "acc-fb", clientId: CLIENT, platform: "facebook", externalId: PAGE_ID, accessTokenEnc: enc, dailyPostLimit: 50, status: "active", ...over.fb },
  ];
}

const post = () => state.posts.get(POST_ID)!;
const pubsOf = (id = POST_ID) => state.pubs.filter((p) => p.postId === id);

beforeEach(() => {
  state.posts.clear();
  state.clients.clear();
  state.clients.set(CLIENT, { agencyPublishes: true });
  state.pubs = [];
  state.locks.clear();
  state.rawSql = [];
  graph.calls = [];
  graph.quotaUsage = 0;
  graph.fbError = null;
  graph.igError = null;
  graph.containerId = null;
  graph.onCall = null;
  raceHook = null;
  logs.length = 0;
  process.env.INTERNAL_API_KEY = KEY;
  process.env.META_APP_SECRET = "segredo-do-app-falso-r6";
  seedAccounts();
});

// ------------------------------------------------------------ testes

describe("CR-07 · token da Graph só no header", () => {
  test("publicação IG+FB: nenhuma URL tem o token nem access_token; header Bearer; appsecret_proof ≠ token", async () => {
    seedPost();
    const r = await call();
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.ok, true);
    assert.ok(graph.calls.length >= 5, `chamadas: ${graph.calls.length}`);
    for (const c of graph.calls) {
      assert.ok(!c.url.href.includes(TOKEN), `token na URL: ${c.url.href}`);
      assert.ok(!c.url.searchParams.has("access_token"), `access_token na URL: ${c.url.href}`);
      assert.ok(!c.body.includes(TOKEN), "token no corpo");
      assert.equal(c.headers.get("authorization"), `Bearer ${TOKEN}`);
      const proof = c.url.searchParams.get("appsecret_proof");
      assert.match(proof ?? "", /^[0-9a-f]{64}$/);
    }
    assert.equal(post().status, "published");
    assert.deepEqual(pubsOf().map((p) => [p.platform, p.status]).sort(), [["facebook", "success"], ["instagram", "success"]]);
    assert.equal(r.cache, "no-store");
    assert.ok(!r.text.includes(TOKEN));
  });

  test("lib/meta (validateToken) também manda o token só no header", async () => {
    graph.calls = [];
    await validateToken(TOKEN).catch(() => null);
    assert.equal(graph.calls.length, 1);
    assert.ok(!graph.calls[0].url.href.includes(TOKEN));
    assert.equal(graph.calls[0].headers.get("authorization"), `Bearer ${TOKEN}`);
  });

  test("erro da Graph que ecoa o token: some do banco, da resposta e do log", async () => {
    seedPost({ targets: ["facebook"] });
    graph.fbError = `Invalid OAuth access token - Cannot parse access token: ${TOKEN}`;
    const r = await call();
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, false);
    assert.ok(!r.text.includes(TOKEN), r.text);
    const failed = pubsOf().find((p) => p.platform === "facebook")!;
    assert.equal(failed.status, "failed");
    assert.ok(!failed.error!.includes(TOKEN), failed.error!);
    assert.match(failed.error!, /\*\*\*/);
    assert.ok(!(post().lastError as string).includes(TOKEN));
    assert.ok(logs.every((l) => !l.includes(TOKEN)), logs.join("\n"));
  });
});

describe("CF-06 · tomada atômica e fila idempotente", () => {
  test("duas chamadas simultâneas para o mesmo post → só uma publica; a outra 409 POST_BUSY", async () => {
    seedPost();
    const [a, b] = await Promise.all([call(), call()]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const loser = a.status === 409 ? a : b;
    assert.equal(loser.json.code, "POST_BUSY");
    assert.equal(publishCalls("instagram"), 1, "IG publicado mais de uma vez");
    assert.equal(publishCalls("facebook"), 1, "FB publicado mais de uma vez");
    assert.equal(pubsOf().filter((p) => p.status === "success").length, 2);
    assert.equal(post().status, "published");
    assert.ok(state.rawSql.every((s) => /FOR UPDATE/.test(s)));
  });

  const raceWith = (box: { second?: Promise<Res> }) => async () => {
    box.second = call();
    await Promise.race([box.second, new Promise((r) => setTimeout(r, 50))]);
  };

  test("G1 corrida: 2ª chamada entre a falha da última rede e o fechamento do post → 409, a rede não é repetida", async () => {
    seedPost({ targets: ["facebook"] });
    graph.fbError = "(#200) Permissions error";
    const box: { second?: Promise<Res> } = {};
    raceHook = raceWith(box);
    const first = await call();
    assert.ok(box.second, "o gancho de corrida não disparou");
    const second = await box.second!;
    assert.equal(first.status, 200, first.text);
    assert.equal(second.status, 409, `2ª chamada tomou o post: ${second.text}`);
    assert.equal(publishCalls("facebook"), 1, "FB tentado duas vezes");
    assert.equal(pubsOf().length, 1, "duas tentativas registradas");
    assert.equal(post().status, "failed");
    assert.equal(post().retryCount, 1);
  });

  test("G1 corrida: 2ª chamada entre o sucesso da última rede e o fechamento do post → 409 (miniatura e status da 1ª)", async () => {
    seedPost({ targets: ["instagram"] });
    const box: { second?: Promise<Res> } = {};
    raceHook = raceWith(box);
    const first = await call();
    assert.ok(box.second, "o gancho de corrida não disparou");
    const second = await box.second!;
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json.ok, true);
    assert.equal(second.status, 409, `2ª chamada tomou o post: ${second.text}`);
    assert.equal(publishCalls("instagram"), 1);
    assert.equal(post().status, "published");
    assert.deepEqual(pubsOf().map((p) => p.status), ["success"]);
  });

  test("post fora da fila (rascunho, publicado, falhou) → 409 sem chamar a Graph e sem mexer no post", async () => {
    for (const status of ["draft", "published", "failed"]) {
      state.pubs = [];
      graph.calls = [];
      seedPost({ status });
      const r = await call();
      assert.equal(r.status, 409, status);
      assert.equal(r.json.code, "POST_NOT_QUEUED");
      assert.equal(graph.calls.length, 0);
      assert.equal(post().status, status);
      assert.equal(pubsOf().length, 0);
    }
  });

  test("id inválido → 400 sem tocar no banco; post inexistente → 404", async () => {
    const bad = await call("1 OR 1=1");
    assert.equal(bad.status, 400);
    assert.equal(state.rawSql.length, 0);
    const missing = await call("00000000-0000-4000-8000-000000000999");
    assert.equal(missing.status, 404);
    assert.equal(graph.calls.length, 0);
  });

  test("retry depois de falha parcial (IG ok, FB falhou) só repete o FB", async () => {
    seedPost();
    graph.fbError = "(#200) Permissions error";
    const first = await call();
    assert.equal(first.status, 200);
    assert.equal(first.json.ok, false);
    assert.equal(post().status, "failed");
    assert.equal(post().retryCount, 1);
    assert.equal(publishCalls("instagram"), 1);

    // WF-03 reagenda (failed → scheduled); a rede volta
    post().status = "scheduled";
    graph.fbError = null;
    const second = await call();
    assert.equal(second.status, 200, second.text);
    assert.equal(second.json.ok, true);
    assert.equal(publishCalls("instagram"), 1, "IG republicado no retry (post duplicado no cliente)");
    assert.equal(publishCalls("facebook"), 2, "FB não foi tentado de novo");
    const results = second.json.results as { platform: string; skipped?: boolean }[];
    assert.ok(results.some((r) => r.platform === "instagram" && r.skipped === true));
    assert.equal(post().status, "published");
    const ig = pubsOf().filter((p) => p.platform === "instagram");
    assert.deepEqual(ig.map((p) => p.status), ["success"]);
  });

  test("todas as redes já publicadas numa tentativa anterior → fecha como publicado sem chamar a Graph", async () => {
    seedPost({ status: "scheduled" });
    state.pubs.push(
      newPub({ postId: POST_ID, platform: "instagram", status: "success", publishedAt: new Date() }),
      newPub({ postId: POST_ID, platform: "facebook", status: "success", publishedAt: new Date() })
    );
    const r = await call();
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(graph.calls.length, 0);
    assert.equal(post().status, "published");
  });

  test("publishing com tentativa viva → 409 POST_BUSY, sem publicar", async () => {
    seedPost({ status: "publishing" });
    state.pubs.push(newPub({ postId: POST_ID, platform: "instagram", status: "publishing", publishedAt: new Date(Date.now() - 2 * MIN) }));
    const r = await call();
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "POST_BUSY");
    assert.equal(graph.calls.length, 0);
  });

  test("publishing sem tentativa viva (WF-01 antigo / tentativa morta) → retoma; a tentativa morta vira falha", async () => {
    seedPost({ status: "publishing", targets: ["instagram"] });
    state.pubs.push(
      newPub({ postId: POST_ID, platform: "instagram", status: "publishing", publishedAt: new Date(Date.now() - (ATTEMPT_TTL_MINUTES + 5) * MIN) })
    );
    const r = await call();
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.ok, true);
    const rows = pubsOf();
    assert.deepEqual(rows.map((p) => p.status).sort(), ["failed", "success"]);
    assert.equal(rows.find((p) => p.status === "failed")!.error, INTERRUPTED_ERROR);
    assert.equal(post().status, "published");
  });

  test("tentativa morta depois do sucesso do IG: retoma só o FB; o IG não ganha linha de falha falsa", async () => {
    seedPost({ status: "publishing" });
    const old = new Date(Date.now() - (ATTEMPT_TTL_MINUTES + 5) * MIN);
    state.pubs.push(
      newPub({ postId: POST_ID, platform: "instagram", status: "publishing", publishedAt: old }),
      newPub({ postId: POST_ID, platform: "instagram", status: "success", publishedAt: old }),
      newPub({ postId: POST_ID, platform: "facebook", status: "publishing", publishedAt: old })
    );
    const r = await call();
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.ok, true);
    assert.equal(publishCalls("instagram"), 0, "IG republicado");
    assert.equal(publishCalls("facebook"), 1);
    const ig = pubsOf().filter((p) => p.platform === "instagram").map((p) => p.status);
    const fb = pubsOf().filter((p) => p.platform === "facebook").map((p) => p.status).sort();
    assert.deepEqual(ig, ["success"]);
    assert.deepEqual(fb, ["failed", "success"]);
    assert.equal(post().status, "published");
  });

  test("durante a publicação a rede tem linha 'publishing' com o carimbo de início (base do destrava do WF-03)", async () => {
    seedPost({ targets: ["instagram"] });
    let seen: Pub | undefined;
    graph.onCall = (method, p) => {
      if (method === "POST" && p.endsWith("/media_publish")) seen = { ...state.pubs.find((x) => x.status === "publishing")! };
    };
    const t0 = Date.now();
    await call();
    assert.ok(seen, "linha de tentativa não encontrada");
    assert.equal(seen!.platform, "instagram");
    assert.ok(seen!.publishedAt!.getTime() >= t0 - 1000 && seen!.publishedAt!.getTime() <= Date.now());
  });

  test("cliente só produção → post volta para draft e 409 CLIENT_NO_PUBLISH, sem Graph", async () => {
    seedPost();
    state.clients.set(CLIENT, { agencyPublishes: false });
    const r = await call();
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "CLIENT_NO_PUBLISH");
    assert.equal(post().status, "draft");
    assert.equal(graph.calls.length, 0);
  });
});

describe("CF-11 · limite por conta antes de publicar", () => {
  function seedRecent(n: number, platform = "instagram", minutesAgo = (i: number) => 60 * (i + 1)) {
    for (let i = 0; i < n; i++) {
      const other = `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`;
      state.posts.set(other, { id: other, clientId: CLIENT, status: "published", targets: [platform] });
      state.pubs.push(newPub({ postId: other, platform, status: "success", publishedAt: new Date(Date.now() - minutesAgo(i) * MIN) }));
    }
  }

  test("daily_post_limit atingido → não publica (nem consulta a Graph), volta para scheduled sem somar tentativa", async () => {
    seedAccounts({ ig: { dailyPostLimit: 2 } });
    seedPost({ targets: ["instagram"] });
    seedRecent(2); // 1 h e 2 h atrás
    const before = Date.now();
    const r = await call();
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.ok, false);
    assert.equal(typeof r.json.deferredUntil, "string");
    assert.equal(graph.calls.length, 0);
    assert.equal(post().status, "scheduled");
    assert.equal(post().retryCount, 0);
    assert.match(post().lastError as string, /Limite diário de publicações da conta do Instagram/);
    // vaga abre quando a mais antiga (2 h atrás) sai da janela de 24 h
    const at = (post().scheduledAt as Date).getTime();
    const expected = before - 120 * MIN + 24 * 60 * MIN + MIN;
    assert.ok(Math.abs(at - expected) < 5_000, `scheduledAt ${new Date(at).toISOString()}`);
    assert.equal(pubsOf().length, 0, "não deve sobrar linha de tentativa");
  });

  test("publicações com mais de 24 h não contam; abaixo do limite publica", async () => {
    seedAccounts({ ig: { dailyPostLimit: 2 } });
    seedPost({ targets: ["instagram"] });
    seedRecent(2, "instagram", (i) => (i === 0 ? 25 * 60 : 30)); // uma fora da janela
    const r = await call();
    assert.equal(r.json.ok, true, r.text);
    assert.equal(publishCalls("instagram"), 1);
  });

  test("cota da Meta (content_publishing_limit) esgotada → não publica no IG; FB segue; post volta para a fila", async () => {
    seedPost();
    graph.quotaUsage = 50;
    const r = await call();
    assert.equal(r.status, 200, r.text);
    const quota = graph.calls.filter((c) => c.url.pathname.endsWith("/content_publishing_limit"));
    assert.equal(quota.length, 1);
    assert.equal(quota[0].method, "GET");
    assert.equal(graph.calls.filter((c) => c.url.pathname.endsWith(`/${IG_ID}/media`)).length, 0, "criou container com a cota esgotada");
    assert.equal(publishCalls("facebook"), 1);
    assert.equal(post().status, "scheduled");
    assert.equal(post().retryCount, 0);
    assert.match(post().lastError as string, /A Meta informou que a conta do Instagram atingiu o limite/);
    const results = r.json.results as { platform: string; deferred?: boolean; ok: boolean }[];
    assert.ok(results.some((x) => x.platform === "instagram" && x.deferred === true));

    // próxima tentativa (cota liberada): só o IG
    graph.quotaUsage = 3;
    const again = await call();
    assert.equal(again.json.ok, true, again.text);
    assert.equal(publishCalls("facebook"), 1, "FB republicado");
    assert.equal(publishCalls("instagram"), 1);
    assert.equal(post().status, "published");
  });

  test("a consulta da cota vem antes de qualquer publicação no IG", async () => {
    seedPost({ targets: ["instagram"] });
    await call();
    const first = graph.calls.findIndex((c) => c.url.pathname.endsWith("/content_publishing_limit"));
    const media = graph.calls.findIndex((c) => c.url.pathname.endsWith(`/${IG_ID}/media`));
    assert.ok(first >= 0 && media > first, "content_publishing_limit precisa vir antes do container");
  });
});

describe("ids da Meta só com dígitos antes de virar caminho", () => {
  test("externalId da conta com caminho/letras → falha sem chamar a Graph", async () => {
    seedAccounts({ ig: { externalId: "me/accounts" }, fb: { externalId: `${PAGE_ID}/../me` } });
    seedPost();
    const r = await call();
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, false);
    assert.equal(graph.calls.length, 0, graph.calls.map((c) => c.url.href).join("\n"));
    for (const p of pubsOf()) {
      assert.equal(p.status, "failed");
      assert.match(p.error ?? "", /Identificador inválido da Meta/);
    }
    assert.equal(post().status, "failed");
  });

  test("container devolvido pela Graph com id não numérico → não vira caminho", async () => {
    seedPost({ targets: ["instagram"] });
    graph.containerId = "123?fields=access_token";
    const r = await call();
    assert.equal(r.json.ok, false);
    assert.ok(graph.calls.every((c) => !c.url.pathname.includes("?") && !c.url.href.includes("fields=access_token")));
    assert.equal(publishCalls("instagram"), 0);
    assert.match(pubsOf()[0].error ?? "", /Identificador inválido da Meta \(mídia\)/);
  });

  test("lib/meta getAsset: pageId que não é só dígitos → null sem chamar a Graph", async () => {
    for (const bad of ["me", "1/../me", "123?fields=access_token", "", "12 34"]) {
      graph.calls = [];
      assert.equal(await getAsset(TOKEN, bad), null, bad);
      assert.equal(graph.calls.length, 0, bad);
    }
  });
});

describe("rotas internas: falha fechada, chave em tempo constante, no-store", () => {
  test("sem INTERNAL_API_KEY no servidor → 503 (nada passa), no-store, sem banco", async () => {
    delete process.env.INTERNAL_API_KEY;
    seedPost();
    const r = await call(POST_ID, "");
    assert.equal(r.status, 503);
    assert.equal(r.cache, "no-store");
    assert.equal(state.rawSql.length, 0);
    assert.doesNotMatch(r.json.error as string, /INTERNAL_API_KEY/);
  });

  test("chave errada ou ausente → 401 no-store, sem banco nem Graph", async () => {
    seedPost();
    for (const key of ["errada", null]) {
      const r = await call(POST_ID, key);
      assert.equal(r.status, 401);
      assert.equal(r.cache, "no-store");
    }
    assert.equal(state.rawSql.length, 0);
    assert.equal(graph.calls.length, 0);
    assert.equal(post().status, "scheduled");
  });
});
