/**
 * OWASP-R5 — teto de gerações por IA (CF-12) e corpo com teto (CF-16) nas rotas de IA.
 *   1. lib/ai-quota: por usuária (hora e 24 h) e do sistema (hora), configurável por ambiente;
 *      mensagem pt-BR "Limite de gerações por IA atingido. Tente de novo em X min.".
 *   2. Rotas (assistente, legenda, calendário, nova ideia, lote de legendas, resumo do dia,
 *      títulos do mês das artes-base, commit do calendário): acima do teto → 429 pt-BR com
 *      Retry-After, SEM chamar a IA; o lote de legendas conta 1 por lote; a outra usuária segue.
 *      ATAQUE (antes): o mesmo staff em loop gerava sem limite por pessoa (só por IP).
 *   3. Corpo acima do teto → 413 sem gastar cota; pedido inválido (400) também não gasta.
 *
 * IA falsa (fetch do Gemini interceptado — nenhuma rede real), Prisma/sessão/Drive falsos,
 * "next/server" falso com `after` que só guarda o callback.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const CLIENT_ID = "99999999-9999-4999-8999-999999999999";
const USER_A = "00000000-0000-4000-8000-0000000000a1";
const USER_B = "00000000-0000-4000-8000-0000000000b2";

process.env.GEMINI_API_KEY = "chave-falsa-do-teste";

const state = {
  session: { user: { id: USER_A, role: "staff" } } as { user: { id: string; role: string } } | null,
  aiCalls: 0,
  prismaCalls: 0,
  afterCalls: [] as (() => unknown)[],
  templates: 0,
  postSeq: 0,
};

const fakePrisma = {
  client: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      state.prismaCalls++;
      return where.id === CLIENT_ID
        ? { id: CLIENT_ID, name: "ZZ QA R5", toneOfVoice: null, briefing: null, driveFolderId: null, socialAccounts: [] }
        : null;
    },
  },
  schedule: { findFirst: async () => null },
  post: {
    findMany: async () => {
      state.prismaCalls++;
      return [];
    },
  },
  artTemplate: {
    create: async () => {
      state.templates++;
      return {};
    },
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      schedule: { create: async () => ({ id: "sched-r5", status: "rascunho" }) },
      post: {
        findMany: async () => [],
        createManyAndReturn: async ({ data }: { data: Record<string, unknown>[] }) =>
          data.map((d) => ({
            id: `00000000-0000-4000-8000-${String(++state.postSeq).padStart(12, "0")}`,
            theme: d.theme,
            format: d.format,
            captions: d.captions ?? null,
            slides: d.slides ?? null,
          })),
      },
    }),
};

/** IA falsa: uma resposta que serve para todas as rotas (legenda, ideias, lote, títulos, assistente). */
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\//, `rede real bloqueada no teste: ${url}`);
  state.aiCalls++;
  const body = JSON.parse(String(init?.body ?? "{}"));
  const prompt: string = body.contents?.map((c: { parts: { text: string }[] }) => c.parts.map((p) => p.text).join("")).join("\n") ?? "";
  const ids = [...prompt.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const answer = {
    reply: "Resposta",
    shared: "Legenda falsa",
    linkedin: "Legenda LinkedIn",
    theme: "Tema novo",
    format: "feed",
    explanation: "Explicação",
    titles: ["Título A", "Título B", "Título C"],
    posts: ids.length
      ? ids.map((id) => ({ id, shared: `Legenda ${id}` }))
      : [{ theme: "Ideia 1", format: "feed", explanation: "Explicação" }],
  };
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
}) as typeof fetch;

const FAKE_MODULES: Record<string, string> = {
  "next/server":
    "export class NextRequest extends Request {} export class NextResponse extends Response {}" +
    " export const after = (fn) => { globalThis.__r5ia.state.afterCalls.push(fn); };",
  "@/auth": "export const auth = async () => globalThis.__r5ia.state.session;",
  "@/lib/prisma": "export const prisma = globalThis.__r5ia.prisma;",
  "@/generated/prisma/client":
    "export const Prisma = { AnyNull: { __anyNull: true }, DbNull: { __dbNull: true }, JsonNull: { __jsonNull: true } };",
  "@/lib/drive-sync":
    "export const prepareClientDriveFolders = async () => ({}); export const spMonthKey = (d) => d.toISOString().slice(0, 7);" +
    " export const ensureClientDriveFolder = async () => null; export const monthIndexFor = async () => new Map();",
  "@/lib/google-drive":
    "export const driveConfigured = () => false; export const ensureYearMonthFolders = async () => { throw new Error('Drive bloqueado no teste'); };" +
    " export const uploadToDrive = async () => { throw new Error('Drive bloqueado no teste'); }; export const serviceAccountEmail = () => null;",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
(globalThis as unknown as { __r5ia: unknown }).__r5ia = { state, prisma: fakePrisma };
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

const quota = await import("../../src/lib/ai-quota.ts");
const { resetRateLimitsForTests } = await import("../../src/lib/rate-limit.ts");
const routes = {
  assistant: await import("../../src/app/api/ai/assistant/route.ts"),
  caption: await import("../../src/app/api/ai/caption/route.ts"),
  calendar: await import("../../src/app/api/ai/calendar/route.ts"),
  regenerate: await import("../../src/app/api/ai/calendar/regenerate/route.ts"),
  captions: await import("../../src/app/api/ai/calendar/captions/route.ts"),
  commit: await import("../../src/app/api/ai/calendar/commit/route.ts"),
  dailySummary: await import("../../src/app/api/ai/daily-summary/route.ts"),
  generateMonth: await import("../../src/app/api/art-templates/generate-month/route.ts"),
};

const logs: string[] = [];
console.error = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
console.warn = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
console.info = () => {};
console.log = () => {};

let ip = 0;
function req(url: string, body?: unknown, raw?: string): Request {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    // IP próprio por chamada: só o teto por usuária/sistema interessa aqui
    headers: { "content-type": "application/json", "x-forwarded-for": `10.55.0.${(++ip % 250) + 1}` },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}
type Call = () => Promise<Response>;
const BODIES = {
  assistant: { clientId: CLIENT_ID, messages: [{ role: "user", content: "Sugira um título" }] },
  caption: { clientId: CLIENT_ID, theme: "Tema", targets: ["instagram"] },
  calendar: { clientId: CLIENT_ID, month: "2099-01", count: 2 },
  regenerate: { clientId: CLIENT_ID, targets: ["instagram"], avoid: ["Tema velho"] },
  captions: (n: number) => ({
    clientId: CLIENT_ID,
    posts: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, theme: `Tema ${i}`, format: "feed", targets: ["instagram"] })),
  }),
};
const call: Record<string, Call> = {
  assistant: () => routes.assistant.POST(req("/api/ai/assistant", BODIES.assistant) as never),
  caption: () => routes.caption.POST(req("/api/ai/caption", BODIES.caption) as never),
  calendar: () => routes.calendar.POST(req("/api/ai/calendar", BODIES.calendar) as never),
  regenerate: () => routes.regenerate.POST(req("/api/ai/calendar/regenerate", BODIES.regenerate) as never),
  captions: () => routes.captions.POST(req("/api/ai/calendar/captions", BODIES.captions(6)) as never),
  dailySummary: () => routes.dailySummary.POST(req("/api/ai/daily-summary") as never),
};

function setLimits(hour: number, day = 1000, global = 1000) {
  process.env.AI_USER_HOURLY_LIMIT = String(hour);
  process.env.AI_USER_DAILY_LIMIT = String(day);
  process.env.AI_GLOBAL_HOURLY_LIMIT = String(global);
}

async function assertQuota429(res: Response) {
  assert.equal(res.status, 429);
  const json = (await res.json()) as { error?: unknown; code?: unknown };
  assert.equal(json.code, "AI_QUOTA");
  assert.match(String(json.error), /^Limite de gerações por IA atingido\. Tente de novo em \d+ (min|h)\.$/);
  const retry = Number(res.headers.get("retry-after"));
  assert.ok(retry > 0 && retry <= 3600, `Retry-After ${retry}`);
}

beforeEach(() => {
  resetRateLimitsForTests();
  setLimits(1000);
  state.session = { user: { id: USER_A, role: "staff" } };
  state.aiCalls = 0;
  state.prismaCalls = 0;
  state.afterCalls = [];
  state.templates = 0;
  logs.length = 0;
});

// --------------------------------------------------------------------------------------------
describe("1. lib/ai-quota", () => {
  test("padrões 120/h e 600/24h por usuária, 1000/h do sistema; ambiente inválido volta ao padrão", () => {
    delete process.env.AI_USER_HOURLY_LIMIT;
    process.env.AI_USER_DAILY_LIMIT = "abc";
    process.env.AI_GLOBAL_HOURLY_LIMIT = "-5";
    assert.deepEqual(quota.aiQuotaLimits(), { userHourly: 120, userDaily: 600, globalHourly: 1000 });
  });

  test("por hora: a 4ª geração com teto 3 é recusada; outra usuária segue", () => {
    setLimits(3);
    for (let i = 0; i < 3; i++) assert.deepEqual(quota.consumeAiQuota(USER_A), { ok: true });
    const r = quota.consumeAiQuota(USER_A);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.scope, "user_hour");
      assert.ok(r.retryAfter > 3500 && r.retryAfter <= 3600);
    }
    assert.deepEqual(quota.consumeAiQuota(USER_B), { ok: true });
  });

  test("por 24 h e do sistema", () => {
    setLimits(100, 5);
    for (let i = 0; i < 5; i++) assert.equal(quota.consumeAiQuota(USER_A).ok, true);
    const day = quota.consumeAiQuota(USER_A);
    assert.equal(!day.ok && day.scope, "user_day");

    resetRateLimitsForTests();
    setLimits(100, 100, 4);
    assert.equal(quota.consumeAiQuota(USER_A, 2).ok, true);
    assert.equal(quota.consumeAiQuota(USER_B, 2).ok, true);
    const global = quota.consumeAiQuota(USER_B);
    assert.equal(!global.ok && global.scope, "global_hour");
  });

  test("unidades: pedido de várias gerações não passa do teto", () => {
    setLimits(3);
    assert.equal(quota.consumeAiQuota(USER_A, 2).ok, true);
    assert.equal(quota.consumeAiQuota(USER_A, 2).ok, false);
  });

  test("mensagem pt-BR com minutos (ou horas acima de 90 min)", () => {
    assert.equal(quota.aiQuotaMessage(30), "Limite de gerações por IA atingido. Tente de novo em 1 min.");
    assert.equal(quota.aiQuotaMessage(3599), "Limite de gerações por IA atingido. Tente de novo em 60 min.");
    assert.equal(quota.aiQuotaMessage(5400), "Limite de gerações por IA atingido. Tente de novo em 90 min.");
    assert.equal(quota.aiQuotaMessage(86_000), "Limite de gerações por IA atingido. Tente de novo em 24 h.");
  });
});

// --------------------------------------------------------------------------------------------
describe("2. rotas de IA: acima do teto → 429 sem chamar a IA", () => {
  for (const name of ["assistant", "caption", "calendar", "regenerate", "captions"] as const) {
    test(`${name}: 2 gerações com teto 2, a 3ª → 429 pt-BR e a IA não é chamada; outra usuária segue`, async () => {
      setLimits(2);
      for (let i = 0; i < 2; i++) {
        const res = await call[name]();
        assert.equal(res.status, 200, `${name} chamada ${i + 1}: ${await res.clone().text()}`);
      }
      const calls = state.aiCalls;
      assert.ok(calls >= 2);
      await assertQuota429(await call[name]());
      assert.equal(state.aiCalls, calls, "a IA não pode ser chamada acima do teto");
      assert.match(logs.join("\n"), /\[ai-quota\] .*limite user_hour/);

      state.session = { user: { id: USER_B, role: "staff" } };
      assert.equal((await call[name]()).status, 200);
    });
  }

  test("lote de legendas do calendário conta 1 por LOTE (6 posts), não por post", async () => {
    setLimits(2);
    assert.equal((await call.captions()).status, 200);
    assert.equal((await call.captions()).status, 200);
    await assertQuota429(await call.captions());
  });

  test("resumo do dia: acima do teto → 429 antes de ler o banco e de chamar a IA", async () => {
    setLimits(1);
    quota.consumeAiQuota(USER_A);
    await assertQuota429(await call.dailySummary());
    assert.equal(state.aiCalls, 0);
    assert.equal(state.prismaCalls, 0);
  });

  test("títulos do mês das artes-base: consome 1 + 1 por título (2 títulos = 3)", async () => {
    const body = { month: "2099-01", baseImageUrl: "https://example.com/arte.png", count: 2 };
    setLimits(2);
    await assertQuota429(await routes.generateMonth.POST(req("/api/art-templates/generate-month", body) as never));
    assert.equal(state.aiCalls, 0);
    assert.equal(state.templates, 0);

    resetRateLimitsForTests();
    setLimits(3);
    const ok = await routes.generateMonth.POST(req("/api/art-templates/generate-month", body) as never);
    assert.equal(ok.status, 201, await ok.clone().text());
    assert.equal(state.aiCalls, 3);
    assert.equal(state.templates, 2);
  });

  test("commit do calendário: sem cota o cronograma é salvo, mas as legendas em segundo plano não são agendadas", async () => {
    const body = {
      clientId: CLIENT_ID,
      month: "2099-01",
      posts: Array.from({ length: 5 }, (_, i) => ({
        theme: `Tema ${i}`,
        format: "feed",
        scheduledAt: `2099-01-${String(i + 5).padStart(2, "0")}T21:00:00.000Z`,
        targets: ["instagram"],
      })),
    };
    // 5 posts sem legenda = 2 lotes de 4 → 2 gerações
    setLimits(1);
    const denied = await routes.commit.POST(req("/api/ai/calendar/commit", body) as never);
    assert.equal(denied.status, 201);
    assert.equal(((await denied.json()) as { captionsPending: number }).captionsPending, 0);
    assert.equal(state.afterCalls.length, 0);
    assert.match(logs.join("\n"), /limite de IA \(user_hour\)/);

    resetRateLimitsForTests();
    setLimits(2);
    const ok = await routes.commit.POST(req("/api/ai/calendar/commit", body) as never);
    assert.equal(ok.status, 201);
    assert.equal(((await ok.json()) as { captionsPending: number }).captionsPending, 5);
    assert.equal(state.afterCalls.length, 1);
  });
});

// --------------------------------------------------------------------------------------------
describe("3. corpo com teto e pedido inválido não gastam cota", () => {
  test("legenda: corpo de 70 KB → 413 pt-BR; nenhuma geração contada", async () => {
    setLimits(1);
    const big = JSON.stringify({ ...BODIES.caption, notes: "x".repeat(70 * 1024) });
    const res = await routes.caption.POST(req("/api/ai/caption", undefined, big) as never);
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: "O conteúdo enviado é grande demais." });
    assert.equal((await call.caption()).status, 200, "a cota continua inteira");
  });

  test("assistente: corpo acima de 512 KB → 413; calendário: acima de 16 KB → 413", async () => {
    const huge = JSON.stringify({ ...BODIES.assistant, pad: "x".repeat(600 * 1024) });
    assert.equal((await routes.assistant.POST(req("/api/ai/assistant", undefined, huge) as never)).status, 413);
    const cal = JSON.stringify({ ...BODIES.calendar, pad: "x".repeat(20 * 1024) });
    assert.equal((await routes.calendar.POST(req("/api/ai/calendar", undefined, cal) as never)).status, 413);
    assert.equal(state.aiCalls, 0);
  });

  test("pedido inválido (400) e cliente inexistente (404) não gastam cota", async () => {
    setLimits(1);
    assert.equal((await routes.caption.POST(req("/api/ai/caption", { clientId: CLIENT_ID, targets: [] }) as never)).status, 400);
    assert.equal(
      (await routes.caption.POST(req("/api/ai/caption", { ...BODIES.caption, clientId: "11111111-1111-4111-8111-111111111111" }) as never)).status,
      404
    );
    // tema e lista de temas a evitar ganharam teto (antes: sem limite)
    assert.equal((await routes.caption.POST(req("/api/ai/caption", { ...BODIES.caption, theme: "x".repeat(401) }) as never)).status, 400);
    assert.equal(
      (await routes.regenerate.POST(req("/api/ai/calendar/regenerate", { ...BODIES.regenerate, avoid: Array(201).fill("t") }) as never)).status,
      400
    );
    assert.equal((await call.caption()).status, 200);
  });

  test("commit do calendário: mídia de post fora de https público → 400 pt-BR com o campo, nada gravado (AUD2-04)", async () => {
    const post = (mediaUrl: string) => ({
      theme: "Tema",
      format: "feed",
      scheduledAt: "2099-01-05T21:00:00.000Z",
      targets: ["instagram"],
      mediaUrl,
    });
    const before = state.postSeq;
    for (const bad of ["javascript:alert(1)", "http://example.com/a.jpg", "https://127.0.0.1/a.jpg", "https://localhost/a.jpg", "https://u:p@example.com/a.jpg"]) {
      const res = await routes.commit.POST(
        req("/api/ai/calendar/commit", { clientId: CLIENT_ID, month: "2099-01", posts: [post("https://example.com/ok.jpg"), post(bad)] }) as never
      );
      assert.equal(res.status, 400, bad);
      const json = (await res.json()) as { error: unknown; field: unknown };
      assert.equal(json.field, "posts.1.mediaUrl", bad);
      assert.equal(typeof json.error, "string");
      assert.doesNotMatch(String(json.error), /https?:\/\/|Invalid|URL/);
    }
    assert.equal(state.postSeq, before, "nenhum post gravado");
    const ok = await routes.commit.POST(req("/api/ai/calendar/commit", { clientId: CLIENT_ID, month: "2099-01", posts: [post("https://example.com/ok.jpg"), post("")] }) as never);
    assert.equal(ok.status, 201);
  });

  test("títulos do mês: arte-base só do R2 público (r2Only) — link de outro site → 400 sem gastar cota nem IA", async () => {
    const prev = process.env.R2_PUBLIC_BASE_URL;
    process.env.R2_PUBLIC_BASE_URL = "https://pub-r5teste.r2.dev";
    try {
      setLimits(3);
      for (const bad of ["https://example.com/arte.png", "javascript:alert(1)", "https://169.254.169.254/latest", "http://pub-r5teste.r2.dev/a.png"]) {
        const res = await routes.generateMonth.POST(
          req("/api/art-templates/generate-month", { month: "2099-01", baseImageUrl: bad, count: 2 }) as never
        );
        assert.equal(res.status, 400, bad);
        const json = (await res.json()) as { error: unknown; field: unknown };
        assert.equal(json.field, "baseImageUrl");
        assert.equal(typeof json.error, "string");
      }
      assert.equal(state.aiCalls, 0);
      const ok = await routes.generateMonth.POST(
        req("/api/art-templates/generate-month", { month: "2099-01", baseImageUrl: "https://pub-r5teste.r2.dev/arts/base.png", count: 2 }) as never
      );
      assert.equal(ok.status, 201, "a cota (3) continuava inteira e o R2 é aceito");
    } finally {
      if (prev === undefined) delete process.env.R2_PUBLIC_BASE_URL;
      else process.env.R2_PUBLIC_BASE_URL = prev;
    }
  });

  test("sem sessão → 401 antes de tudo", async () => {
    state.session = null;
    for (const name of Object.keys(call)) {
      const res = await call[name]();
      assert.equal(res.status, 401, name);
    }
    assert.equal(state.aiCalls, 0);
  });
});
