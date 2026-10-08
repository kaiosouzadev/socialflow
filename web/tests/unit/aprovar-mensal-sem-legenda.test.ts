/**
 * F10-LINK-MENSAL (decisão do usuário em 07/10: "Só tema e explicação"): o link MENSAL
 * (/aprovar/[token]) não mostra nem envia legenda ao navegador — o cliente revisa a legenda
 * completa no link SEMANAL. As legendas já existem nesta fase (geradas em segundo plano junto
 * com o cronograma), então:
 * - o `select` do link mensal não lê caption/captions/slides;
 * - o objeto que vai para o ApprovalView (payload RSC) é montado em lista branca;
 * - a API pública do link mensal recusa "edit" e "regenerate" (devolviam legenda) com 409 pt-BR,
 *   sem tocar no banco; "note" e "adjust" seguem funcionando.
 *
 * Técnica do aprovar-semana-guard.test.ts: hooks de módulo resolvem "@/" para os fontes e
 * trocam Prisma e avisos por versões falsas em memória (sem banco, sem rede, sem IA).
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const TOKEN = "token-falso-zzqa-f10";
const SCHEDULE_ID = "sch-f10";
const CLIENT_ID = "cli-f10";
// texto único: se aparecer em qualquer saída, a legenda vazou
const SECRET_CAPTION = "ZZQAF10-LEGENDA-UNICA-7c1e";
const SECRET_SLIDE = "ZZQAF10-SLIDE-UNICO-93ab";
const COMMENT = "Trocar o tema por algo sobre resultados do trimestre, por favor.";
const CAPTION_IN_WEEKLY = "A legenda é revisada no link semanal.";

// ------------------------------------------------------------ banco falso

type Row = Record<string, unknown>;
const state = {
  schedule: null as Row | null,
  post: null as Row | null,
  reads: 0,
  writes: [] as { model: string; data: Row }[],
  alerts: [] as Row[],
};

function reset() {
  state.schedule = {
    id: SCHEDULE_ID,
    status: "enviado_cliente",
    // enviado agora: dentro do prazo de 60 dias (OWASP-R3: ciclo de vida em links-publicos-ciclo)
    sentAt: new Date(),
    createdAt: new Date(),
    client: { name: "ZZ QA F10 Cliente", toneOfVoice: null, briefing: null },
  };
  state.post = {
    id: "p1",
    clientId: CLIENT_ID,
    scheduleId: SCHEDULE_ID,
    status: "draft",
    theme: "ZZ QA F10 Tema",
    targets: ["instagram", "facebook"],
    caption: SECRET_CAPTION,
    captions: { instagram: SECRET_CAPTION, facebook: SECRET_CAPTION },
    slides: [{ text: SECRET_SLIDE }],
    aiEditsUsed: 0,
  };
  state.reads = 0;
  state.writes = [];
  state.alerts = [];
}

const fakePrisma = {
  schedule: {
    findUnique: async ({ where }: { where: { approvalToken: string } }) => {
      state.reads++;
      return where.approvalToken === TOKEN ? state.schedule : null;
    },
    update: ({ data }: { data: Row }) => ({ model: "schedule", data }),
  },
  post: {
    findFirst: async ({ where }: { where: { id: string; scheduleId: string } }) => {
      state.reads++;
      const p = state.post;
      return p && p.id === where.id && p.scheduleId === where.scheduleId ? p : null;
    },
    update: ({ data }: { data: Row }) => ({ model: "post", data }),
  },
  postAdjustment: {
    create: ({ data }: { data: Row }) => ({ model: "postAdjustment", data }),
  },
  // as operações acima são "descrições"; a transação as grava e devolve o resultado de cada uma
  $transaction: async (ops: { model: string; data: Row }[]) =>
    ops.map((op) => {
      state.writes.push(op);
      return op.model === "postAdjustment"
        ? { id: "adj-1", comment: op.data.comment, status: "pendente", createdAt: new Date() }
        : { ok: true };
    }),
};

const fakeNotify = {
  teamEmails: async () => ["equipe@example.com"],
  raiseAlert: async (opts: Row) => {
    state.alerts.push(opts);
    return { created: true };
  },
  notifyEmailHtml: () => "",
  escapeHtml: (s: string) => s,
};

// ------------------------------------------------------------ hooks de módulo

const FAKE_MODULES: Record<string, string> = {
  "@/lib/prisma": "export const prisma = globalThis.__f10.prisma;",
  "@/generated/prisma/client": "export const Prisma = {};",
  "@/lib/notify":
    "const n = globalThis.__f10.notify;" +
    "export const teamEmails = n.teamEmails, raiseAlert = n.raiseAlert," +
    " notifyEmailHtml = n.notifyEmailHtml, escapeHtml = n.escapeHtml;",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __f10: unknown }).__f10 = { prisma: fakePrisma, notify: fakeNotify };
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

const { MONTHLY_POST_SELECT, toMonthlyApprovalPost, mediaItemsOf } = await import("../../src/lib/monthly-approval.ts");
const { POST } = await import("../../src/app/api/aprovar/[token]/post/[postId]/route.ts");

// ------------------------------------------------------------ helpers

let ip = 0;
async function call(body: Row, token = TOKEN): Promise<{ status: number; json: Row; raw: string }> {
  const req = new Request(`http://localhost/api/aprovar/${token}/post/p1`, {
    method: "POST",
    // IP próprio por chamada: o rate limit real (60/min por IP) não interfere
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.10.${++ip}` },
    body: JSON.stringify(body),
  });
  const res = await POST(req as unknown as Parameters<typeof POST>[0], {
    params: Promise.resolve({ token, postId: "p1" }),
  });
  const raw = await res.text();
  return { status: res.status, json: JSON.parse(raw) as Row, raw };
}

/** Linha como o banco a devolveria se ALGUÉM voltasse a pôr caption/captions/slides no select. */
function rowWithCaption(): Parameters<typeof toMonthlyApprovalPost>[0] & Row {
  return {
    id: "p1",
    theme: "ZZ QA F10 Tema",
    explanation: "Explicação do tema para o cliente.",
    format: "carrossel",
    mediaUrl: null,
    mediaItems: [{ url: "https://example.com/a.png", type: "image", driveId: "interno-123" }],
    targets: ["instagram", "facebook"],
    scheduledAt: new Date("2026-11-05T12:00:00.000Z"), // 09:00 em São Paulo
    clientNote: null,
    status: "draft",
    adjustments: [{ id: "a1", comment: COMMENT, status: "pendente", reply: null, internalNote: "só equipe" } as never],
    caption: SECRET_CAPTION,
    captions: { instagram: SECRET_CAPTION, facebook: SECRET_CAPTION },
    slides: [{ text: SECRET_SLIDE }],
  };
}

const ALLOWED_KEYS = [
  "adjustments",
  "clientNote",
  "day",
  "explanation",
  "format",
  "fullWhen",
  "id",
  "mediaItems",
  "mediaUrl",
  "targets",
  "theme",
  "time",
];

// ------------------------------------------------------------ payload do link mensal

describe("link mensal: o que vai para o navegador não tem legenda", () => {
  test("o select do link mensal não lê caption, captions nem slides", () => {
    const keys = Object.keys(MONTHLY_POST_SELECT);
    for (const k of ["caption", "captions", "slides"]) assert.ok(!keys.includes(k), `select inclui ${k}`);
    assert.doesNotMatch(JSON.stringify(MONTHLY_POST_SELECT), /caption|slides/i);
    // o que o cliente precisa ver continua lá
    for (const k of ["theme", "explanation", "format", "scheduledAt", "mediaUrl", "mediaItems", "targets"]) {
      assert.equal((MONTHLY_POST_SELECT as Row)[k], true, `select sem ${k}`);
    }
  });

  test("post montado em lista branca: mesmo com legenda/slides na linha, nada disso chega ao navegador", () => {
    const out = toMonthlyApprovalPost(rowWithCaption());
    assert.deepEqual(Object.keys(out).sort(), ALLOWED_KEYS);
    const json = JSON.stringify(out);
    assert.ok(!json.includes(SECRET_CAPTION), "legenda vazou no payload");
    assert.ok(!json.includes(SECRET_SLIDE), "slide vazou no payload");
    assert.ok(!json.includes("interno-123"), "id interno do Drive vazou");
    assert.ok(!json.includes("só equipe"), "campo extra do ajuste vazou");
    assert.ok(!/"status":"draft"/.test(json), "status do post vazou");
  });

  test("tema, explicação, data/hora e formato continuam no payload", () => {
    const out = toMonthlyApprovalPost(rowWithCaption());
    assert.equal(out.theme, "ZZ QA F10 Tema");
    assert.equal(out.explanation, "Explicação do tema para o cliente.");
    assert.equal(out.format, "carrossel");
    assert.equal(out.day, 5);
    assert.equal(out.time, "09:00");
    assert.match(out.fullWhen, /^Quinta-feira, 5 de novembro de 2026 · 09:00$/);
    assert.deepEqual(out.mediaItems, [{ url: "https://example.com/a.png", type: "image" }]);
    assert.deepEqual(out.adjustments, [{ id: "a1", comment: COMMENT, status: "pendente", reply: null }]);
  });

  test("tema/explicação vazios viram texto vazio (o card mostra nada, nunca a legenda)", () => {
    const out = toMonthlyApprovalPost({ ...rowWithCaption(), theme: null, explanation: null });
    assert.equal(out.theme, "");
    assert.equal(out.explanation, "");
    assert.ok(!JSON.stringify(out).includes(SECRET_CAPTION));
  });

  test("mediaItemsOf: só url + tipo; lista vazia ou inválida vira null", () => {
    assert.deepEqual(mediaItemsOf([{ url: "u1", id: "x" }, { nope: 1 }]), [{ url: "u1" }]);
    assert.equal(mediaItemsOf([]), null);
    assert.equal(mediaItemsOf({ url: "u1" }), null);
  });
});

// ------------------------------------------------------------ API pública do link mensal

describe("POST /api/aprovar/[token]/post/[postId] no link mensal", () => {
  beforeEach(() => reset());

  test('"edit" → 409 pt-BR, sem ler nem gravar no banco e sem devolver legenda', async () => {
    const r = await call({ action: "edit", captions: { instagram: "nova" } });
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, { error: CAPTION_IN_WEEKLY });
    assert.equal(state.reads, 0);
    assert.equal(state.writes.length, 0);
    assert.ok(!r.raw.includes(SECRET_CAPTION));
  });

  test('"regenerate" → 409 pt-BR, sem ler nem gravar no banco (e sem IA: o ramo não existe mais)', async () => {
    const r = await call({ action: "regenerate", notes: "mais curto" });
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, { error: CAPTION_IN_WEEKLY });
    assert.equal(state.reads, 0);
    assert.equal(state.writes.length, 0);
    assert.ok(!r.raw.includes(SECRET_CAPTION));
  });

  test('"edit" com corpo vazio também recusa (nada de legenda de volta)', async () => {
    const r = await call({ action: "edit" });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, CAPTION_IN_WEEKLY);
    assert.ok(!("captions" in r.json));
  });

  test('"note" continua: 200, grava a observação e não devolve legenda', async () => {
    const r = await call({ action: "note", clientNote: "Gostei do tema." });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, clientNote: "Gostei do tema." });
    assert.ok(!r.raw.includes(SECRET_CAPTION));
    const post = state.writes.find((w) => w.model === "post");
    assert.deepEqual(post?.data, { clientNote: "Gostei do tema." });
    // primeira mexida do cliente marca o cronograma em revisão
    assert.deepEqual(state.writes.find((w) => w.model === "schedule")?.data, { status: "em_revisao" });
  });

  test('"adjust" continua: 200, cria o ajuste, avisa a equipe e não devolve legenda', async () => {
    const r = await call({ action: "adjust", comment: COMMENT });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal((r.json.adjustment as Row).status, "pendente");
    assert.ok(!r.raw.includes(SECRET_CAPTION));
    assert.equal(state.alerts.length, 1);
    assert.equal(state.alerts[0].kind, "ajuste_solicitado");
  });

  test('"adjust" curto continua recusado com a mensagem de antes', async () => {
    const r = await call({ action: "adjust", comment: "curto" });
    assert.equal(r.status, 400);
    assert.match(String(r.json.error), /pelo menos 30 caracteres/);
    assert.equal(state.writes.length, 0);
  });
});
