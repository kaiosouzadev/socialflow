/**
 * F12-MODELOS-IA (pedido do usuário em 07/10): trocar o modelo de IA de TEXTO numa tela de
 * Administração ("Modelos de IA"), valendo na hora, para comparar Gemini 3.7 × 3.8 Flash
 * (e o ChatGPT depois). A geração de IMAGENS não muda.
 *
 * Prova:
 *   - resolução (lib/ai-models.getTextModel): sem configuração = idêntico a antes (env → padrão
 *     por função); com configuração = o modelo escolhido; tabela ausente/banco fora → padrão sem
 *     erro (um aviso só); valor ilegível ou "openai" → padrão;
 *   - TODOS os caminhos de texto (rotas e libs) chamam a IA com o modelo resolvido, e a imagem
 *     das artes continua no IMAGE_MODEL — com e sem configuração;
 *   - nenhum arquivo de src/ ficou com CAPTION_MODEL/CALENDAR_MODEL nem chama a IA fora da lista;
 *   - rotas GET/PUT /api/settings/ai-model e POST /api/settings/ai-model/test: só admin
 *     (401/403), zod com 400 em pt-BR, ChatGPT recusado, salvar invalida o cache, o teste não
 *     salva e traduz os erros da IA sem detalhe técnico (N-14).
 *
 * F14-OPENAI: com ChatGPT escolhido (e chave da OpenAI salva), TODOS os caminhos de texto vão para a
 * OpenAI, menos a verificação de texto das artes (recebe imagem → continua no Gemini padrão).
 *
 * Técnica dos demais testes de rota: hooks de módulo resolvem "@/" para os fontes e trocam
 * Prisma, sessão, avisos, Drive/R2 por versões falsas; lib/gemini roda de verdade sobre um
 * `fetch` falso que registra o modelo de cada chamada — nenhuma IA nem rede reais.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const CLIENT_ID = "8f120000-0000-4000-8000-000000000001";
const ADMIN_ID = "8f120000-0000-4000-8000-0000000000a1";
const CLIENT_NAME = "ZZ QA F12 Cliente";
const GEMINI_HOST = "https://generativelanguage.googleapis.com/";
const OPENAI_HOST = "https://api.openai.com/";
const OPENAI_KEY = `sk-test-ZZQAf12${"z".repeat(24)}QRST`;

// ------------------------------------------------------------ banco, sessão e IA falsos

type Row = Record<string, unknown>;
type SettingRow = { value: unknown; updatedAt: Date; updatedBy: string | null };

const state = {
  session: null as { user: { id?: string; email?: string; role?: string } } | null,
  settings: new Map<string, SettingRow>(),
  /** erro lançado por app_settings (ex.: tabela ausente) */
  dbError: null as Error | null,
  settingReads: 0,
  upserts: 0,
  /** texto devolvido pela IA de texto */
  aiText: "",
  /** status forçado da IA de texto (ex.: 404) */
  aiStatus: 200,
  /** modelos chamados, na ordem: { model, image, provider } */
  calls: [] as { model: string; image: boolean; provider: "google" | "openai" }[],
};

const P2021 = Object.assign(new Error("The table `public.app_settings` does not exist in the current database."), {
  name: "PrismaClientKnownRequestError",
  code: "P2021",
});

const appSettingDelegate = {
  findUnique: async ({ where }: { where: { key: string } }) => {
    if (state.dbError) throw state.dbError;
    state.settingReads++;
    const row = state.settings.get(where.key);
    if (!row) return null;
    return {
      value: row.value,
      updatedAt: row.updatedAt,
      updater: row.updatedBy === ADMIN_ID ? { name: "ZZ QA F12 Admin" } : null,
    };
  },
  upsert: async ({ where, create, update }: { where: { key: string }; create: Row; update: Row }) => {
    if (state.dbError) throw state.dbError;
    state.upserts++;
    const data = state.settings.has(where.key) ? update : create;
    state.settings.set(where.key, {
      value: structuredClone(data.value),
      updatedAt: new Date(),
      updatedBy: (data.updatedBy as string | null) ?? null,
    });
    return {};
  },
};

const fakePrisma: Record<string, unknown> = {
  appSetting: appSettingDelegate,
  user: {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
      where.id === ADMIN_ID || where.email === "zzqa.f12.admin@example.com" ? { id: ADMIN_ID } : null,
  },
  client: {
    findUnique: async () => ({
      id: CLIENT_ID,
      name: CLIENT_NAME,
      toneOfVoice: "próximo",
      briefing: null,
      socialAccounts: [{ platform: "instagram" }, { platform: "facebook" }],
    }),
  },
  post: {
    findMany: async () => [
      {
        id: "p1",
        theme: "Tema ZZ",
        explanation: null,
        format: "feed",
        targets: ["instagram"],
        captions: null,
        caption: null,
        slides: null,
        status: "scheduled",
        scheduledAt: new Date("2027-03-01T15:00:00Z"),
        mediaUrl: null,
        client: { name: CLIENT_NAME },
      },
    ],
    update: async () => ({}),
  },
  dailySummary: { upsert: async () => ({}) },
  artTemplate: { create: async () => ({}) },
};

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

let IMAGE_MODEL_ID = "";
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://example.com/")) {
    return new Response(TINY_PNG, { status: 200, headers: { "content-type": "image/png" } });
  }
  if (url.startsWith(OPENAI_HOST)) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${OPENAI_KEY}`);
    state.calls.push({ model: body.model ?? "?", image: false, provider: "openai" });
    return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: state.aiText }] }] });
  }
  assert.ok(url.startsWith(GEMINI_HOST), `rede real bloqueada no teste: ${url}`);
  const model = /\/models\/([^:]+):generateContent$/.exec(url)?.[1] ?? "?";
  const image = model === IMAGE_MODEL_ID;
  state.calls.push({ model, image, provider: "google" });
  if (image) {
    return Response.json({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: TINY_PNG.toString("base64") } }] } }],
    });
  }
  if (state.aiStatus !== 200) {
    return new Response(`{"error":{"message":"models/${model} is not found for API version v1beta"}}`, {
      status: state.aiStatus,
    });
  }
  return Response.json({ candidates: [{ content: { parts: [{ text: state.aiText }] } }] });
}) as typeof fetch;

const logs = { info: [] as string[], warn: [] as string[], error: [] as string[] };
console.info = (...a: unknown[]) => void logs.info.push(a.map(String).join(" "));
console.warn = (...a: unknown[]) => void logs.warn.push(a.map(String).join(" "));
console.error = (...a: unknown[]) => void logs.error.push(a.map(String).join(" "));

// ------------------------------------------------------------ hooks de módulo

const BLOCKED = (what: string) => `async () => { throw new Error('${what} bloqueado no teste'); }`;
const FAKE_MODULES: Record<string, string> = {
  "next/server": "export class NextRequest extends Request {} export class NextResponse extends Response {}",
  "@/auth": "export const auth = async () => globalThis.__f12.state.session;",
  "@/lib/prisma": "export const prisma = globalThis.__f12.prisma;",
  "@/generated/prisma/client": "export const Prisma = {};",
  "@/lib/notify":
    "export const teamEmails = async () => []; export const raiseAlert = async () => ({ created: false });" +
    " export const notifyEmailHtml = () => ''; export const escapeHtml = (s) => s;",
  "@/lib/r2": `export const r2Configured = () => false; export const uploadToR2 = ${BLOCKED("R2")};`,
  "@/lib/google-drive":
    `export const driveConfigured = () => false; export const ensureYearMonthFolders = ${BLOCKED("Drive")};` +
    ` export const uploadToDrive = ${BLOCKED("Drive")}; export const serviceAccountEmail = () => null;`,
  "@/lib/drive-sync":
    "export const ensureClientDriveFolder = async () => null; export const monthIndexFor = async () => new Map();",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __f12: unknown }).__f12 = { state, prisma: fakePrisma };
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

process.env.GEMINI_API_KEY = "chave-ia-falsa";
process.env.TOKEN_ENC_KEY = "f12a".repeat(16);
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_CAPTION_MODEL;
delete process.env.GEMINI_CALENDAR_MODEL;

const aiModels = await import("../../src/lib/ai-models.ts");
const openaiKey = await import("../../src/lib/openai-key.ts");
const { IMAGE_MODEL } = await import("../../src/lib/gemini.ts");
IMAGE_MODEL_ID = IMAGE_MODEL;
const settingsRoute = await import("../../src/app/api/settings/ai-model/route.ts");
const testRoute = await import("../../src/app/api/settings/ai-model/test/route.ts");
const captionRoute = await import("../../src/app/api/ai/caption/route.ts");
const calendarRoute = await import("../../src/app/api/ai/calendar/route.ts");
const regenerateRoute = await import("../../src/app/api/ai/calendar/regenerate/route.ts");
const assistantRoute = await import("../../src/app/api/ai/assistant/route.ts");
const generateMonthRoute = await import("../../src/app/api/art-templates/generate-month/route.ts");
const { generateDailySummary } = await import("../../src/lib/daily-summary.ts");
const { generateWeekContent } = await import("../../src/lib/weekly.ts");
const { generateCaptionBatch } = await import("../../src/lib/calendar-captions.ts");
const { genTemplateCaptions } = await import("../../src/lib/basic-plan.ts");
const { generateArt } = await import("../../src/lib/art-gen.ts");

const cryptoLib = await import("../../src/lib/crypto.ts");
const { getTextModel, invalidateTextModelCache, TEXT_MODEL_KEY } = aiModels;

const ADMIN = { user: { id: ADMIN_ID, email: "zzqa.f12.admin@example.com", role: "admin" } };
const STAFF = { user: { id: "8f120000-0000-4000-8000-0000000000b2", role: "staff" } };

function reset() {
  state.session = ADMIN;
  state.settings.clear();
  state.dbError = null;
  state.settingReads = 0;
  state.upserts = 0;
  state.aiText = "";
  state.aiStatus = 200;
  state.calls = [];
  fakePrisma.appSetting = appSettingDelegate;
  delete process.env.GEMINI_CAPTION_MODEL;
  delete process.env.GEMINI_CALENDAR_MODEL;
  delete process.env.OPENAI_API_KEY;
  invalidateTextModelCache();
  openaiKey.invalidateOpenAiKeyCache();
}

/** Chave da OpenAI salva (cifrada) direto no banco falso. */
function saveOpenAiKeyDirect() {
  const { encryptToken } = cryptoLib;
  state.settings.set(openaiKey.OPENAI_KEY_SETTING, {
    value: { enc: encryptToken(OPENAI_KEY), last4: OPENAI_KEY.slice(-4), updatedAt: new Date().toISOString() },
    updatedAt: new Date(),
    updatedBy: ADMIN_ID,
  });
  openaiKey.invalidateOpenAiKeyCache();
}

function saveDirect(value: unknown) {
  state.settings.set(TEXT_MODEL_KEY, { value, updatedAt: new Date(), updatedBy: ADMIN_ID });
  invalidateTextModelCache();
}

let ip = 0;
function req(url: string, method: string, body?: unknown, fixedIp?: string): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": fixedIp ?? `10.12.0.${++ip}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(res: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const DEFAULTS = { caption: "gemini-2.5-flash", calendar: "gemini-3.5-flash" };

// ------------------------------------------------------------ resolução

describe("getTextModel: ordem configuração → env → padrão", () => {
  beforeEach(reset);

  test("sem configuração salva: idêntico a antes (legendas 2.5 Flash · calendário 3.5 Flash)", async () => {
    assert.deepEqual(await getTextModel("caption"), { provider: "google", model: DEFAULTS.caption });
    assert.deepEqual(await getTextModel("calendar"), { provider: "google", model: DEFAULTS.calendar });
  });

  test("sem configuração e com env: vale o env, por função (como antes)", async () => {
    process.env.GEMINI_CAPTION_MODEL = "gemini-env-legenda";
    process.env.GEMINI_CALENDAR_MODEL = "gemini-env-calendario";
    assert.equal((await getTextModel("caption")).model, "gemini-env-legenda");
    assert.equal((await getTextModel("calendar")).model, "gemini-env-calendario");
  });

  test("com configuração: UM modelo para as duas funções, acima do env", async () => {
    process.env.GEMINI_CAPTION_MODEL = "gemini-env-legenda";
    saveDirect({ provider: "google", model: "gemini-3.8-flash" });
    assert.deepEqual(await getTextModel("caption"), { provider: "google", model: "gemini-3.8-flash" });
    assert.deepEqual(await getTextModel("calendar"), { provider: "google", model: "gemini-3.8-flash" });
  });

  test("“Padrão do sistema” salvo (model null) = sem configuração", async () => {
    saveDirect({ provider: "google", model: null });
    assert.equal((await getTextModel("caption")).model, DEFAULTS.caption);
    assert.equal((await getTextModel("calendar")).model, DEFAULTS.calendar);
  });

  test("valor ilegível no banco → padrão do sistema (sem lançar)", async () => {
    for (const value of [
      { provider: "google", model: "gemini 3.8 flash" },
      { provider: "google", model: "../x" },
      { provider: "anthropic", model: "x" },
      "gemini-3.8-flash",
      null,
      [],
      { provider: "openai", model: "gpt..4o" },
    ]) {
      saveDirect(value);
      assert.equal((await getTextModel("caption")).model, DEFAULTS.caption, JSON.stringify(value));
      assert.equal((await getTextModel("calendar")).model, DEFAULTS.calendar, JSON.stringify(value));
    }
  });

  test("ChatGPT salvo: vale com chave da OpenAI; sem chave (nem salva nem no ambiente) → padrão, sem lançar", async () => {
    saveDirect({ provider: "openai", model: "gpt-5-mini" });
    assert.deepEqual(await getTextModel("caption"), { provider: "google", model: DEFAULTS.caption });
    assert.deepEqual(await getTextModel("calendar"), { provider: "google", model: DEFAULTS.calendar });
    saveOpenAiKeyDirect();
    assert.deepEqual(await getTextModel("caption"), { provider: "openai", model: "gpt-5-mini" });
    assert.deepEqual(await getTextModel("calendar"), { provider: "openai", model: "gpt-5-mini" });
    // o verificador da arte (imagem) continua no Gemini padrão
    assert.equal(await aiModels.getGeminiTextModel("caption"), DEFAULTS.caption);
    // só a do ambiente também vale
    state.settings.delete(openaiKey.OPENAI_KEY_SETTING);
    openaiKey.invalidateOpenAiKeyCache();
    process.env.OPENAI_API_KEY = OPENAI_KEY;
    assert.deepEqual(await getTextModel("caption"), { provider: "openai", model: "gpt-5-mini" });
  });

  test("tabela ausente (P2021): padrão do sistema, sem erro, aviso uma vez só", async () => {
    state.dbError = P2021;
    const before = logs.warn.length;
    // o aviso é por processo: zera a marca para este teste
    (globalThis as unknown as { __sfTextModel?: { warned: boolean } }).__sfTextModel!.warned = false;
    assert.equal((await getTextModel("caption")).model, DEFAULTS.caption);
    invalidateTextModelCache();
    assert.equal((await getTextModel("calendar")).model, DEFAULTS.calendar);
    const warned = logs.warn.slice(before);
    assert.equal(warned.length, 1, warned.join("\n"));
    assert.match(warned[0], /P2021.*app_settings ausente.*padrão do sistema/);
  });

  test("Prisma sem o modelo AppSetting (cliente antigo) → padrão do sistema, sem erro", async () => {
    delete fakePrisma.appSetting;
    assert.equal((await getTextModel("caption")).model, DEFAULTS.caption);
    assert.equal((await getTextModel("calendar")).model, DEFAULTS.calendar);
  });

  test("cache curto: lê o banco uma vez; invalidar relê", async () => {
    saveDirect({ provider: "google", model: "gemini-3.7-flash" });
    await Promise.all([getTextModel("caption"), getTextModel("calendar"), getTextModel("caption")]);
    assert.equal(state.settingReads, 1);
    // mudança direta no banco sem invalidar: continua o valor em cache (até 30 s)
    state.settings.set(TEXT_MODEL_KEY, { value: { provider: "google", model: "gemini-3.8-flash" }, updatedAt: new Date(), updatedBy: null });
    assert.equal((await getTextModel("caption")).model, "gemini-3.7-flash");
    invalidateTextModelCache();
    assert.equal((await getTextModel("caption")).model, "gemini-3.8-flash");
    assert.equal(state.settingReads, 2);
    assert.equal(aiModels.TEXT_MODEL_CACHE_MS, 30_000);
  });
});

describe("validação do ID e mensagens do teste", () => {
  test("IDs aceitos e recusados (sem espaços, sem barra, minúsculas)", () => {
    for (const ok of ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-2.5-flash-preview-05-20", "gemini-flash-latest", "gpt-4o-mini", "gpt-5-mini", "gpt-4.1-mini", "o4-mini", "gpt-4o-2024-08-06"]) {
      assert.ok(aiModels.isValidModelId(ok), ok);
    }
    for (const bad of ["", "gemini 3.8", "Gemini-3.8", "models/gemini", "gemini:3", "a?b", "a#b", "gpt..5", "-gemini", "gemini-", "x".repeat(81)]) {
      assert.ok(!aiModels.isValidModelId(bad), bad);
    }
    assert.equal(aiModels.normalizeModelId("  models/Gemini-3.8-Flash "), "gemini-3.8-flash");
  });

  test("erros da IA viram frases pt-BR sem detalhe técnico", () => {
    const cases: [unknown, RegExp][] = [
      [new Error("Gemini 404: {\"error\":{\"message\":\"models/x is not found\"}}"), /^Modelo não encontrado: confira o ID\.$/],
      [new Error("Gemini 400: model is not supported"), /^Modelo não encontrado ou sem suporte a texto/],
      [new Error("Gemini 400: API key not valid. Please pass a valid API key."), /^Sem permissão/],
      [new Error("Gemini 403: PERMISSION_DENIED"), /^Sem permissão para usar este modelo/],
      [new Error("Gemini 429: quota"), /^Limite de uso da IA/],
      [new Error("Gemini 503: overloaded"), /^A IA está instável/],
      [Object.assign(new Error("This operation was aborted"), { name: "AbortError" }), /^Tempo esgotado/],
      [new Error("GEMINI_API_KEY não configurada"), /^A IA não está configurada no servidor/],
      [new Error("Gemini não retornou texto (MAX_TOKENS)"), /^O modelo respondeu sem texto/],
      [new TypeError("fetch failed"), /^Falha de conexão com a IA/],
      [new Error("qualquer coisa estranha https://x.y"), /^Não foi possível testar o modelo agora/],
    ];
    for (const [e, re] of cases) {
      const msg = aiModels.describeModelTestError(e);
      assert.match(msg, re, String(e));
      assert.doesNotMatch(msg, /Gemini \d|https?:|API_KEY|\{|models\//, msg);
    }
  });
});

// ------------------------------------------------------------ todos os caminhos de texto

/** Cada caminho que chama a IA de texto: função de origem (o padrão de antes) e como chamar. */
type TextPath = { name: string; kinds: ("caption" | "calendar")[]; image?: boolean; run: () => Promise<unknown> };

const TEXT_PATHS: TextPath[] = [
  {
    name: "POST /api/ai/caption (legenda)",
    kinds: ["caption"],
    run: async () => {
      state.aiText = JSON.stringify({ shared: "Legenda." });
      const r = await json(
        await captionRoute.POST(req("http://localhost/api/ai/caption", "POST", { clientId: CLIENT_ID, theme: "Tema", targets: ["instagram"] }) as never)
      );
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.model;
    },
  },
  {
    name: "POST /api/ai/calendar (cronograma)",
    kinds: ["calendar"],
    run: async () => {
      state.aiText = JSON.stringify({ posts: [{ theme: "Ideia", format: "feed", explanation: "Por quê." }] });
      const r = await json(
        await calendarRoute.POST(req("http://localhost/api/ai/calendar", "POST", { clientId: CLIENT_ID, month: "2030-03", count: 1 }) as never)
      );
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.model;
    },
  },
  {
    name: "POST /api/ai/calendar/regenerate (nova ideia)",
    kinds: ["calendar"],
    run: async () => {
      state.aiText = JSON.stringify({ theme: "Outra", format: "feed", explanation: "Por quê." });
      const r = await json(
        await regenerateRoute.POST(
          req("http://localhost/api/ai/calendar/regenerate", "POST", { clientId: CLIENT_ID, targets: ["instagram"] }) as never
        )
      );
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.model;
    },
  },
  {
    name: "POST /api/ai/assistant (assistente)",
    kinds: ["caption"],
    run: async () => {
      state.aiText = JSON.stringify({ reply: "Sugestão." });
      const r = await json(
        await assistantRoute.POST(
          req("http://localhost/api/ai/assistant", "POST", { clientId: CLIENT_ID, messages: [{ role: "user", content: "Ideias?" }] }) as never
        )
      );
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.model;
    },
  },
  {
    name: "POST /api/art-templates/generate-month (títulos + legendas das artes-base)",
    kinds: ["calendar", "caption"],
    run: async () => {
      state.aiText = JSON.stringify({ titles: ["Título"], shared: "Legenda." });
      const r = await json(
        await generateMonthRoute.POST(
          req("http://localhost/api/art-templates/generate-month", "POST", {
            month: "2030-03",
            baseImageUrl: "https://example.com/base.png",
            count: 1,
          }) as never
        )
      );
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return undefined;
    },
  },
  {
    name: "lib/daily-summary generateDailySummary (resumo do Dashboard)",
    kinds: ["caption"],
    run: async () => {
      state.aiText = "Resumo do dia.";
      await generateDailySummary("2027-03-01");
      return undefined;
    },
  },
  {
    name: "lib/weekly generateWeekContent (revisão semanal)",
    kinds: ["calendar"],
    run: async () => {
      state.aiText = JSON.stringify({ posts: [{ id: "p1", shared: "Legenda." }] });
      assert.equal(await generateWeekContent(CLIENT_ID, ["p1"]), 1);
      return undefined;
    },
  },
  {
    name: "lib/calendar-captions generateCaptionBatch (legendas do cronograma)",
    kinds: ["calendar"],
    run: async () => {
      state.aiText = JSON.stringify({ posts: [{ id: "p1", shared: "Legenda." }] });
      const out = await generateCaptionBatch({ name: CLIENT_NAME, toneOfVoice: null }, [
        { id: "p1", theme: "Tema", format: "feed", targets: ["instagram"] },
      ]);
      assert.equal(out.length, 1);
      return undefined;
    },
  },
  {
    name: "lib/basic-plan genTemplateCaptions (legendas padronizadas)",
    kinds: ["caption"],
    run: async () => {
      state.aiText = JSON.stringify({ shared: "Legenda." });
      assert.equal((await genTemplateCaptions("Tema")).shared, "Legenda.");
      return undefined;
    },
  },
  {
    name: "lib/art-gen generateArt (imagem + verificação de texto da arte)",
    kinds: ["caption"],
    image: true,
    run: async () => {
      state.aiText = JSON.stringify({ ok: true, problemas: [] });
      const art = await generateArt({ templateUrl: "https://example.com/base.png", theme: "Tema" });
      assert.ok(art.buffer.length > 0);
      return undefined;
    },
  },
];

describe("todos os caminhos de texto usam o modelo resolvido; a imagem nunca muda", () => {
  beforeEach(reset);

  for (const p of TEXT_PATHS) {
    test(`${p.name}: sem configuração = modelo de antes; com configuração = o escolhido`, async () => {
      // 1) sem configuração: o modelo de antes, por função
      state.calls = [];
      const modelBefore = await p.run();
      const textBefore = state.calls.filter((c) => !c.image).map((c) => c.model);
      assert.deepEqual(textBefore, p.kinds.map((k) => DEFAULTS[k]));
      if (modelBefore !== undefined) assert.equal(modelBefore, DEFAULTS[p.kinds[0]], "campo model da resposta");

      // 2) configuração salva: o escolhido em todas as chamadas de texto
      saveDirect({ provider: "google", model: "gemini-3.8-flash" });
      state.calls = [];
      const modelAfter = await p.run();
      const textAfter = state.calls.filter((c) => !c.image).map((c) => c.model);
      assert.deepEqual(textAfter, p.kinds.map(() => "gemini-3.8-flash"));
      if (modelAfter !== undefined) assert.equal(modelAfter, "gemini-3.8-flash", "campo model da resposta");

      // imagem: sempre o IMAGE_MODEL, com e sem configuração
      if (p.image) {
        const images = state.calls.filter((c) => c.image);
        assert.equal(images.length, 1);
        assert.equal(images[0].model, IMAGE_MODEL);
        assert.equal(IMAGE_MODEL, "gemini-3-pro-image");
      }
    });

    test(`${p.name}: com ChatGPT (chave salva) = OpenAI${p.image ? " — menos o verificador da arte, que fica no Gemini" : ""}`, async () => {
      saveDirect({ provider: "openai", model: "gpt-5-mini" });
      saveOpenAiKeyDirect();
      state.calls = [];
      const modelAfter = await p.run();
      const text = state.calls.filter((c) => !c.image);
      if (p.image) {
        // verificação de texto da arte (recebe imagem): sempre Gemini, com o modelo padrão
        assert.deepEqual(text, [{ model: DEFAULTS.caption, image: false, provider: "google" }]);
        assert.deepEqual(state.calls.filter((c) => c.image).map((c) => c.model), [IMAGE_MODEL]);
      } else {
        assert.deepEqual(text, p.kinds.map(() => ({ model: "gpt-5-mini", image: false, provider: "openai" })));
      }
      if (modelAfter !== undefined) assert.equal(modelAfter, "gpt-5-mini", "campo model da resposta");
    });
  }

  test("log do servidor: função, modelo e tempo de cada geração, sem dado do cliente", async () => {
    saveDirect({ provider: "google", model: "gemini-3.7-flash" });
    const before = logs.info.length;
    await TEXT_PATHS[0].run();
    const line = logs.info.slice(before).find((l) => l.startsWith("[ia-texto]"));
    assert.ok(line, "sem log [ia-texto]");
    assert.match(line!, /^\[ia-texto\] legenda provedor=google modelo=gemini-3\.7-flash \d+ms ok$/);
    assert.doesNotMatch(line!, /ZZ QA|Tema|Legenda/);
  });
});

describe("varredura de src/: nenhum caminho de texto fora do getTextModel", () => {
  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) return d.name === "generated" ? [] : walk(full);
      return /\.(ts|tsx)$/.test(d.name) ? [full] : [];
    });
  }
  const files = walk(SRC).map((f) => ({ rel: path.relative(SRC, f).split(path.sep).join("/"), text: fs.readFileSync(f, "utf8") }));

  test("CAPTION_MODEL / CALENDAR_MODEL não existem mais em src/ (a fonte única é lib/ai-models)", () => {
    const hits = files.filter((f) => /\b(CAPTION_MODEL|CALENDAR_MODEL)\b/.test(f.text)).map((f) => f.rel);
    assert.deepEqual(hits, []);
  });

  test("todo arquivo que chama a IA está na lista coberta acima (e passa pelo roteador ou pelo modelo resolvido)", () => {
    const ADAPTERS = ["lib/gemini.ts", "lib/openai.ts", "lib/ai-text.ts"];
    const callers = files
      .filter(
        (f) =>
          !ADAPTERS.includes(f.rel) &&
          /\b(generateText|geminiFetch|generateAiText|generateOpenAiText|openaiGenerateText|requestOpenAiText)\(/.test(f.text)
      )
      .map((f) => f.rel)
      .sort();
    assert.deepEqual(callers, [
      "app/api/ai/assistant/route.ts",
      "app/api/ai/calendar/regenerate/route.ts",
      "app/api/ai/calendar/route.ts",
      "app/api/ai/caption/route.ts",
      "app/api/art-templates/generate-month/route.ts",
      "app/api/settings/ai-model/test/route.ts",
      "lib/art-gen.ts",
      "lib/basic-plan.ts",
      "lib/calendar-captions.ts",
      "lib/daily-summary.ts",
      "lib/weekly.ts",
    ]);
    for (const rel of callers) {
      const text = files.find((f) => f.rel === rel)!.text;
      // ninguém fora dos adaptadores chama o Gemini de texto direto, só pelo roteador (generateAiText)
      assert.doesNotMatch(text, /\bgenerateText\(/, `${rel} chama generateText direto`);
      if (rel === "lib/art-gen.ts") {
        // imagem (IMAGE_MODEL) + verificador de texto da arte: sempre Gemini
        assert.match(text, /getGeminiTextModel\(/);
        continue;
      }
      if (rel === "app/api/ai/assistant/route.ts") {
        // conversa: Gemini no formato próprio (geminiFetch) ou OpenAI pelo adaptador, conforme getTextModel
        assert.match(text, /getTextModel\(/);
        assert.match(text, /generateOpenAiText\(/);
        continue;
      }
      assert.match(text, /generateAiText\(/, `${rel} não usa generateAiText`);
      assert.doesNotMatch(text, /geminiFetch\(/, `${rel} chama o Gemini direto`);
    }
  });
});

// ------------------------------------------------------------ rotas de configuração

describe("GET/PUT /api/settings/ai-model (só administradores)", () => {
  beforeEach(reset);

  test("401 sem sessão e 403 para equipe não-admin, em pt-BR; nada gravado", async () => {
    state.session = null;
    let r = await json(await settingsRoute.GET());
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "Sua sessão expirou. Entre de novo.");
    state.session = STAFF;
    r = await json(await settingsRoute.GET());
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "Acesso restrito a administradores");
    r = await json(await settingsRoute.PUT(req("http://localhost/api/settings/ai-model", "PUT", { model: "gemini-3.8-flash" })));
    assert.equal(r.status, 403);
    assert.equal(state.upserts, 0);
  });

  test("GET admin: padrão do sistema quando não há nada salvo", async () => {
    const r = await json(await settingsRoute.GET());
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { available: true, setting: null, updatedAt: null, updatedByName: null, system: DEFAULTS });
  });

  test("PUT salva, registra quem salvou e vale na hora (cache invalidado)", async () => {
    // aquece o cache com o padrão
    assert.equal((await getTextModel("caption")).model, DEFAULTS.caption);
    const r = await json(
      await settingsRoute.PUT(req("http://localhost/api/settings/ai-model", "PUT", { provider: "google", model: " Gemini-3.8-Flash " }))
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.label, "Gemini 3.8 Flash (gemini-3.8-flash)");
    assert.deepEqual(r.body.setting, { provider: "google", model: "gemini-3.8-flash" });
    assert.equal(r.body.updatedByName, "ZZ QA F12 Admin");
    assert.equal(typeof r.body.updatedAt, "string");
    const row = state.settings.get(TEXT_MODEL_KEY)!;
    assert.deepEqual(row.value, { provider: "google", model: "gemini-3.8-flash" });
    assert.equal(row.updatedBy, ADMIN_ID);
    assert.equal((await getTextModel("caption")).model, "gemini-3.8-flash");
    assert.equal((await getTextModel("calendar")).model, "gemini-3.8-flash");

    // voltar ao padrão do sistema
    const back = await json(await settingsRoute.PUT(req("http://localhost/api/settings/ai-model", "PUT", { provider: "google", model: null })));
    assert.equal(back.status, 200);
    assert.equal(back.body.label, "Padrão do sistema");
    assert.deepEqual(state.settings.get(TEXT_MODEL_KEY)!.value, { provider: "google", model: null });
    assert.equal((await getTextModel("caption")).model, DEFAULTS.caption);
    assert.equal((await getTextModel("calendar")).model, DEFAULTS.calendar);
  });

  test("ID digitado (Outro) fora da lista é aceito se for um ID válido", async () => {
    const r = await json(await settingsRoute.PUT(req("http://localhost/api/settings/ai-model", "PUT", { model: "gemini-2.5-flash-lite" })));
    assert.equal(r.status, 200);
    assert.equal(r.body.label, "gemini-2.5-flash-lite");
    assert.equal((await getTextModel("calendar")).model, "gemini-2.5-flash-lite");
  });

  test("400 em pt-BR: corpo inválido, ID com espaço e ChatGPT sem chave da OpenAI; nada gravado", async () => {
    const cases: [unknown, number, RegExp, string][] = [
      [null, 400, /^Escolha um modelo da lista/, "model"],
      [{ model: 42 }, 400, /^Escolha um modelo da lista/, "model"],
      [{ model: "gemini 3.8 flash" }, 400, /^ID de modelo inválido/, "model"],
      [{ model: "gemini/../x" }, 400, /^ID de modelo inválido/, "model"],
      [{ provider: "openai", model: "gpt-4o-mini" }, 400, /^Configure a chave da OpenAI antes de usar o ChatGPT\.$/, "openaiKey"],
    ];
    for (const [body, status, re, field] of cases) {
      const r = await json(await settingsRoute.PUT(req("http://localhost/api/settings/ai-model", "PUT", body)));
      assert.equal(r.status, status, JSON.stringify(body));
      assert.equal(typeof r.body.error, "string");
      assert.match(r.body.error as string, re);
      assert.equal(r.body.field, field);
    }
    assert.equal(state.upserts, 0);
  });

  test("tabela ausente: GET avisa (available=false) e PUT responde 503 em pt-BR, sem quebrar", async () => {
    state.dbError = P2021;
    const g = await json(await settingsRoute.GET());
    assert.equal(g.status, 200);
    assert.equal(g.body.available, false);
    const r = await json(await settingsRoute.PUT(req("http://localhost/api/settings/ai-model", "PUT", { model: "gemini-3.8-flash" })));
    assert.equal(r.status, 503);
    assert.match(r.body.error as string, /ainda não está disponível neste servidor/);
  });
});

describe("POST /api/settings/ai-model/test (Testar modelo — não salva)", () => {
  beforeEach(reset);
  const url = "http://localhost/api/settings/ai-model/test";

  test("401/403 e 400 (ID inválido, ChatGPT sem chave) em pt-BR, sem chamar a IA", async () => {
    state.session = null;
    assert.equal((await testRoute.POST(req(url, "POST", { model: "gemini-3.8-flash" }))).status, 401);
    state.session = STAFF;
    assert.equal((await testRoute.POST(req(url, "POST", { model: "gemini-3.8-flash" }))).status, 403);
    state.session = ADMIN;
    let r = await json(await testRoute.POST(req(url, "POST", { model: "gemini 3" })));
    assert.equal(r.status, 400);
    assert.match(r.body.error as string, /^ID de modelo inválido/);
    r = await json(await testRoute.POST(req(url, "POST", { provider: "openai", model: "gpt-4o" })));
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "Configure a chave da OpenAI antes de usar o ChatGPT.");
    assert.equal(r.body.field, "openaiKey");
    assert.equal(state.calls.length, 0);
  });

  test("modelo responde: OK + tempo; nada é salvo", async () => {
    state.aiText = "OK";
    const r = await json(await testRoute.POST(req(url, "POST", { provider: "google", model: "gemini-3.8-flash" })));
    assert.equal(r.status, 200);
    const results = r.body.results as { model: string; label: string; ok: boolean; ms: number }[];
    assert.equal(results.length, 1);
    assert.equal(results[0].model, "gemini-3.8-flash");
    assert.equal(results[0].label, "Gemini 3.8 Flash (gemini-3.8-flash)");
    assert.equal(results[0].ok, true);
    assert.equal(typeof results[0].ms, "number");
    assert.deepEqual(state.calls, [{ model: "gemini-3.8-flash", image: false, provider: "google" }]);
    assert.equal(state.upserts, 0);
    assert.equal(state.settings.size, 0);
  });

  test("modelo inexistente (404 da IA): erro em pt-BR sem detalhe técnico", async () => {
    state.aiStatus = 404;
    const r = await json(await testRoute.POST(req(url, "POST", { model: "gemini-9.9-flash" })));
    assert.equal(r.status, 200);
    const [res] = r.body.results as { ok: boolean; error: string }[];
    assert.equal(res.ok, false);
    assert.equal(res.error, "Modelo não encontrado: confira o ID.");
    assert.doesNotMatch(JSON.stringify(r.body), /v1beta|not found|Gemini 404/);
  });

  test("“Padrão do sistema” (model null): testa os dois modelos do padrão", async () => {
    state.aiText = "OK";
    const r = await json(await testRoute.POST(req(url, "POST", { model: null })));
    assert.equal(r.status, 200);
    assert.deepEqual(
      (r.body.results as { model: string }[]).map((x) => x.model),
      [DEFAULTS.caption, DEFAULTS.calendar]
    );
  });

  test("limite simples: 7º teste seguido do mesmo IP → 429 em pt-BR", async () => {
    state.aiText = "OK";
    const fixed = "10.12.99.1";
    for (let i = 0; i < 6; i++) {
      assert.equal((await testRoute.POST(req(url, "POST", { model: "gemini-3.8-flash" }, fixed))).status, 200);
    }
    const r = await json(await testRoute.POST(req(url, "POST", { model: "gemini-3.8-flash" }, fixed)));
    assert.equal(r.status, 429);
    assert.match(r.body.error as string, /^Muitas requisições/);
  });
});

describe("logs da rodada inteira", () => {
  test("nenhum log contém a chave da OpenAI", () => {
    const all = [...logs.info, ...logs.warn, ...logs.error];
    assert.deepEqual(all.filter((l) => l.includes(OPENAI_KEY) || /sk-test|ZZQAf12/.test(l)), []);
    // e o log [ia-texto] da OpenAI tem provedor e modelo
    assert.ok(all.some((l) => /^\[ia-texto\] legenda provedor=openai modelo=gpt-5-mini \d+ms ok$/.test(l)));
  });
});
