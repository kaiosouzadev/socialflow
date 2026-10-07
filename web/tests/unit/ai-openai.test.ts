/**
 * F14-OPENAI (pedido do usuário em 07/10: "Já pode configurar o ChatGPT para eu configurar e
 * adicionar a API da openai"): ChatGPT como provedor de TEXTO na tela "Modelos de IA".
 *
 * Prova (sem rede: `fetch` falso; nenhuma chamada real à OpenAI nem ao Gemini):
 *   - adaptador lib/openai: URL/método/headers (Bearer só no header), corpo da Responses API
 *     (instructions/input/temperature/max_output_tokens/json_object/store:false), conversa,
 *     "json" garantido no pedido, temperature recusada → UMA repetição sem ela, retentativa em
 *     429/5xx (não em crédito/401), abort de fora não repete, timeout, extração do texto,
 *     erros saneados (sem a chave) e traduzidos em pt-BR;
 *   - chave: cifrada em app_settings (nunca em claro), decifra; GET/PUT/DELETE só devolvem a
 *     situação (configured/source/last4), nunca a chave; 401/403 não-admin; formato 400;
 *     sem TOKEN_ENC_KEY 503; fallback OPENAI_API_KEY; remover com ChatGPT em uso volta ao padrão;
 *   - salvar ChatGPT sem chave → 400 pt-BR; "Testar modelo" na OpenAI com a chave salva;
 *   - nenhuma resposta e nenhum log contém a chave.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const ADMIN_ID = "8f140000-0000-4000-8000-0000000000a1";
const KEY = `sk-test-ZZQAf14${"x".repeat(24)}WXYZ`;
const ENV_KEY = `sk-proj-ZZQAf14${"y".repeat(24)}AB12`;
const OPENAI_URL = "https://api.openai.com/v1/responses";

type SettingRow = { value: unknown; updatedAt: Date; updatedBy: string | null };
type FetchCall = { url: string; init: RequestInit; body: Record<string, unknown> };
type Handler = (call: FetchCall, signal: AbortSignal | null | undefined) => Promise<Response> | Response;

const state = {
  session: null as { user: { id?: string; email?: string; role?: string } } | null,
  settings: new Map<string, SettingRow>(),
  writes: 0,
  queue: [] as Handler[],
  calls: [] as FetchCall[],
};

const okText = (text: string) =>
  Response.json({
    id: "resp_zz",
    status: "completed",
    output: [
      { type: "reasoning", summary: [] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] },
    ],
  });
const apiErr = (status: number, code: string | null, message: string, param: string | null = null, type = "invalid_request_error") =>
  new Response(JSON.stringify({ error: { message, type, param, code } }), { status });

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  assert.ok(url.startsWith("https://api.openai.com/"), `rede real bloqueada no teste: ${url}`);
  const call = { url, init: init ?? {}, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> };
  state.calls.push(call);
  const handler = state.queue.shift() ?? (() => okText("OK"));
  return handler(call, init?.signal);
}) as typeof fetch;

const appSetting = {
  findUnique: async ({ where }: { where: { key: string } }) => {
    const row = state.settings.get(where.key);
    if (!row) return null;
    return { value: row.value, updatedAt: row.updatedAt, updater: row.updatedBy === ADMIN_ID ? { name: "ZZ QA F14 Admin" } : null };
  },
  upsert: async ({ where, create, update }: { where: { key: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
    state.writes++;
    const data = state.settings.has(where.key) ? update : create;
    state.settings.set(where.key, { value: structuredClone(data.value), updatedAt: new Date(), updatedBy: (data.updatedBy as string | null) ?? null });
    return {};
  },
  deleteMany: async ({ where }: { where: { key: string } }) => {
    state.writes++;
    const had = state.settings.delete(where.key);
    return { count: had ? 1 : 0 };
  },
};
const fakePrisma = {
  appSetting,
  user: { findUnique: async ({ where }: { where: { id?: string } }) => (where.id === ADMIN_ID ? { id: ADMIN_ID } : null) },
};

const logs: string[] = [];
for (const level of ["info", "warn", "error"] as const) {
  console[level] = (...a: unknown[]) => void logs.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : String(x))).join(" "));
}

const FAKE_MODULES: Record<string, string> = {
  "next/server": "export class NextRequest extends Request {} export class NextResponse extends Response {}",
  "@/auth": "export const auth = async () => globalThis.__f14.state.session;",
  "@/lib/prisma": "export const prisma = globalThis.__f14.prisma;",
};
type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
(globalThis as unknown as { __f14: unknown }).__f14 = { state, prisma: fakePrisma };
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

const ENC_KEY = randomBytes(32).toString("hex");
process.env.TOKEN_ENC_KEY = ENC_KEY;
process.env.GEMINI_API_KEY = "chave-ia-falsa";
delete process.env.OPENAI_API_KEY;

const openai = await import("../../src/lib/openai.ts");
const openaiKey = await import("../../src/lib/openai-key.ts");
const aiModels = await import("../../src/lib/ai-models.ts");
const { toUserMessage } = await import("../../src/lib/user-facing-error.ts");
const keyRoute = await import("../../src/app/api/settings/ai-model/openai-key/route.ts");
const modelRoute = await import("../../src/app/api/settings/ai-model/route.ts");
const testRoute = await import("../../src/app/api/settings/ai-model/test/route.ts");

const ADMIN = { user: { id: ADMIN_ID, email: "zzqa.f14.admin@example.com", role: "admin" } };
const STAFF = { user: { id: "8f140000-0000-4000-8000-0000000000b2", role: "staff" } };

function reset() {
  state.session = ADMIN;
  state.settings.clear();
  state.writes = 0;
  state.queue = [];
  state.calls = [];
  process.env.TOKEN_ENC_KEY = ENC_KEY;
  delete process.env.OPENAI_API_KEY;
  openai.resetOpenAiModelMemory();
  openaiKey.invalidateOpenAiKeyCache();
  aiModels.invalidateTextModelCache();
}

const base = { apiKey: KEY, model: "gpt-4.1-mini", prompt: "Pedido.", retryDelayMs: 0 };

let ip = 0;
function req(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": `10.14.0.${++ip}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function json(res: Response) {
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as Record<string, unknown> };
}
async function rejection(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error("esperava falha");
}

// ------------------------------------------------------------ adaptador

describe("lib/openai: pedido à Responses API", () => {
  beforeEach(reset);

  test("URL, método, Bearer só no header e corpo completo (json_object, store:false); texto da mensagem", async () => {
    state.queue.push(() => okText('{"shared":"Legenda"}'));
    const before = logs.length;
    const out = await openai.openaiGenerateText({
      ...base,
      system: "Sistema da agência.",
      prompt: "Responda em JSON.",
      temperature: 0.7,
      json: true,
      maxOutputTokens: 500,
      label: "legenda",
    });
    assert.equal(out, '{"shared":"Legenda"}');
    assert.equal(state.calls.length, 1);
    const [c] = state.calls;
    assert.equal(c.url, OPENAI_URL);
    assert.equal(c.init.method, "POST");
    const headers = c.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Bearer ${KEY}`);
    assert.equal(headers["Content-Type"], "application/json");
    assert.ok(!c.url.includes(KEY));
    assert.deepEqual(c.body, {
      model: "gpt-4.1-mini",
      input: "Responda em JSON.",
      instructions: "Sistema da agência.",
      temperature: 0.7,
      max_output_tokens: 500,
      text: { format: { type: "json_object" } },
      store: false,
    });
    const line = logs.slice(before).find((l) => l.startsWith("[ia-texto]"));
    assert.match(line ?? "", /^\[ia-texto\] legenda provedor=openai modelo=gpt-4\.1-mini \d+ms ok$/);
  });

  test("sem json: sem text.format; temperatura padrão 0.8; conversa vai como input de mensagens", async () => {
    await openai.openaiGenerateText({ ...base });
    assert.deepEqual(state.calls[0].body, { model: "gpt-4.1-mini", input: "Pedido.", temperature: 0.8, store: false });
    await openai.openaiGenerateText({
      ...base,
      prompt: undefined,
      messages: [
        { role: "user", content: "Oi" },
        { role: "assistant", content: "Olá" },
        { role: "user", content: "Ideias?" },
      ],
    });
    assert.deepEqual(state.calls[1].body.input, [
      { role: "user", content: "Oi" },
      { role: "assistant", content: "Olá" },
      { role: "user", content: "Ideias?" },
    ]);
  });

  test("json pedido sem a palavra JSON no texto: a instrução é acrescentada (exigência da OpenAI)", async () => {
    await openai.openaiGenerateText({ ...base, system: "Seja breve.", prompt: "Escreva a legenda.", json: true });
    assert.equal(state.calls[0].body.instructions, "Seja breve.\n\nResponda somente com JSON válido.");
  });

  test("temperature recusada → repete UMA vez sem ela; a próxima chamada do modelo já vai sem", async () => {
    state.queue.push(() => apiErr(400, "unsupported_parameter", "Unsupported parameter: 'temperature' is not supported with this model.", "temperature"));
    state.queue.push(() => okText("OK"));
    assert.equal(await openai.openaiGenerateText({ ...base, model: "gpt-5-mini", temperature: 0.9 }), "OK");
    assert.equal(state.calls.length, 2);
    assert.equal(state.calls[0].body.temperature, 0.9);
    assert.ok(!("temperature" in state.calls[1].body));
    await openai.openaiGenerateText({ ...base, model: "gpt-5-mini", temperature: 0.9 });
    assert.equal(state.calls.length, 3);
    assert.ok(!("temperature" in state.calls[2].body));

    // recusa de novo (outro motivo) → não entra em laço: falha
    state.calls = [];
    state.queue.push(() => apiErr(400, "unsupported_value", "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.", "temperature"));
    state.queue.push(() => apiErr(400, "invalid_value", "Invalid value for 'input'.", "input"));
    const e = await rejection(openai.openaiGenerateText({ ...base, model: "o4-mini", temperature: 0 }));
    assert.equal(state.calls.length, 2);
    assert.match(e.message, /^OpenAI 400 invalid_value/);
  });

  test("retentativas: 429 de limite e 5xx repetem 1×; crédito (insufficient_quota) e 401 não repetem", async () => {
    state.queue.push(() => apiErr(429, "rate_limit_exceeded", "Rate limit reached", null, "requests"));
    state.queue.push(() => okText("OK"));
    assert.equal(await openai.openaiGenerateText({ ...base }), "OK");
    assert.equal(state.calls.length, 2);

    state.calls = [];
    state.queue.push(() => new Response("upstream", { status: 503 }), () => new Response("upstream", { status: 500 }));
    const e5 = await rejection(openai.openaiGenerateText({ ...base }));
    assert.equal(state.calls.length, 2);
    assert.match(e5.message, /^OpenAI 500 /);

    state.calls = [];
    state.queue.push(() => apiErr(429, "insufficient_quota", "You exceeded your current quota", null, "insufficient_quota"));
    const eq = await rejection(openai.openaiGenerateText({ ...base }));
    assert.equal(state.calls.length, 1);
    assert.match(eq.message, /^OpenAI 429 insufficient_quota/);

    state.calls = [];
    state.queue.push(() => apiErr(401, "invalid_api_key", "Incorrect API key provided"));
    await rejection(openai.openaiGenerateText({ ...base }));
    assert.equal(state.calls.length, 1);
  });

  test("abort de fora: cancela a tentativa e NÃO repete; timeout repete e vira 'Tempo esgotado'", async () => {
    const hang: Handler = (_c, signal) =>
      new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })));
      });
    const ctrl = new AbortController();
    state.queue.push(hang, hang);
    setTimeout(() => ctrl.abort(), 20);
    const ea = await rejection(openai.openaiGenerateText({ ...base, signal: ctrl.signal }));
    assert.equal(ea.name, "AbortError");
    assert.equal(state.calls.length, 1);

    state.calls = [];
    state.queue.push(hang, hang);
    const et = await rejection(openai.openaiGenerateText({ ...base, timeoutMs: 15 }));
    assert.equal(state.calls.length, 2);
    assert.equal(et.name, "AbortError");
    assert.match(aiModels.describeModelTestError(et), /^Tempo esgotado/);

    // já cancelado antes de começar: nem chama
    state.calls = [];
    const pre = new AbortController();
    pre.abort();
    const ep = await rejection(openai.openaiGenerateText({ ...base, signal: pre.signal }));
    assert.equal(ep.name, "AbortError");
    assert.equal(state.calls.length, 0);
  });

  test("extração do texto: output_text, output[].content[] (pula raciocínio), formato antigo; vazio = erro", async () => {
    assert.equal(openai.extractOpenAiText({ output_text: "direto" }), "direto");
    assert.equal(
      openai.extractOpenAiText({
        output: [
          { type: "reasoning", content: [{ type: "output_text", text: "NÃO" }] },
          { type: "message", content: [{ type: "output_text", text: "A" }, { type: "output_text", text: "B" }] },
        ],
      }),
      "AB"
    );
    assert.equal(openai.extractOpenAiText({ choices: [{ message: { content: "antigo" } }] }), "antigo");
    assert.equal(openai.extractOpenAiText(null), "");
    state.queue.push(() => Response.json({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "reasoning" }] }));
    const e = await rejection(openai.openaiGenerateText({ ...base }));
    assert.equal(e.message, "OpenAI não retornou texto (max_output_tokens)");
  });

  test("erros traduzidos em pt-BR (tela e geração) e sem a chave na mensagem", async () => {
    const cases: [Handler, RegExp, RegExp][] = [
      [
        () => apiErr(401, "invalid_api_key", `Incorrect API key provided: sk-test-****WXYZ. You can find your API key at https://platform.openai.com/account/api-keys. ${KEY}`),
        /^Chave da OpenAI inválida/,
        /^A chave da OpenAI \(ChatGPT\) foi recusada/,
      ],
      [() => apiErr(404, "model_not_found", "The model `gpt-9` does not exist"), /^Modelo não encontrado: confira o ID\.$/, /^O modelo de IA escolhido não foi encontrado/],
      [() => apiErr(400, "model_not_found", "The requested model 'x' does not exist."), /^Modelo não encontrado: confira o ID\.$/, /^O modelo de IA escolhido não foi encontrado/],
      [() => apiErr(429, "insufficient_quota", "You exceeded your current quota", null, "insufficient_quota"), /^Sem créditos\/limite na OpenAI/, /sem créditos/],
      [() => apiErr(403, "unsupported_country_region_territory", "Country not supported"), /^Sem permissão para usar este modelo/, /^A inteligência artificial não respondeu/],
    ];
    for (const [handler, screen, user] of cases) {
      state.queue = [handler, handler];
      const e = await rejection(openai.openaiGenerateText({ ...base }));
      assert.ok(!e.message.includes(KEY), e.message);
      assert.doesNotMatch(e.message, /sk-test|sk-proj/);
      assert.match(aiModels.describeModelTestError(e), screen, e.message);
      assert.match(toUserMessage(e), user, e.message);
    }
    assert.equal(
      toUserMessage(new Error("Configure a chave da OpenAI antes de usar o ChatGPT.")),
      "A chave da OpenAI (ChatGPT) não está configurada. Avise o administrador do sistema."
    );
  });
});

// ------------------------------------------------------------ chave

describe("chave da OpenAI: cifrada, nunca devolvida, só admin", () => {
  beforeEach(reset);
  const url = "http://localhost/api/settings/ai-model/openai-key";
  const STATUS_KEYS = ["available", "canSave", "configured", "last4", "savedUnreadable", "source", "updatedAt", "updatedByName"];

  test("401 sem sessão e 403 equipe em GET/PUT/DELETE; nada gravado", async () => {
    for (const [session, status] of [[null, 401], [STAFF, 403]] as const) {
      state.session = session;
      assert.equal((await keyRoute.GET()).status, status);
      assert.equal((await keyRoute.PUT(req(url, "PUT", { key: KEY }))).status, status);
      assert.equal((await keyRoute.DELETE()).status, status);
    }
    assert.equal(state.writes, 0);
  });

  test("PUT cifra (nada em claro no banco), decifra para uso; respostas só com a situação", async () => {
    const r = await json(await keyRoute.PUT(req(url, "PUT", { key: `  ${KEY}  ` })));
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(Object.keys(r.body).sort(), STATUS_KEYS);
    assert.equal(r.body.configured, true);
    assert.equal(r.body.source, "saved");
    assert.equal(r.body.last4, "WXYZ");
    assert.equal(r.body.updatedByName, "ZZ QA F14 Admin");
    assert.ok(!r.text.includes(KEY) && !r.text.includes("ZZQAf14"), "resposta com a chave");

    const row = state.settings.get(openaiKey.OPENAI_KEY_SETTING)!;
    const stored = JSON.stringify(row.value);
    assert.ok(!stored.includes(KEY) && !stored.includes("ZZQAf14"), "chave em claro no banco");
    assert.equal((row.value as { last4: string }).last4, "WXYZ");
    assert.equal(row.updatedBy, ADMIN_ID);
    assert.equal(await openaiKey.getOpenAiKey(), KEY);

    const g = await json(await keyRoute.GET());
    assert.equal(g.status, 200);
    assert.ok(!g.text.includes(KEY) && !g.text.includes((row.value as { enc: string }).enc), "GET com a chave/cifra");
    assert.equal(g.body.last4, "WXYZ");
  });

  test("400 formato (pt-BR, com field) e 503 sem TOKEN_ENC_KEY; nada gravado", async () => {
    for (const body of [null, { key: 42 }, { key: "" }, { key: "chave errada" }, { key: "sk-curta" }, { key: `sk-${"a".repeat(20)} b` }]) {
      const r = await json(await keyRoute.PUT(req(url, "PUT", body)));
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(typeof r.body.error, "string");
      assert.equal(r.body.field, "key");
    }
    delete process.env.TOKEN_ENC_KEY;
    const r = await json(await keyRoute.PUT(req(url, "PUT", { key: KEY })));
    assert.equal(r.status, 503);
    assert.match(r.body.error as string, /chave de cifra do servidor/);
    assert.equal(state.writes, 0);
    const g = await json(await keyRoute.GET());
    assert.equal(g.body.canSave, false);
  });

  test("sem chave salva: OPENAI_API_KEY do ambiente vale, a tela vê 'env' sem final da chave", async () => {
    process.env.OPENAI_API_KEY = ENV_KEY;
    const g = await json(await keyRoute.GET());
    assert.equal(g.body.configured, true);
    assert.equal(g.body.source, "env");
    assert.equal(g.body.last4, null);
    assert.ok(!g.text.includes(ENV_KEY) && !g.text.includes("AB12"));
    assert.equal(await openaiKey.getOpenAiKey(), ENV_KEY);
    // a salva vence a do ambiente
    await openaiKey.saveOpenAiKey(KEY, ADMIN_ID);
    assert.equal(await openaiKey.getOpenAiKey(), KEY);
  });

  test("chave salva ilegível (TOKEN_ENC_KEY trocada): não lança, avisa a tela, usa o ambiente se houver", async () => {
    await openaiKey.saveOpenAiKey(KEY, ADMIN_ID);
    process.env.TOKEN_ENC_KEY = randomBytes(32).toString("hex");
    openaiKey.invalidateOpenAiKeyCache();
    assert.equal(await openaiKey.getOpenAiKey(), null);
    const g = await json(await keyRoute.GET());
    assert.equal(g.body.savedUnreadable, true);
    assert.equal(g.body.configured, false);
  });

  test("DELETE remove; com ChatGPT em uso e sem chave no ambiente, o modelo volta ao padrão", async () => {
    await openaiKey.saveOpenAiKey(KEY, ADMIN_ID);
    await aiModels.saveTextModelSetting({ provider: "openai", model: "gpt-5-mini" }, ADMIN_ID);
    const r = await json(await keyRoute.DELETE());
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.modelReset, true);
    assert.equal(r.body.configured, false);
    assert.equal(state.settings.has(openaiKey.OPENAI_KEY_SETTING), false);
    assert.deepEqual(state.settings.get(aiModels.TEXT_MODEL_KEY)!.value, { provider: "google", model: null });
    assert.deepEqual(await aiModels.getTextModel("caption"), { provider: "google", model: "gemini-2.5-flash" });
    // de novo: idempotente, sem trocar o modelo
    const again = await json(await keyRoute.DELETE());
    assert.equal(again.status, 200);
    assert.equal(again.body.modelReset, false);
  });
});

// ------------------------------------------------------------ salvar/testar ChatGPT

describe("salvar e testar um modelo do ChatGPT", () => {
  beforeEach(reset);

  test("salvar ChatGPT sem chave → 400 pt-BR (field openaiKey); com chave → vale na hora", async () => {
    const put = (body: unknown) => modelRoute.PUT(req("http://localhost/api/settings/ai-model", "PUT", body));
    let r = await json(await put({ provider: "openai", model: "gpt-5-mini" }));
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "Configure a chave da OpenAI antes de usar o ChatGPT.");
    assert.equal(r.body.field, "openaiKey");
    r = await json(await put({ provider: "openai", model: null }));
    assert.equal(r.status, 400);
    assert.equal(r.body.field, "model");
    for (const bad of ["gpt 5", "gpt/5", "gpt?5", "gpt#5", "gpt..5"]) {
      r = await json(await put({ provider: "openai", model: bad }));
      assert.equal(r.status, 400, bad);
      assert.match(r.body.error as string, /^ID de modelo inválido/);
    }
    assert.equal(state.writes, 0);

    await openaiKey.saveOpenAiKey(KEY, ADMIN_ID);
    r = await json(await put({ provider: "openai", model: " GPT-5-Mini " }));
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.label, "GPT-5 mini (gpt-5-mini)");
    assert.deepEqual(r.body.setting, { provider: "openai", model: "gpt-5-mini" });
    assert.deepEqual(await aiModels.getTextModel("calendar"), { provider: "openai", model: "gpt-5-mini" });
    assert.ok(!r.text.includes(KEY));
    // "Outro" com ID OpenAI comum
    r = await json(await put({ provider: "openai", model: "gpt-4o-2024-08-06" }));
    assert.equal(r.status, 200);
  });

  test("Testar modelo (OpenAI): usa a chave salva, OK + tempo, não salva; 401 → pt-BR sem a chave", async () => {
    const url = "http://localhost/api/settings/ai-model/test";
    let r = await json(await testRoute.POST(req(url, "POST", { provider: "openai", model: "gpt-5-mini" })));
    assert.equal(r.status, 400);
    assert.equal(r.body.field, "openaiKey");
    assert.equal(state.calls.length, 0);

    await openaiKey.saveOpenAiKey(KEY, ADMIN_ID);
    const writes = state.writes;
    state.queue.push(() => okText("OK"));
    r = await json(await testRoute.POST(req(url, "POST", { provider: "openai", model: "gpt-5-mini" })));
    assert.equal(r.status, 200, r.text);
    const [res] = r.body.results as { model: string; label: string; ok: boolean; ms: number }[];
    assert.deepEqual([res.model, res.label, res.ok, typeof res.ms], ["gpt-5-mini", "GPT-5 mini (gpt-5-mini)", true, "number"]);
    assert.equal((state.calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
    assert.equal(state.writes, writes, "o teste salvou algo");

    state.queue.push(() => apiErr(401, "invalid_api_key", `Incorrect API key provided: ${KEY}`));
    r = await json(await testRoute.POST(req(url, "POST", { provider: "openai", model: "gpt-5-mini" })));
    const [bad] = r.body.results as { ok: boolean; error: string }[];
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "Chave da OpenAI inválida: confira a chave salva.");
    assert.ok(!r.text.includes(KEY) && !r.text.includes("sk-test"));
  });

  test("nenhum log deste arquivo contém a chave (inteira ou o começo)", () => {
    const leaked = logs.filter((l) => l.includes(KEY) || l.includes(ENV_KEY) || /sk-test|sk-proj|ZZQAf14/.test(l));
    assert.deepEqual(leaked, []);
  });
});
