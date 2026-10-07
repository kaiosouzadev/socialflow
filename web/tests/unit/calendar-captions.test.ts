/**
 * F9-CAL-LEGENDAS: legendas do calendário geradas em segundo plano.
 *   1. POST /api/ai/calendar/captions (lotes da revisão): 401/400/404 em pt-BR (N-14), 200 com o
 *      briefing do cliente no prompt e as hashtags fixas no fim de toda legenda; story recebe
 *      legenda e nunca slides; carrossel/reels recebem slides; falha da IA → 502 pt-BR.
 *   2. POST /api/ai/calendar/commit: grava as legendas/slides que a revisão já trouxe e agenda
 *      com `after()` a geração SÓ dos posts que chegaram sem legenda (com título); o `after()`
 *      grava só onde a legenda continua vazia (não sobrescreve quem preencheu no meio-tempo),
 *      copia a legenda do post para o story "junto" e, se a IA falhar, só registra no log.
 *
 * Técnica do api-respostas-ptbr.test.ts: hooks de módulo resolvem "@/" para os fontes e trocam
 * Prisma, a sessão (@/auth), o Drive e o "next/server" (com um `after` que só guarda o callback)
 * por versões falsas. lib/gemini, lib/caption-batch, lib/client-hashtags e
 * lib/client-briefing-prompt rodam de verdade sobre um `fetch` falso — nenhuma rede real.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const CLIENT_ID = "99999999-9999-4999-8999-999999999999";
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

process.env.GEMINI_API_KEY = "chave-falsa-do-teste";

// ------------------------------------------------------------ banco, sessão e IA falsos

type Row = {
  id: string;
  clientId: string;
  scheduleId: string;
  theme: string | null;
  explanation: string | null;
  caption: string | null;
  captions: unknown;
  slides: unknown;
  format: string;
  targets: string[];
  scheduledAt: Date;
};
type Session = { user: { role?: string } } | null;

const ANY_NULL = { __anyNull: true };

const state = {
  session: { user: { role: "staff" } } as Session,
  client: null as null | { name: string; toneOfVoice: string | null; briefing: unknown },
  posts: [] as Row[],
  afterCalls: [] as (() => unknown)[],
  prompts: [] as string[],
  /** resposta da IA por chamada: recebe os ids do prompt e devolve o JSON (ou lança/status) */
  ai: null as null | ((ids: string[], prompt: string) => unknown),
  aiStatus: 200,
  /** a IA "pendura" até o pedido ser cancelado (prova do repasse do abort) */
  aiHang: false,
  aiSignals: [] as (AbortSignal | null | undefined)[],
  updates: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
  /** prisma.post.update (só o lote semanal usa; o after() nunca) */
  plainUpdates: [] as { where: { id: string }; data: Record<string, unknown> }[],
};

let seq = 100;
const pick = (row: Row, select?: Record<string, boolean>) => {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(select)) out[k] = (row as Record<string, unknown>)[k];
  return out;
};

/** `where` do updateMany do after(): só id + "continua vazio" (captions/slides AnyNull, caption nulo/""). */
function matchesUpdate(row: Row, where: Record<string, unknown>): boolean {
  for (const k of Object.keys(where)) assert.ok(["id", "captions", "slides", "OR"].includes(k), `where inesperado: ${k}`);
  if (row.id !== where.id) return false;
  for (const field of ["captions", "slides"] as const) {
    if (where[field] === undefined) continue;
    assert.deepEqual(where[field], { equals: ANY_NULL }, `${field} deve filtrar por AnyNull`);
    if (row[field] !== null && row[field] !== undefined) return false;
  }
  if (where.OR !== undefined) {
    assert.deepEqual(where.OR, [{ caption: null }, { caption: "" }]);
    if (row.caption !== null && row.caption !== "") return false;
  }
  return true;
}

const fakePrisma = {
  client: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === CLIENT_ID && state.client ? { id: CLIENT_ID, driveFolderId: null, ...state.client } : null,
  },
  schedule: { findFirst: async () => null },
  post: {
    findMany: async ({ where, select }: { where: { id?: { in: string[] } }; select?: Record<string, boolean> }) =>
      state.posts
        .filter((p) => !where.id || where.id.in.includes(p.id))
        .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
        .map((p) => pick(p, select)),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      state.updates.push({ where, data });
      let count = 0;
      for (const p of state.posts) {
        if (!matchesUpdate(p, where)) continue;
        Object.assign(p, data);
        count++;
      }
      return { count };
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      state.plainUpdates.push({ where, data });
      const row = state.posts.find((p) => p.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      schedule: { create: async () => ({ id: "sched-1", status: "rascunho" }) },
      post: {
        findMany: async ({ where }: { where: { scheduleId: string } }) =>
          state.posts.filter((p) => p.scheduleId === where.scheduleId).map((p) => ({ scheduledAt: p.scheduledAt, format: p.format })),
        createManyAndReturn: async ({ data, select }: { data: Record<string, unknown>[]; select?: Record<string, boolean> }) =>
          data.map((d) => {
            const row: Row = {
              id: uid(++seq),
              clientId: d.clientId as string,
              scheduleId: d.scheduleId as string,
              theme: (d.theme as string) ?? null,
              explanation: (d.explanation as string) ?? null,
              caption: null,
              captions: d.captions ?? null,
              slides: d.slides ?? null,
              format: d.format as string,
              targets: d.targets as string[],
              scheduledAt: d.scheduledAt as Date,
            };
            state.posts.push(row);
            return pick(row, select);
          }),
      },
    }),
};

const logs: string[] = [];
console.error = (...args: unknown[]) => {
  logs.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" "));
};

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\//, `rede real bloqueada no teste: ${url}`);
  const body = JSON.parse(String(init?.body ?? "{}"));
  const prompt: string = body.contents?.[0]?.parts?.[0]?.text ?? "";
  state.prompts.push(prompt);
  state.aiSignals.push(init?.signal);
  if (state.aiHang) {
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }))
      );
    });
  }
  if (state.aiStatus !== 200) return new Response('{"error":{"message":"internal"}}', { status: state.aiStatus });
  const ids = [...prompt.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const answer = state.ai ? state.ai(ids, prompt) : defaultAi(ids, prompt);
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
}) as typeof fetch;

/** IA falsa: legenda com hashtags PRÓPRIAS (o código deve trocar pelas do cliente) e slides quando pedidos. */
function defaultAi(ids: string[], prompt: string) {
  return {
    posts: ids.map((id) => {
      const line = prompt.split("\n").find((l) => l.includes(`id="${id}"`)) ?? "";
      return {
        id,
        shared: `Legenda IA ${id}\nChame no direct!\n\n#hashtagdaia #outra`,
        linkedin: `LinkedIn IA ${id}\n\n#hashtagdaia`,
        ...(line.includes("(gerar slides)") ? { slides: ["Capa", "Tela 2", "Chamada final"] } : {}),
      };
    }),
  };
}

// ------------------------------------------------------------ hooks de módulo

const FAKE_MODULES: Record<string, string> = {
  "next/server":
    "export class NextRequest extends Request {} export class NextResponse extends Response {}" +
    " export const after = (fn) => { globalThis.__f9.state.afterCalls.push(fn); };",
  "@/auth": "export const auth = async () => globalThis.__f9.state.session;",
  "@/lib/prisma": "export const prisma = globalThis.__f9.prisma;",
  "@/generated/prisma/client":
    "export const Prisma = { AnyNull: globalThis.__f9.ANY_NULL, DbNull: { __dbNull: true }, JsonNull: { __jsonNull: true } };",
  "@/lib/drive-sync":
    "export const prepareClientDriveFolders = async () => ({}); export const spMonthKey = (d) => d.toISOString().slice(0, 7);",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __f9: unknown }).__f9 = { state, prisma: fakePrisma, ANY_NULL };
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

const captionsRoute = await import("../../src/app/api/ai/calendar/captions/route.ts");
const commitRoute = await import("../../src/app/api/ai/calendar/commit/route.ts");
const lib = await import("../../src/lib/calendar-captions.ts");
const { generateWeekContent } = await import("../../src/lib/weekly.ts");

// ------------------------------------------------------------ helpers

let ip = 0;
function req(url: string, body: unknown, raw = false): Request {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    // IP próprio por chamada: o rate limit real não interfere
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${++ip}` },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}
async function read(res: Response) {
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
const captions = async (body: unknown, raw = false) =>
  read(await captionsRoute.POST(req("/api/ai/calendar/captions", body, raw) as never));
const commit = async (body: unknown) => read(await commitRoute.POST(req("/api/ai/calendar/commit", body) as never));

/** `error` é texto pt-BR para a tela (N-14): string, sem inglês/jargão do zod, da IA ou do Prisma. */
function assertFriendly(json: Record<string, unknown>, expected?: string | RegExp) {
  assert.equal(typeof json.error, "string", `error não é string: ${JSON.stringify(json)}`);
  const text = json.error as string;
  if (typeof expected === "string") assert.equal(text, expected);
  else if (expected) assert.match(text, expected);
  for (const re of [/Invalid|Expected|Required|received|too_(big|small)|Unauthorized/i, /Gemini|Prisma|ECONN|\bError\b|https?:/]) {
    assert.doesNotMatch(text, re, `texto técnico/inglês no erro: ${text}`);
  }
}

const BRIEFING = {
  hashtags: "#ZZQAF9 #SeguroCerto",
  products: "Seguro auto e residencial ZZ QA",
  restrictions: "Nunca citar preços",
  audience: "Famílias da região",
};

beforeEach(() => {
  state.session = { user: { role: "staff" } };
  state.client = { name: "ZZ QA F9 Cliente", toneOfVoice: "próximo e leve", briefing: BRIEFING };
  state.posts = [];
  state.afterCalls = [];
  state.prompts = [];
  state.ai = null;
  state.aiStatus = 200;
  state.updates = [];
  state.plainUpdates = [];
  state.aiHang = false;
  state.aiSignals = [];
  logs.length = 0;
});

// ------------------------------------------------------------ 1. rota de lotes

describe("1. POST /api/ai/calendar/captions — sessão e validação", () => {
  const post = (over: Record<string, unknown> = {}) => ({
    id: "r1",
    theme: "3 dicas de seguro",
    format: "feed",
    targets: ["instagram", "facebook"],
    ...over,
  });

  test("sem sessão → 401 em pt-BR e nenhuma chamada à IA", async () => {
    state.session = null;
    const r = await captions({ clientId: CLIENT_ID, posts: [post()] });
    assert.equal(r.status, 401);
    assertFriendly(r.json, "Sua sessão expirou. Entre de novo.");
    assert.equal(state.prompts.length, 0);
  });

  const cases: [string, unknown, string | RegExp, boolean?][] = [
    ["corpo que não é JSON", "{posts:", /Não foi possível ler as postagens/, true],
    ["sem posts", { clientId: CLIENT_ID }, /Não foi possível ler as postagens/],
    ["lista vazia", { clientId: CLIENT_ID, posts: [] }, /Não foi possível ler as postagens/],
    [
      "mais de 6 posts",
      { clientId: CLIENT_ID, posts: Array.from({ length: 7 }, (_, i) => post({ id: `r${i}` })) },
      "Envie no máximo 6 postagens por vez.",
    ],
    ["post sem título", { clientId: CLIENT_ID, posts: [post({ theme: "   " })] }, "Cada postagem precisa de um título para gerar a legenda."],
    ["post sem rede", { clientId: CLIENT_ID, posts: [post({ targets: [] })] }, "Cada postagem precisa de ao menos uma rede social."],
    ["clientId inválido", { clientId: "abc", posts: [post()] }, /Não foi possível ler as postagens/],
    ["id com caractere estranho", { clientId: CLIENT_ID, posts: [post({ id: "r1<script>" })] }, /Não foi possível ler as postagens/],
    ["ids repetidos", { clientId: CLIENT_ID, posts: [post(), post()] }, /Não foi possível ler as postagens/],
  ];
  for (const [name, body, message, raw] of cases) {
    test(`${name} → 400 pt-BR, sem IA`, async () => {
      const r = await captions(body, raw);
      assert.equal(r.status, 400);
      assertFriendly(r.json, message);
      assert.equal(state.prompts.length, 0);
    });
  }

  test("cliente inexistente → 404 pt-BR", async () => {
    state.client = null;
    const r = await captions({ clientId: CLIENT_ID, posts: [post()] });
    assert.equal(r.status, 404);
    assertFriendly(r.json, "Cliente não encontrado");
  });
});

describe("1. POST /api/ai/calendar/captions — geração", () => {
  test("200: briefing completo no prompt, hashtags do cliente no fim (as da IA saem), slides só em carrossel/reels, story com legenda e sem slides", async () => {
    const r = await captions({
      clientId: CLIENT_ID,
      posts: [
        { id: "r1", theme: "3 dicas de seguro", explanation: "Dicas rápidas", format: "feed", targets: ["instagram", "facebook"] },
        { id: "r2", theme: "Mitos do seguro", format: "carrossel", targets: ["instagram", "facebook", "linkedin"] },
        { id: "r3", theme: "Bastidores", format: "story", targets: ["instagram"] },
        { id: "r4", theme: "Depoimento", format: "reels", targets: ["facebook"] },
      ],
    });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(state.prompts.length, 1, "um lote = uma chamada de IA");

    const prompt = state.prompts[0];
    for (const piece of ["Seguro auto e residencial ZZ QA", "Nunca citar preços", "Famílias da região", "próximo e leve"]) {
      assert.ok(prompt.includes(piece), `briefing/tom fora do prompt: ${piece}`);
    }
    assert.match(prompt, /NÃO inclua hashtags/, "com hashtags fixas, a IA não deve pôr as dela");
    assert.match(prompt, /id="r2" formato=carrossel .*\(gerar slides\)/);
    assert.doesNotMatch(prompt.split("\n").find((l) => l.includes('id="r3"')) ?? "", /gerar slides/, "story nunca pede slides");

    const posts = r.json.posts as { id: string; captions: Record<string, string>; slides?: string[] }[];
    assert.deepEqual(r.json.missing, []);
    assert.deepEqual(posts.map((p) => p.id), ["r1", "r2", "r3", "r4"]);
    const byId = Object.fromEntries(posts.map((p) => [p.id, p]));

    // FB+IG = mesma legenda; só as redes do post; hashtags do cliente no fim, sem as da IA
    assert.deepEqual(Object.keys(byId.r1.captions).sort(), ["facebook", "instagram"]);
    assert.equal(byId.r1.captions.instagram, byId.r1.captions.facebook);
    for (const p of posts) {
      for (const text of Object.values(p.captions)) {
        assert.ok(text.endsWith("\n\n#ZZQAF9 #SeguroCerto"), `sem as hashtags do cliente no fim: ${JSON.stringify(text)}`);
        assert.doesNotMatch(text, /#hashtagdaia/);
      }
    }
    assert.match(byId.r2.captions.linkedin, /^LinkedIn IA r2/);
    assert.deepEqual(byId.r2.slides, ["Capa", "Tela 2", "Chamada final"]);
    assert.deepEqual(byId.r4.slides, ["Capa", "Tela 2", "Chamada final"]);
    assert.equal(byId.r1.slides, undefined, "feed sem slides");
    assert.deepEqual(Object.keys(byId.r3.captions), ["instagram"], "story recebe legenda");
    assert.equal(byId.r3.slides, undefined, "story sem slides");
  });

  test("cliente sem hashtags fixas: a IA põe as dela (3-6) e elas ficam", async () => {
    state.client = { name: "ZZ QA F9 Sem tags", toneOfVoice: null, briefing: null };
    const r = await captions({ clientId: CLIENT_ID, posts: [{ id: "r1", theme: "Dica", format: "feed", targets: ["instagram"] }] });
    assert.equal(r.status, 200);
    assert.match(state.prompts[0], /3-6 hashtags/);
    const [p] = r.json.posts as { captions: Record<string, string> }[];
    assert.match(p.captions.instagram, /#hashtagdaia #outra$/);
  });

  test("a IA esquece um post → 200 com ele em `missing`", async () => {
    state.ai = (ids) => ({ posts: ids.filter((id) => id !== "r2").map((id) => ({ id, shared: `Legenda ${id}` })) });
    const r = await captions({
      clientId: CLIENT_ID,
      posts: [
        { id: "r1", theme: "A", format: "feed", targets: ["instagram"] },
        { id: "r2", theme: "B", format: "feed", targets: ["instagram"] },
      ],
    });
    assert.equal(r.status, 200);
    assert.deepEqual((r.json.posts as { id: string }[]).map((p) => p.id), ["r1"]);
    assert.deepEqual(r.json.missing, ["r2"]);
  });

  test("IA fora do ar (500) → 502 pt-BR sem detalhe técnico; detalhe no log", async () => {
    state.aiStatus = 500;
    const r = await captions({ clientId: CLIENT_ID, posts: [{ id: "r1", theme: "A", format: "feed", targets: ["instagram"] }] });
    assert.equal(r.status, 502);
    assertFriendly(r.json, /inteligência artificial/);
    assert.ok(logs.some((l) => l.includes("Gemini 500")), logs.join("\n"));
  });

  test("IA sem nenhuma legenda útil → 502 pt-BR", async () => {
    state.ai = () => ({ posts: [] });
    const r = await captions({ clientId: CLIENT_ID, posts: [{ id: "r1", theme: "A", format: "feed", targets: ["instagram"] }] });
    assert.equal(r.status, 502);
    assertFriendly(r.json, /não devolveu as legendas/);
  });
});

// ------------------------------------------------------------ 2. commit + after()

const AT = (day: number, hh = 21, mm = 0) => new Date(Date.UTC(2026, 10, day, hh, mm)).toISOString();

describe("2. POST /api/ai/calendar/commit — legendas recebidas e after() só para os vazios", () => {
  const body = () => ({
    clientId: CLIENT_ID,
    month: "2026-11",
    posts: [
      // pronto na revisão: legenda + slides
      {
        theme: "Pronto",
        format: "carrossel",
        scheduledAt: AT(3),
        targets: ["instagram", "facebook"],
        captions: { instagram: "Legenda revisada", facebook: "Legenda revisada" },
        slides: [{ text: "Capa revisada" }],
      },
      { theme: "Pronto", format: "story", scheduledAt: AT(3, 21, 15), targets: ["instagram", "facebook"], captions: { instagram: "Legenda revisada", facebook: "Legenda revisada" } },
      // salvo antes de a legenda chegar (+ o story junto)
      { theme: "Faltando", explanation: "Explicação", format: "feed", scheduledAt: AT(5), targets: ["instagram", "facebook"], captions: {} },
      { theme: "Faltando", explanation: "Explicação", format: "story", scheduledAt: AT(5, 21, 15), targets: ["instagram", "facebook"], captions: {} },
      // carrossel com legenda mas sem slides
      { theme: "Sem slides", format: "carrossel", scheduledAt: AT(7), targets: ["instagram"], captions: { instagram: "Escrita à mão" } },
      // sem título: a IA não tem do que falar
      { theme: "", format: "feed", scheduledAt: AT(9), targets: ["instagram"] },
    ],
  });

  test("grava as legendas/slides recebidos e agenda UM after() com os posts sem legenda/slides", async () => {
    const r = await commit(body());
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.created, 6);
    assert.equal(r.json.captionsPending, 3, "Faltando + story junto + carrossel sem slides");
    assert.equal("pendingIds" in r.json, false, "ids internos não vão na resposta");
    assert.equal(state.afterCalls.length, 1);
    assert.equal(state.prompts.length, 0, "nada de IA antes da resposta");

    const byTheme = (t: string, f: string) => state.posts.find((p) => p.theme === t && p.format === f)!;
    assert.deepEqual(byTheme("Pronto", "carrossel").captions, { instagram: "Legenda revisada", facebook: "Legenda revisada" });
    assert.deepEqual(byTheme("Pronto", "carrossel").slides, [{ text: "Capa revisada" }]);
    assert.equal(byTheme("Faltando", "feed").captions, null);
  });

  test("after(): gera só os vazios, story junto copia a legenda do post, não sobrescreve quem preencheu no meio-tempo", async () => {
    const r = await commit(body());
    assert.equal(r.status, 201);
    const byTheme = (t: string, f: string) => state.posts.find((p) => p.theme === t && p.format === f)!;
    const before = JSON.stringify(byTheme("Pronto", "carrossel"));

    // alguém preenche o story junto à mão antes do after() rodar
    byTheme("Faltando", "story").captions = { instagram: "Story escrito pela equipe" };

    await state.afterCalls[0]();

    assert.equal(state.prompts.length, 1, "um lote: Faltando (feed) + Sem slides (carrossel); story junto não vai para a IA");
    const prompt = state.prompts[0];
    assert.ok(prompt.includes("Nunca citar preços"), "briefing no prompt do after()");
    assert.equal((prompt.match(/^\d+\. id="/gm) ?? []).length, 2, prompt);

    const feed = byTheme("Faltando", "feed");
    const caps = feed.captions as Record<string, string>;
    assert.equal(caps.instagram, caps.facebook);
    assert.match(caps.instagram, /^Legenda IA /);
    assert.ok(caps.instagram.endsWith("\n\n#ZZQAF9 #SeguroCerto"));

    // story junto preenchido no meio-tempo: intocado
    assert.deepEqual(byTheme("Faltando", "story").captions, { instagram: "Story escrito pela equipe" });

    // carrossel com legenda à mão: ganha só os slides
    const carrossel = byTheme("Sem slides", "carrossel");
    assert.deepEqual(carrossel.captions, { instagram: "Escrita à mão" });
    assert.deepEqual(carrossel.slides, [{ text: "Capa" }, { text: "Tela 2" }, { text: "Chamada final" }]);

    // o que já veio pronto e o post sem título não mudam
    assert.equal(JSON.stringify(byTheme("Pronto", "carrossel")), before);
    assert.equal(byTheme("", "feed").captions, null);
    // toda gravação do after() é condicional (updateMany com "continua vazio")
    assert.ok(state.updates.length > 0);
    for (const u of state.updates) assert.ok(u.where.captions || u.where.slides, JSON.stringify(u.where));
    assert.equal(state.plainUpdates.length, 0, "o after() nunca usa prisma.post.update (sem condição)");
  });

  test("after(): story junto vazio recebe a MESMA legenda do post", async () => {
    await commit(body());
    await state.afterCalls[0]();
    const feed = state.posts.find((p) => p.theme === "Faltando" && p.format === "feed")!;
    const story = state.posts.find((p) => p.theme === "Faltando" && p.format === "story")!;
    assert.deepEqual(story.captions, feed.captions);
    assert.equal(story.slides, null, "story nunca recebe slides");
  });

  test("todos com legenda → nenhum after() agendado", async () => {
    const r = await commit({
      clientId: CLIENT_ID,
      month: "2026-11",
      posts: [{ theme: "Ok", format: "feed", scheduledAt: AT(3), targets: ["instagram"], captions: { instagram: "Pronta" } }],
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.captionsPending, 0);
    assert.equal(state.afterCalls.length, 0);
  });

  test("after() com a IA fora do ar: nada é gravado, nada lança, erro só no log", async () => {
    await commit(body());
    state.aiStatus = 500;
    await state.afterCalls[0]();
    assert.equal(state.posts.find((p) => p.theme === "Faltando" && p.format === "feed")!.captions, null);
    assert.equal(state.updates.length, 0);
    assert.ok(logs.some((l) => l.includes("[calendar-captions] falha ao gerar o lote")), logs.join("\n"));
    assert.ok(logs.some((l) => l.includes("[ai/calendar/commit] legendas em segundo plano")), logs.join("\n"));
  });
});

// ------------------------------------------------------------ 3. funções puras

describe("3. lib/calendar-captions — regras puras", () => {
  test("needsContent: título obrigatório; legenda vazia ou carrossel/reels sem slides", () => {
    assert.equal(lib.needsContent({ theme: "", format: "feed", captions: null, slides: null }), false);
    assert.equal(lib.needsContent({ theme: "A", format: "feed", captions: null, slides: null }), true);
    assert.equal(lib.needsContent({ theme: "A", format: "feed", captions: { instagram: "  " }, slides: null }), true);
    assert.equal(lib.needsContent({ theme: "A", format: "feed", captions: { instagram: "x" }, slides: null }), false);
    assert.equal(lib.needsContent({ theme: "A", format: "reels", captions: { instagram: "x" }, slides: [] }), true);
    assert.equal(lib.needsContent({ theme: "A", format: "reels", captions: { instagram: "x" }, slides: [{ text: "t" }] }), false);
    assert.equal(lib.needsContent({ theme: "A", format: "story", captions: { instagram: "x" }, slides: null }), false);
  });

  test("pairStoryCompanions: story com o mesmo título 15 min depois de um post não-story", () => {
    const at = (m: number) => new Date(Date.UTC(2026, 10, 3, 21, m));
    const pairs = lib.pairStoryCompanions([
      { id: "p1", theme: "A", format: "feed", scheduledAt: at(0) },
      { id: "s1", theme: "A", format: "story", scheduledAt: at(15) },
      { id: "s2", theme: "B", format: "story", scheduledAt: at(15) },
      { id: "s3", theme: "A", format: "story", scheduledAt: at(20) },
    ]);
    assert.deepEqual([...pairs], [["s1", "p1"]]);
  });

  test("toCaptionResult: FB+IG iguais, LinkedIn cai para a legenda única, slides só em carrossel/reels", () => {
    const entry = { shared: "S", linkedin: "", slides: ["a"] };
    assert.deepEqual(lib.toCaptionResult(entry, { format: "feed", targets: ["instagram", "facebook", "linkedin"] }), {
      captions: { instagram: "S", facebook: "S", linkedin: "S" },
    });
    assert.deepEqual(lib.toCaptionResult(entry, { format: "carrossel", targets: ["linkedin"] }), {
      captions: { linkedin: "S" },
      slides: ["a"],
    });
    assert.equal(lib.toCaptionResult(null, { format: "feed", targets: ["instagram"] }), null);
  });
});

// ------------------------------------------------------------ 4. gate F9: F1 (casar só por id) e F2a (cancelar na IA)

/** IA que responde só os ids pedidos menos `skip` (cada um com a PRÓPRIA legenda). */
const aiSkipping = (skip: string) => (ids: string[]) => ({
  posts: ids.filter((id) => id !== skip).map((id) => ({ id, shared: `Legenda própria de ${id}` })),
});

describe("4. gate F9 — F1: a IA omite um post do MEIO do lote", () => {
  test("rota de lotes: o omitido vai para `missing` e ninguém recebe a legenda de outro post", async () => {
    state.client = { name: "ZZ QA F9", toneOfVoice: null, briefing: null };
    state.ai = aiSkipping("r2");
    const r = await captions({
      clientId: CLIENT_ID,
      posts: ["r1", "r2", "r3", "r4"].map((id) => ({ id, theme: `Tema ${id}`, format: "feed", targets: ["instagram"] })),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.missing, ["r2"]);
    const posts = r.json.posts as { id: string; captions: Record<string, string> }[];
    assert.deepEqual(posts.map((p) => [p.id, p.captions.instagram]), [
      ["r1", "Legenda própria de r1"],
      ["r3", "Legenda própria de r3"],
      ["r4", "Legenda própria de r4"],
    ]);
  });

  test("after(): o omitido fica sem legenda no banco (nunca a legenda do vizinho)", async () => {
    state.client = { name: "ZZ QA F9", toneOfVoice: null, briefing: null };
    await commit({
      clientId: CLIENT_ID,
      month: "2026-11",
      posts: [3, 5, 7].map((d, i) => ({ theme: `Meio ${i + 1}`, format: "feed", scheduledAt: AT(d), targets: ["instagram"] })),
    });
    const ids = state.posts.map((p) => p.id);
    state.ai = aiSkipping(ids[1]);
    await state.afterCalls[0]();
    const cap = (i: number) => (state.posts[i].captions as Record<string, string> | null)?.instagram ?? null;
    assert.equal(cap(0), `Legenda própria de ${ids[0]}`);
    assert.equal(cap(1), null, "post omitido pela IA continua vazio");
    assert.equal(cap(2), `Legenda própria de ${ids[2]}`);
    assert.ok(logs.some((l) => l.includes("a IA não devolveu legenda")), logs.join("\n"));
  });

  test("lote semanal (generateWeekContent): o omitido não é gravado; os outros com a própria legenda", async () => {
    state.client = { name: "ZZ QA F9", toneOfVoice: null, briefing: null };
    state.posts = ["w1", "w2", "w3"].map((id, i) => ({
      id, clientId: CLIENT_ID, scheduleId: "sched-w", theme: `Semana ${i + 1}`, explanation: null, caption: null,
      captions: null, slides: null, format: "feed", targets: ["instagram", "facebook"], scheduledAt: new Date(Date.UTC(2026, 10, 3 + i)),
    }));
    state.ai = aiSkipping("w2");
    assert.equal(await generateWeekContent(CLIENT_ID, ["w1", "w2", "w3"]), 2);
    assert.deepEqual(state.plainUpdates.map((u) => [u.where.id, (u.data.captions as Record<string, string>).instagram]), [
      ["w1", "Legenda própria de w1"],
      ["w3", "Legenda própria de w3"],
    ]);
    assert.equal(state.posts[1].captions, null);
  });
});

describe("4. gate F9 — F2a: lote cancelado no navegador é cancelado também na IA", () => {
  test("abortar o pedido aborta o fetch do Gemini, sem 2ª tentativa e sem log de erro", async () => {
    state.client = { name: "ZZ QA F9", toneOfVoice: null, briefing: null };
    state.aiHang = true;
    const ctrl = new AbortController();
    const request = new Request("http://localhost/api/ai/calendar/captions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.9.1.${++ip}` },
      body: JSON.stringify({ clientId: CLIENT_ID, posts: [{ id: "r1", theme: "A", format: "feed", targets: ["instagram"] }] }),
      signal: ctrl.signal,
    });
    const pending = captionsRoute.POST(request as never);
    for (let i = 0; i < 100 && state.prompts.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(state.prompts.length, 1, "a chamada à IA começou");
    ctrl.abort();
    const res = await pending;
    assert.equal(res.status, 499);
    assert.equal(state.aiSignals[0]?.aborted, true, "o fetch do Gemini recebeu o cancelamento");
    await new Promise((r) => setTimeout(r, 1700));
    assert.equal(state.prompts.length, 1, "sem nova tentativa depois do cancelamento");
    assert.equal(logs.filter((l) => l.includes("[ai/calendar/captions]")).length, 0);
  });

  test("sem sinal (lote semanal, after(), outras rotas): fetch do Gemini como antes", async () => {
    state.client = { name: "ZZ QA F9", toneOfVoice: null, briefing: null };
    const r = await captions({ clientId: CLIENT_ID, posts: [{ id: "r1", theme: "A", format: "feed", targets: ["instagram"] }] });
    assert.equal(r.status, 200);
    assert.equal(state.aiSignals.length, 1);
    assert.equal(state.aiSignals[0]?.aborted, false);
  });
});
