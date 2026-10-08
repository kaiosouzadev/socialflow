/**
 * F8-HASHTAGS (pedido do usuário em 07/10): em TODO caminho que gera legenda por IA, as
 * hashtags fixas do cliente (briefing.hashtags) terminam a legenda — FB/IG ("shared") e
 * LinkedIn — sem duplicar com hashtags da IA; e o resto do briefing entra no prompt.
 * Sem briefing, o comportamento é o de antes (prompt e legendas iguais).
 *
 * Caminhos: POST /api/ai/caption, generateWeekContent (lib/weekly + lib/caption-batch),
 * scheduleBasicMonth (lib/basic-plan) e o assistente (POST /api/ai/assistant). A regeneração
 * no link mensal (/api/aprovar/...) deixou de existir (F10): lá só se prova a recusa.
 *
 * Técnica do marca-grupo-coletivo.test.ts: hooks de módulo resolvem "@/" para os fontes e
 * trocam Prisma, sessão, avisos e Drive/R2/arte por versões falsas; lib/gemini roda de verdade
 * sobre um `fetch` falso que captura o pedido à IA — nenhuma IA nem rede reais.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const CLIENT_ID = "8f800000-0000-4000-8000-000000000001";
const TOKEN = "token-falso-zzqa-f8";

const BRIEFING = {
  products: "Pizzas artesanais e calzones",
  audience: "Famílias da zona sul",
  restrictions: "Nada de bebida alcoólica",
  mandatoryArtText: "Peça pelo app",
  hashtags: "  #PizzariaZZQA #ZonaSul\r\n#FornoALenha \r\n",
  observations: "",
  plan: 42,
};
const BLOCK = "#PizzariaZZQA #ZonaSul\n#FornoALenha";
const count = (s: string, sub: string) => s.split(sub).length - 1;

// ------------------------------------------------------------ banco e IA falsos

type Row = Record<string, unknown>;
const state = {
  client: null as Row | null,
  schedule: null as Row | null,
  post: null as Row | null,
  posts: [] as Row[],
  templates: [] as Row[],
  updates: [] as { model: string; where: Row; data: Row }[],
  creates: [] as { model: string; data: Row }[],
  aiText: "",
  sent: [] as { url: string; body: Row }[],
};

function reset(briefing: unknown) {
  state.client = {
    id: CLIENT_ID,
    name: "ZZ QA F8 Pizzaria",
    toneOfVoice: "descontraído",
    briefing,
    tier: "basica",
    socialAccounts: [{ platform: "instagram" }, { platform: "facebook" }, { platform: "linkedin" }],
  };
  state.schedule = null;
  state.post = null;
  state.posts = [];
  state.templates = [];
  state.updates = [];
  state.creates = [];
  state.aiText = "";
  state.sent = [];
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\//, `rede real bloqueada no teste: ${url}`);
  state.sent.push({ url, body: JSON.parse(String(init?.body)) });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: state.aiText }] } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

/** prompt (contents) e system do último pedido à IA */
function lastAi(): { prompt: string; system: string } {
  const body = state.sent.at(-1)?.body as
    | { contents: { parts: { text: string }[] }[]; systemInstruction?: { parts: { text: string }[] } }
    | undefined;
  assert.ok(body, "nenhuma chamada à IA");
  return {
    prompt: body.contents.map((c) => c.parts.map((p) => p.text).join("")).join("\n"),
    system: body.systemInstruction?.parts.map((p) => p.text).join("") ?? "",
  };
}

const fakePrisma = {
  client: { findUnique: async () => state.client },
  schedule: {
    findUnique: async () => state.schedule,
    findFirst: async () => ({ id: "sch-1" }),
    create: async ({ data }: { data: Row }) => {
      state.creates.push({ model: "schedule", data });
      return { id: "sch-1" };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      state.updates.push({ model: "schedule", where, data });
      return {};
    },
  },
  post: {
    findFirst: async () => state.post,
    findMany: async ({ where }: { where: { id?: { in: string[] }; artTemplateId?: unknown } }) =>
      where.artTemplateId ? [] : state.posts.filter((p) => where.id?.in.includes(p.id as string)),
    update: async ({ where, data }: { where: Row; data: Row }) => {
      state.updates.push({ model: "post", where, data });
      return { aiEditsUsed: 1 };
    },
    create: async ({ data }: { data: Row }) => {
      state.creates.push({ model: "post", data });
      return { id: `novo-${state.creates.length}` };
    },
  },
  artTemplate: {
    findMany: async () => state.templates,
    update: async ({ where, data }: { where: Row; data: Row }) => {
      state.updates.push({ model: "artTemplate", where, data });
      return {};
    },
  },
};

// ------------------------------------------------------------ hooks de módulo

const BLOCKED = (what: string) => `async () => { throw new Error('${what} bloqueado no teste'); }`;
const FAKE_MODULES: Record<string, string> = {
  "next/server": "export class NextRequest extends Request {} export class NextResponse extends Response {}",
  "@/auth": "export const auth = async () => ({ user: { id: '00000000-0000-4000-8000-0000000000a5', role: 'staff' } });",
  "@/lib/prisma": "export const prisma = globalThis.__f8h.prisma;",
  "@/generated/prisma/client": "export const Prisma = {};",
  "@/lib/notify":
    "export const teamEmails = async () => []; export const raiseAlert = async () => ({ created: false });" +
    " export const notifyEmailHtml = () => ''; export const escapeHtml = (s) => s;",
  "@/lib/art-gen": `export const generateArt = ${BLOCKED("arte")};`,
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

(globalThis as unknown as { __f8h: unknown }).__f8h = { prisma: fakePrisma };
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
const captionRoute = await import("../../src/app/api/ai/caption/route.ts");
const aprovarRoute = await import("../../src/app/api/aprovar/[token]/post/[postId]/route.ts");
const assistantRoute = await import("../../src/app/api/ai/assistant/route.ts");
const { generateWeekContent } = await import("../../src/lib/weekly.ts");
const { scheduleBasicMonth } = await import("../../src/lib/basic-plan.ts");
const { buildCaptionBatchPrompt, parseCaptionBatch } = await import("../../src/lib/caption-batch.ts");
const { briefingForPrompt } = await import("../../src/lib/client-briefing-prompt.ts");

const BRIEFING_TEXT = briefingForPrompt(BRIEFING)!;
const RULE = "NÃO inclua hashtags nas legendas: as hashtags fixas do cliente são adicionadas automaticamente no fim.";

let ip = 0;
const nextIp = () => `10.8.0.${++ip}`;
function jsonReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp() },
    body: JSON.stringify(body),
  });
}

/** legenda termina com o bloco, uma vez só, e sem as hashtags inventadas pela IA */
function assertEndsWithBlock(caption: unknown, label: string) {
  assert.equal(typeof caption, "string", label);
  const c = caption as string;
  assert.ok(c.endsWith(`\n\n${BLOCK}`), `${label}: não termina com o bloco → ${JSON.stringify(c)}`);
  assert.equal(count(c, "#PizzariaZZQA"), 1, `${label}: bloco duplicado`);
  assert.equal(count(c, "#ia"), 0, `${label}: sobrou hashtag da IA`);
}

// ------------------------------------------------------------ POST /api/ai/caption

describe("POST /api/ai/caption (botão Gerar legenda / Substituir no calendário)", () => {
  async function gen(targets: string[], format = "feed") {
    const res = await captionRoute.POST(
      jsonReq("http://localhost/api/ai/caption", { clientId: CLIENT_ID, theme: "Dia da Pizza", targets, format }) as never
    );
    return { status: res.status, json: (await res.json()) as { captions: Record<string, string>; slides?: string[] } };
  }

  test("cliente COM hashtags: FB/IG e LinkedIn terminam com o bloco; prompt com briefing e sem pedir hashtags", async () => {
    reset(BRIEFING);
    state.aiText = JSON.stringify({ shared: "Texto do post.\n\n#ia1 #ia2 #ia3", linkedin: "Texto LinkedIn.\n#ia4" });
    const r = await gen(["instagram", "facebook", "linkedin"]);
    assert.equal(r.status, 200);
    assert.equal(r.json.captions.instagram, `Texto do post.\n\n${BLOCK}`);
    assert.equal(r.json.captions.facebook, r.json.captions.instagram);
    assert.equal(r.json.captions.linkedin, `Texto LinkedIn.\n\n${BLOCK}`);
    for (const k of ["instagram", "facebook", "linkedin"]) assertEndsWithBlock(r.json.captions[k], k);

    const { prompt } = lastAi();
    assert.ok(prompt.includes(BRIEFING_TEXT), "briefing fora do prompt");
    assert.ok(prompt.includes(RULE));
    assert.match(prompt, /"shared": legenda ÚNICA .*SEM hashtags/);
    assert.match(prompt, /"linkedin": .*SEM hashtags/);
    assert.doesNotMatch(prompt, /3-6 hashtags|hashtags discretas|#PizzariaZZQA/);
  });

  test("IA já devolve o bloco no fim: não duplica", async () => {
    reset(BRIEFING);
    state.aiText = JSON.stringify({ shared: `Texto.\n\n${BLOCK}` });
    const r = await gen(["instagram"]);
    assert.equal(r.json.captions.instagram, `Texto.\n\n${BLOCK}`);
  });

  test("cliente SEM briefing: prompt e legendas como antes", async () => {
    reset(null);
    state.aiText = JSON.stringify({ shared: "  Texto do post.\n\n#ia1 #ia2  ", linkedin: "Texto LinkedIn. #ia3" });
    const r = await gen(["instagram", "facebook", "linkedin"]);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.captions, {
      instagram: "Texto do post.\n\n#ia1 #ia2",
      facebook: "Texto do post.\n\n#ia1 #ia2",
      linkedin: "Texto LinkedIn. #ia3",
    });
    const { prompt } = lastAi();
    assert.match(prompt, /3-6 hashtags relevantes no final/);
    assert.match(prompt, /hashtags discretas/);
    assert.doesNotMatch(prompt, /Briefing do cliente|Regras do cliente|NÃO inclua hashtags|SEM hashtags/);
  });

  test("briefing sem hashtags: briefing no prompt, hashtags da IA mantidas", async () => {
    reset({ products: "Pizzas", hashtags: "   " });
    state.aiText = JSON.stringify({ shared: "Texto.\n\n#ia1" });
    const r = await gen(["instagram"]);
    assert.equal(r.json.captions.instagram, "Texto.\n\n#ia1");
    const { prompt } = lastAi();
    assert.match(prompt, /- Produtos \/ serviços: Pizzas/);
    assert.match(prompt, /3-6 hashtags relevantes no final/);
    assert.doesNotMatch(prompt, /NÃO inclua hashtags/);
  });

  test("carrossel: slides não recebem hashtags", async () => {
    reset(BRIEFING);
    state.aiText = JSON.stringify({ shared: "Texto.", slides: ["Capa", "Fim"] });
    const r = await gen(["instagram"], "carrossel");
    assert.deepEqual(r.json.slides, ["Capa", "Fim"]);
    assertEndsWithBlock(r.json.captions.instagram, "instagram");
  });
});

// ------------------------------------------------------------ link de aprovação (regenerar)
// F10-LINK-MENSAL (decisão do usuário, 07/10): o link mensal não mostra nem regenera legenda —
// ela é revisada no link semanal. A regeneração por IA nesta rota deixou de existir; o que sobra
// para provar é a recusa (409 pt-BR) sem chamada à IA e sem gravar nada.

describe("POST /api/aprovar/[token]/post/[postId] action=regenerate (link mensal) → recusado", () => {
  function setup(briefing: unknown, targets: string[]) {
    reset(briefing);
    state.schedule = {
      id: "sch-1",
      status: "em_revisao",
      client: { name: "ZZ QA F8 Pizzaria", toneOfVoice: "descontraído", briefing },
    };
    state.post = {
      id: "p1",
      clientId: CLIENT_ID,
      status: "draft",
      theme: "Dia da Pizza",
      targets,
      captions: { instagram: "antiga", facebook: "antiga" },
      aiEditsUsed: 0,
    };
  }
  async function regen() {
    const res = await aprovarRoute.POST(
      jsonReq(`http://localhost/api/aprovar/${TOKEN}/post/p1`, { action: "regenerate", notes: "mais curto" }) as never,
      { params: Promise.resolve({ token: TOKEN, postId: "p1" }) }
    );
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  test("cliente COM hashtags: 409 pt-BR, 0 chamadas à IA, nada gravado, nenhuma legenda devolvida", async () => {
    setup(BRIEFING, ["instagram", "facebook", "linkedin"]);
    state.aiText = JSON.stringify({ shared: "Nova legenda.\n\n#ia1 #ia2", linkedin: "Nova LinkedIn.\n\n#ia3" });
    const r = await regen();
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, { error: "A legenda é revisada no link semanal." });
    assert.equal(state.sent.length, 0, "a IA não pode ser chamada");
    assert.equal(state.updates.length, 0);
    assert.equal(state.creates.length, 0);
  });

  test("cliente SEM briefing: mesma recusa, 0 chamadas à IA", async () => {
    setup(null, ["instagram", "facebook"]);
    state.aiText = JSON.stringify({ shared: "Nova legenda.\n\n#ia1 #ia2" });
    const r = await regen();
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "A legenda é revisada no link semanal.");
    assert.ok(!("captions" in r.json));
    assert.equal(state.sent.length, 0, "a IA não pode ser chamada");
    assert.equal(state.updates.length, 0);
  });
});

// ------------------------------------------------------------ lote semanal

const OLD_BATCH_SYSTEM =
  "Você é redator de social media de uma agência brasileira. Produz conteúdo final " +
  "pronto para publicação, em pt-BR, no tom de voz do cliente. Facebook e Instagram " +
  "usam SEMPRE a mesma legenda. Responda SOMENTE com JSON válido.";
/** prompt de generateWeekContent ANTES deste pacote (para provar "sem briefing = igual") */
const OLD_BATCH_PROMPT = [
  "Cliente: ZZ QA F8 Pizzaria.",
  "Tom de voz: descontraído.",
  "Para CADA post abaixo, gere:",
  '- "shared": legenda única FB+IG (envolvente, call-to-action, 3-6 hashtags, emojis moderados);',
  '- "linkedin": versão profissional (somente se fizer sentido; opcional);',
  '- "slides": SOMENTE para carrossel/reels — array de 5 a 8 textos curtos, um por tela, contando a história do post (primeiro = capa com gancho, último = call-to-action). Sem slides para formato feed/story.',
  "Posts:",
  '1. id="p1" formato=carrossel título="Bastidores" briefing="Mostrar o forno" (gerar slides)',
  '2. id="p2" formato=feed título="Promo"',
  'Responda em JSON: {"posts":[{"id":"<id>","shared":"...","linkedin":"...","slides":["..."]}]} — um item por post, na mesma ordem.',
].join("\n");

const WEEK_POSTS = () => [
  {
    id: "p1",
    theme: "Bastidores",
    explanation: "Mostrar o forno",
    format: "carrossel",
    targets: ["instagram", "facebook", "linkedin"],
    captions: null,
    slides: null,
  },
  { id: "p2", theme: "Promo", explanation: null, format: "feed", targets: ["instagram", "facebook"], captions: {}, slides: null },
];
const WEEK_AI = JSON.stringify({
  posts: [
    { id: "p1", shared: "Legenda 1.\n\n#ia1 #ia2", linkedin: "Pro 1. #inline", slides: [" Capa ", "Fim"] },
    { id: "p2", shared: "Legenda 2.\n#ia3" },
  ],
});
const postUpdate = (id: string) => state.updates.find((u) => u.model === "post" && u.where.id === id)?.data;

describe("generateWeekContent (legendas em lote quando o cronograma é aprovado)", () => {
  test("cliente COM hashtags: todas as legendas terminam com o bloco; slides intactos; prompt com briefing", async () => {
    reset(BRIEFING);
    state.posts = WEEK_POSTS();
    state.aiText = WEEK_AI;
    assert.equal(await generateWeekContent(CLIENT_ID, ["p1", "p2"]), 2);

    const p1 = postUpdate("p1")!;
    assert.deepEqual(p1.captions, {
      instagram: `Legenda 1.\n\n${BLOCK}`,
      facebook: `Legenda 1.\n\n${BLOCK}`,
      linkedin: `Pro 1. #inline\n\n${BLOCK}`,
    });
    assert.deepEqual(p1.slides, [{ text: "Capa" }, { text: "Fim" }]);
    const p2 = postUpdate("p2")!;
    assert.deepEqual(p2.captions, { instagram: `Legenda 2.\n\n${BLOCK}`, facebook: `Legenda 2.\n\n${BLOCK}` });
    assert.equal("slides" in p2, false);

    const { prompt, system } = lastAi();
    assert.equal(system, OLD_BATCH_SYSTEM);
    assert.ok(prompt.includes(BRIEFING_TEXT));
    assert.ok(prompt.includes(RULE));
    assert.match(prompt, /"shared": legenda única FB\+IG \(envolvente, call-to-action, SEM hashtags/);
    assert.doesNotMatch(prompt, /3-6 hashtags/);
  });

  test("cliente SEM briefing: prompt idêntico ao de antes e legendas da IA como vieram", async () => {
    reset(null);
    state.posts = WEEK_POSTS();
    state.aiText = WEEK_AI;
    assert.equal(await generateWeekContent(CLIENT_ID, ["p1", "p2"]), 2);
    const { prompt, system } = lastAi();
    assert.equal(system, OLD_BATCH_SYSTEM);
    assert.equal(prompt, OLD_BATCH_PROMPT);
    assert.deepEqual(postUpdate("p1")!.captions, {
      instagram: "Legenda 1.\n\n#ia1 #ia2",
      facebook: "Legenda 1.\n\n#ia1 #ia2",
      linkedin: "Pro 1. #inline",
    });
    assert.deepEqual(postUpdate("p2")!.captions, { instagram: "Legenda 2.\n#ia3", facebook: "Legenda 2.\n#ia3" });
  });
});

describe("lib/caption-batch (montagem e leitura do lote, reaproveitável)", () => {
  const items = [
    { id: "a", theme: "A", explanation: null, format: "feed" },
    { id: "b", theme: "B", explanation: null, format: "reels" },
    { id: "c", theme: "C", explanation: null, format: "feed" },
  ];

  test("buildCaptionBatchPrompt sem briefing = prompt antigo", () => {
    const { system, prompt } = buildCaptionBatchPrompt(
      { name: "ZZ QA F8 Pizzaria", toneOfVoice: "descontraído", briefing: null },
      WEEK_POSTS()
    );
    assert.equal(system, OLD_BATCH_SYSTEM);
    assert.equal(prompt, OLD_BATCH_PROMPT);
  });

  test("parseCaptionBatch: com ids na resposta casa SÓ por id, null sem 'shared', slides só em carrossel/reels, hashtags do cliente", () => {
    const raw = JSON.stringify({
      posts: [
        { id: "b", shared: "Legenda B.\n#ia", linkedin: "", slides: ["s1", "", 3, "s2"] },
        { shared: "Legenda sem id (posição 2)", slides: ["x"] },
        { id: "zzz", shared: "   " },
      ],
    });
    const out = parseCaptionBatch(raw, items, BRIEFING);
    // F9 gate F1: "a" não veio na resposta → null (nunca a legenda de outro post pela posição)
    assert.equal(out[0], null);
    assert.deepEqual(out[1], { shared: `Legenda B.\n\n${BLOCK}`, linkedin: "", slides: ["s1", "s2"] });
    assert.equal(out[2], null);

    const plain = parseCaptionBatch(raw, items, null);
    assert.equal(plain[1]?.shared, "Legenda B.\n#ia");
  });

  test("parseCaptionBatch: post do MEIO omitido → null, os outros com a própria legenda", () => {
    const raw = JSON.stringify({ posts: [{ id: "a", shared: "Legenda A" }, { id: "c", shared: "Legenda C" }] });
    const out = parseCaptionBatch(raw, items, null);
    assert.deepEqual(out.map((o) => o?.shared ?? null), ["Legenda A", null, "Legenda C"]);
  });

  test("parseCaptionBatch: posição só sem NENHUM id e com um item por post", () => {
    const same = JSON.stringify({ posts: [{ shared: "1" }, { shared: "2" }, { shared: "3" }] });
    assert.deepEqual(parseCaptionBatch(same, items, null).map((o) => o?.shared ?? null), ["1", "2", "3"]);
    const fewer = JSON.stringify({ posts: [{ shared: "1" }, { shared: "3" }] });
    assert.deepEqual(parseCaptionBatch(fewer, items, null), [null, null, null]);
  });

  test("parseCaptionBatch: resposta não-JSON lança (quem chama decide)", () => {
    assert.throws(() => parseCaptionBatch("sem json aqui", items, null));
  });
});

// ------------------------------------------------------------ plano básico

describe("scheduleBasicMonth (plano básico: legenda padronizada do template vira post do cliente)", () => {
  function setup(briefing: unknown) {
    reset(briefing);
    state.templates = [
      {
        id: "t1",
        name: "Dia da Pizza",
        day: 10,
        time: "18:00",
        captions: { shared: "Legenda genérica.\n\n#generica #template", linkedin: "LinkedIn genérico." },
      },
      { id: "t2", name: "Sem legenda ainda", day: 12, time: "19:00", captions: null },
    ];
    state.aiText = JSON.stringify({ shared: "Gerada.\n\n#ia1 #ia2", linkedin: "Gerada pro." });
  }
  const created = (tpl: string) =>
    state.creates.find((c) => c.model === "post" && c.data.artTemplateId === tpl)?.data.captions as Record<string, string>;

  test("cliente COM hashtags: posts com o bloco no lugar das hashtags genéricas; template continua genérico", async () => {
    setup(BRIEFING);
    const r = await scheduleBasicMonth(CLIENT_ID, "2099-03");
    assert.equal(r.scheduled, 2);
    assert.deepEqual(created("t1"), {
      instagram: `Legenda genérica.\n\n${BLOCK}`,
      facebook: `Legenda genérica.\n\n${BLOCK}`,
      linkedin: `LinkedIn genérico.\n\n${BLOCK}`,
    });
    assert.deepEqual(created("t2"), {
      instagram: `Gerada.\n\n${BLOCK}`,
      facebook: `Gerada.\n\n${BLOCK}`,
      linkedin: `Gerada pro.\n\n${BLOCK}`,
    });
    // a legenda padronizada (vale para vários clientes) é salva SEM o bloco deste cliente
    const tpl = state.updates.find((u) => u.model === "artTemplate");
    assert.deepEqual(tpl?.data.captions, { shared: "Gerada.\n\n#ia1 #ia2", linkedin: "Gerada pro." });
    // o prompt do template é genérico: nada do briefing de um cliente
    assert.doesNotMatch(lastAi().prompt, /Briefing do cliente|Pizzas artesanais|#PizzariaZZQA/);
  });

  test("cliente SEM briefing: posts com as legendas do template como estão", async () => {
    setup(null);
    const r = await scheduleBasicMonth(CLIENT_ID, "2099-03");
    assert.equal(r.scheduled, 2);
    assert.deepEqual(created("t1"), {
      instagram: "Legenda genérica.\n\n#generica #template",
      facebook: "Legenda genérica.\n\n#generica #template",
      linkedin: "LinkedIn genérico.",
    });
    assert.deepEqual(created("t2"), {
      instagram: "Gerada.\n\n#ia1 #ia2",
      facebook: "Gerada.\n\n#ia1 #ia2",
      linkedin: "Gerada pro.",
    });
  });
});

// ------------------------------------------------------------ assistente

describe("POST /api/ai/assistant (legenda sugerida pelo assistente)", () => {
  async function ask(content = "Reescreva a legenda") {
    const res = await assistantRoute.POST(
      jsonReq("http://localhost/api/ai/assistant", {
        clientId: CLIENT_ID,
        post: { theme: "Dia da Pizza", format: "feed", targets: ["instagram"] },
        messages: [{ role: "user", content }],
      }) as never
    );
    return { status: res.status, json: (await res.json()) as { reply: string; caption?: string } };
  }

  beforeEach(() => reset(null));

  test("cliente COM hashtags: caption termina com o bloco; system com briefing em texto e regra de hashtags", async () => {
    reset(BRIEFING);
    state.aiText = JSON.stringify({ reply: "Pronto!", caption: "Nova legenda!\n\n#ia1 #ia2" });
    const r = await ask();
    assert.equal(r.status, 200);
    assert.equal(r.json.caption, `Nova legenda!\n\n${BLOCK}`);
    assertEndsWithBlock(r.json.caption, "caption");

    const { system } = lastAi();
    assert.ok(system.includes(BRIEFING_TEXT));
    assert.ok(system.includes(`Hashtags fixas do cliente (o sistema as coloca automaticamente no fim de toda legenda):\n${BLOCK}`));
    assert.match(system, /- caption: .*SEM hashtags \(as hashtags fixas do cliente são adicionadas automaticamente no fim\)/);
    assert.doesNotMatch(system, /Briefing do cliente \(JSON\)|com hashtags quando fizer sentido/);
  });

  test("resposta sem caption: nada de legenda inventada só com o bloco", async () => {
    reset(BRIEFING);
    state.aiText = JSON.stringify({ reply: "Sugestão: use fotos do forno." });
    const r = await ask("Me dê uma ideia de arte");
    assert.equal(r.status, 200);
    assert.equal(r.json.caption, undefined);
  });

  test("cliente SEM briefing: caption como veio e regra antiga de hashtags", async () => {
    state.aiText = JSON.stringify({ reply: "Pronto!", caption: "Nova legenda!\n\n#ia1 #ia2" });
    const r = await ask();
    assert.equal(r.json.caption, "Nova legenda!\n\n#ia1 #ia2");
    const { system } = lastAi();
    assert.match(system, /com hashtags quando fizer sentido/);
    assert.doesNotMatch(system, /Briefing do cliente|Regras do cliente|Hashtags fixas|SEM hashtags/);
  });
});
