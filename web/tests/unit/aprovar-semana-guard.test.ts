/**
 * P3-C1 / N-27: no link SEMANAL, post que o cliente JÁ APROVOU não aceita
 * pedido de ajuste (regra do usuário: "se aprovar o cliente não pode solicitar
 * ajustes"). O servidor responde 409 POST_ALREADY_APPROVED sem gravar nada.
 *
 * A rota usa o alias "@/" e o Prisma: como no doc-import-captions.test.ts,
 * hooks de módulo resolvem "@/" para os fontes e trocam Prisma e notify por
 * versões falsas em memória (sem rede e sem banco real). O `POST` da rota
 * roda de verdade, com rate-limit, publish-policy e zod reais.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const TOKEN = "token-falso-zzqa-pc1";
const REVIEW_ID = "rev-1";
const CLIENT_ID = "cli-1";
const COMMENT = "Trocar a foto da capa e corrigir o horário do evento, por favor.";

// ------------------------------------------------------------ banco falso

type Row = Record<string, unknown>;
const state = {
  review: null as Row | null,
  posts: [] as Row[],
  adjustments: [] as Row[],
  alerts: [] as Row[],
  writes: 0,
};

function reset(agencyPublishes = true) {
  state.review = {
    id: REVIEW_ID,
    token: TOKEN,
    clientId: CLIENT_ID,
    // link aberto e dentro do prazo de 60 dias (OWASP-R3: o ciclo de vida é provado em links-publicos-ciclo)
    status: "enviado",
    sentAt: new Date(),
    client: { name: "ZZ QA PC1", agencyPublishes },
  };
  state.posts = [];
  state.adjustments = [];
  state.alerts = [];
  state.writes = 0;
}

function addPost(id: string, status: string, clientApproval: string | null): Row {
  const row: Row = { id, theme: `Tema ${id}`, status, clientApproval, weeklyReviewId: REVIEW_ID };
  state.posts.push(row);
  return row;
}

function addAdjustment(postId: string, status: "pendente" | "resolvido") {
  state.adjustments.push({ id: `adj-${state.adjustments.length + 1}`, postId, comment: COMMENT, status });
}

const fakePrisma = {
  weeklyReview: {
    findUnique: async ({ where }: { where: { token: string } }) =>
      state.review?.token === where.token ? state.review : null,
  },
  post: {
    findFirst: async ({ where }: { where: { id: string; weeklyReviewId: string } }) => {
      const p = state.posts.find((x) => x.id === where.id && x.weeklyReviewId === where.weeklyReviewId);
      return p ? { id: p.id, theme: p.theme, status: p.status, clientApproval: p.clientApproval } : null;
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      const p = state.posts.find((x) => x.id === where.id);
      assert.ok(p, `post ${where.id} inexistente`);
      state.writes++;
      return Object.assign(p, data);
    },
  },
  postAdjustment: {
    count: async ({ where }: { where: { postId: string; status: string } }) =>
      state.adjustments.filter((a) => a.postId === where.postId && a.status === where.status).length,
    create: async ({ data }: { data: { postId: string; comment: string } }) => {
      const row: Row = { id: `adj-${state.adjustments.length + 1}`, status: "pendente", createdAt: new Date(), ...data };
      state.adjustments.push(row);
      state.writes++;
      return { id: row.id, comment: row.comment, status: row.status, createdAt: row.createdAt };
    },
  },
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
  "@/lib/prisma": "export const prisma = globalThis.__pc1.prisma;",
  "@/lib/notify":
    "const n = globalThis.__pc1.notify;" +
    "export const teamEmails = n.teamEmails, raiseAlert = n.raiseAlert," +
    " notifyEmailHtml = n.notifyEmailHtml, escapeHtml = n.escapeHtml;",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __pc1: unknown }).__pc1 = { prisma: fakePrisma, notify: fakeNotify };
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

const { POST } = await import("../../src/app/api/aprovar-semana/[token]/post/[postId]/route.ts");

// ------------------------------------------------------------ helpers

let ip = 0;
async function call(postId: string, body: Row): Promise<{ status: number; json: Row }> {
  const req = new Request(`http://localhost/api/aprovar-semana/${TOKEN}/post/${postId}`, {
    method: "POST",
    // IP próprio por chamada: o rate limit real (60/min por IP) não interfere
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++ip}` },
    body: JSON.stringify(body),
  });
  const res = await POST(req as unknown as Parameters<typeof POST>[0], {
    params: Promise.resolve({ token: TOKEN, postId }),
  });
  return { status: res.status, json: (await res.json()) as Row };
}

const snapshot = () => JSON.stringify({ posts: state.posts, adjustments: state.adjustments, alerts: state.alerts });

const ALREADY_APPROVED = {
  error: "Esta postagem já foi aprovada. Para mudar algo, fale com a agência.",
  code: "POST_ALREADY_APPROVED",
};

// ------------------------------------------------------------ testes

describe("ajuste em post já aprovado → 409 POST_ALREADY_APPROVED, nada gravado", () => {
  beforeEach(() => reset());

  test("post aprovado e agendado (scheduled): 409, continua scheduled + aprovado, 0 ajustes, 0 alertas", async () => {
    addPost("p1", "scheduled", "aprovado");
    const before = snapshot();
    const r = await call("p1", { action: "adjust", comment: COMMENT });
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, ALREADY_APPROVED);
    assert.equal(snapshot(), before);
    assert.equal(state.writes, 0);
    assert.equal(state.adjustments.length, 0);
    assert.equal(state.alerts.length, 0);
  });

  test("cliente só produção (aprovado e draft): 409 e nada muda", async () => {
    reset(false);
    addPost("p1", "draft", "aprovado");
    const before = snapshot();
    const r = await call("p1", { action: "adjust", comment: COMMENT });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "POST_ALREADY_APPROVED");
    assert.equal(snapshot(), before);
    assert.equal(state.writes, 0);
  });

  test("a recusa vem antes da validação do comentário (comentário curto também → 409)", async () => {
    addPost("p1", "scheduled", "aprovado");
    const r = await call("p1", { action: "adjust", comment: "curto" });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "POST_ALREADY_APPROVED");
    assert.equal(state.writes, 0);
  });
});

describe("comportamento mantido", () => {
  beforeEach(() => reset());

  test("ajuste em post não aprovado (draft) → 200, ajuste pendente + 1 alerta; post continua draft", async () => {
    addPost("p1", "draft", null);
    const r = await call("p1", { action: "adjust", comment: COMMENT });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal((r.json.adjustment as Row).status, "pendente");
    assert.equal(state.adjustments.length, 1);
    assert.equal(state.alerts.length, 1);
    assert.equal(state.alerts[0].kind, "ajuste_solicitado");
    assert.deepEqual(
      { status: state.posts[0].status, clientApproval: state.posts[0].clientApproval },
      { status: "draft", clientApproval: null }
    );
  });

  test("post agendado pela equipe sem aprovação do cliente → ajuste aceito e volta para draft", async () => {
    addPost("p1", "scheduled", null);
    const r = await call("p1", { action: "adjust", comment: COMMENT });
    assert.equal(r.status, 200);
    assert.equal(state.posts[0].status, "draft");
    assert.equal(state.posts[0].clientApproval, null);
    assert.equal(state.alerts.length, 1);
  });

  test("2º ajuste com outro ainda pendente continua aceito", async () => {
    addPost("p1", "draft", null);
    addAdjustment("p1", "pendente");
    const r = await call("p1", { action: "adjust", comment: COMMENT });
    assert.equal(r.status, 200);
    assert.equal(state.adjustments.filter((a) => a.status === "pendente").length, 2);
  });

  test("ajuste com menos de 30 caracteres em post não aprovado → 400", async () => {
    addPost("p1", "draft", null);
    const r = await call("p1", { action: "adjust", comment: "curto" });
    assert.equal(r.status, 400);
    assert.equal(state.writes, 0);
  });

  test("aprovar com ajuste pendente → 409 e nada muda", async () => {
    addPost("p1", "draft", null);
    addAdjustment("p1", "pendente");
    const before = snapshot();
    const r = await call("p1", { action: "approve" });
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "Há ajuste pendente neste post — aguarde a equipe concluir.");
    assert.equal(snapshot(), before);
  });

  test("aprovar post draft sem ajuste pendente → {ok, approved}; entra na fila (scheduled)", async () => {
    addPost("p1", "draft", null);
    addAdjustment("p1", "resolvido");
    const r = await call("p1", { action: "approve" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, approved: true });
    assert.equal(state.posts[0].status, "scheduled");
    assert.equal(state.posts[0].clientApproval, "aprovado");
  });

  test("post publicado ou em publicação → 409 'já foi publicado' (aprovado ou não)", async () => {
    addPost("p1", "published", "aprovado");
    addPost("p2", "publishing", null);
    for (const id of ["p1", "p2"]) {
      const r = await call(id, { action: "adjust", comment: COMMENT });
      assert.equal(r.status, 409);
      assert.equal(r.json.error, "Este post já foi publicado");
    }
    assert.equal(state.writes, 0);
  });

  test("token inválido → 404; post de outra semana → 404", async () => {
    addPost("p1", "draft", null);
    state.posts.push({ id: "p9", theme: "x", status: "draft", clientApproval: null, weeklyReviewId: "outra" });
    const req = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.1.${++ip}` },
      body: JSON.stringify({ action: "approve" }),
    });
    const bad = await POST(req as unknown as Parameters<typeof POST>[0], {
      params: Promise.resolve({ token: "outro-token", postId: "p1" }),
    });
    assert.equal(bad.status, 404);
    const other = await call("p9", { action: "approve" });
    assert.equal(other.status, 404);
  });
});
