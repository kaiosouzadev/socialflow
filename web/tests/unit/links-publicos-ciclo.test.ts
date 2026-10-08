/**
 * OWASP-R3 (AC-05 / CR-05 / CF-16 / AC-08) — ciclo de vida dos links públicos de aprovação.
 * Decisão do usuário (07/10): "Expirar após conclusão + 60 dias".
 * - mensal aprovado (aprovado_cliente/aprovado_interno) → só leitura: aprovar, pedir ajustes,
 *   ajuste e observação por post → 409 "Este cronograma já foi aprovado." sem gravar nada;
 * - 60 dias depois do envio (sent_at; sem sent_at → created_at) → 410 em toda ação;
 * - semanal concluído → 409; semanal antigo (300 dias, AC-05) não aprova mais post;
 * - post semanal já aprovado não volta para a fila por um link antigo;
 * - reenvio gera token NOVO (o antigo dá 404), renova sent_at e o e-mail leva o link novo;
 * - corpo das ações com teto de 32 KB (recusa por Content-Length sem ler; chunked para de ler);
 * - rate limit por link (qualquer IP) e por ajustes/hora; respostas com no-store e noindex.
 *
 * Técnica dos outros testes de rota: hooks de módulo resolvem "@/" para os fontes e trocam
 * Prisma, avisos, e-mail e sessão por versões falsas em memória (sem banco, sem rede, sem e-mail).
 */
import { beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const DAY = 86_400_000;
const COMMENT = "Trocar a foto da capa e corrigir o horário do evento, por favor.";
const SCHEDULE_ID = "6f1d3c2a-0000-4000-8000-0000000000a1";

// ------------------------------------------------------------ banco falso

type Row = Record<string, unknown>;
type Lazy<T> = PromiseLike<T> & { __run: () => Promise<T> };

const state = {
  schedules: [] as Row[],
  posts: [] as Row[],
  adjustments: [] as Row[],
  reviews: [] as Row[],
  alerts: [] as Row[],
  emails: [] as { to: string; subject: string; html: string }[],
  /** simula o provedor recusando e ecoando o conteúdo (com o link) no erro */
  emailFails: false,
  reads: 0,
  writes: [] as string[],
};

function reset() {
  state.schedules = [];
  state.posts = [];
  state.adjustments = [];
  state.reviews = [];
  state.alerts = [];
  state.emails = [];
  state.emailFails = false;
  state.reads = 0;
  state.writes = [];
}

/** Operação preguiçosa como a do Prisma: roda ao ser aguardada ou dentro de $transaction([...]). */
function lazy<T>(fn: () => T | Promise<T>): Lazy<T> {
  const run = async () => fn();
  return { __run: run, then: (ok, ko) => run().then(ok, ko) };
}

function matchStatus(row: Row, cond: unknown): boolean {
  if (cond === undefined) return true;
  if (typeof cond === "string") return row.status === cond;
  return ((cond as { in: string[] }).in ?? []).includes(row.status as string);
}

const fakePrisma = {
  schedule: {
    findUnique: async ({ where }: { where: { approvalToken?: string; id?: string } }) => {
      state.reads++;
      const s = state.schedules.find((x) =>
        where.approvalToken !== undefined ? x.approvalToken === where.approvalToken : x.id === where.id
      );
      if (!s) return null;
      return { ...s, _count: { posts: state.posts.filter((p) => p.scheduleId === s.id).length } };
    },
    update: ({ where, data }: { where: { id: string }; data: Row }) =>
      lazy(() => {
        const s = state.schedules.find((x) => x.id === where.id);
        assert.ok(s, "cronograma inexistente");
        state.writes.push(`schedule.update ${JSON.stringify(data)}`);
        return Object.assign(s, data);
      }),
    updateMany: ({ where, data }: { where: { id: string; approvalToken?: string; status?: unknown }; data: Row }) =>
      lazy(() => {
        const rows = state.schedules.filter(
          (x) =>
            x.id === where.id &&
            (where.approvalToken === undefined || x.approvalToken === where.approvalToken) &&
            matchStatus(x, where.status)
        );
        for (const r of rows) Object.assign(r, data);
        if (rows.length) state.writes.push(`schedule.updateMany ${JSON.stringify(data)}`);
        return { count: rows.length };
      }),
  },
  weeklyReview: {
    findUnique: async ({ where }: { where: { token: string } }) => {
      state.reads++;
      return state.reviews.find((r) => r.token === where.token) ?? null;
    },
  },
  post: {
    findFirst: async ({ where }: { where: { id: string; scheduleId?: string; weeklyReviewId?: string } }) => {
      state.reads++;
      return (
        state.posts.find(
          (p) =>
            p.id === where.id &&
            (where.scheduleId === undefined || p.scheduleId === where.scheduleId) &&
            (where.weeklyReviewId === undefined || p.weeklyReviewId === where.weeklyReviewId)
        ) ?? null
      );
    },
    update: ({ where, data }: { where: { id: string }; data: Row }) =>
      lazy(() => {
        const p = state.posts.find((x) => x.id === where.id);
        assert.ok(p, "post inexistente");
        state.writes.push(`post.update ${JSON.stringify(data)}`);
        return Object.assign(p, data);
      }),
    updateMany: ({ where, data }: { where: { scheduleId: string; status?: string }; data: Row }) =>
      lazy(() => {
        const rows = state.posts.filter((p) => p.scheduleId === where.scheduleId && matchStatus(p, where.status));
        for (const r of rows) Object.assign(r, data);
        if (rows.length) state.writes.push(`post.updateMany ${JSON.stringify(data)}`);
        return { count: rows.length };
      }),
    count: ({ where }: { where: { scheduleId: string } }) =>
      lazy(() => state.posts.filter((p) => p.scheduleId === where.scheduleId && p.clientNote).length),
  },
  postAdjustment: {
    count: async ({ where }: { where: { status: string; postId?: string; post?: { scheduleId: string } } }) =>
      state.adjustments.filter((a) => {
        if (a.status !== where.status) return false;
        if (where.postId) return a.postId === where.postId;
        const p = state.posts.find((x) => x.id === a.postId);
        return !!p && p.scheduleId === where.post?.scheduleId;
      }).length,
    create: ({ data }: { data: { postId: string; comment: string } }) =>
      lazy(() => {
        const row = { id: `adj-${state.adjustments.length + 1}`, status: "pendente", createdAt: new Date(), ...data };
        state.adjustments.push(row);
        state.writes.push("postAdjustment.create");
        return { id: row.id, comment: row.comment, status: row.status, createdAt: row.createdAt };
      }),
  },
  $transaction: async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: unknown) => Promise<unknown>)(fakePrisma);
    const out: unknown[] = [];
    for (const op of arg as Lazy<unknown>[]) out.push(await op.__run());
    return out;
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

// e-mail interceptado: nada sai; guarda o que seria enviado
const fakeEmail = {
  emailConfigured: () => true,
  approvalEmailHtml: (_client: string, _month: string, link: string) => `<a href="${link}">Revisar</a>`,
  sendEmailEach: async (to: readonly string[], msg: { subject: string; html: string }) =>
    to.map((t) => {
      if (state.emailFails) return { to: t, sent: false, error: `Resend 422: payload inválido ${msg.html}` };
      state.emails.push({ to: t, ...msg });
      return { to: t, sent: true };
    }),
};

// ------------------------------------------------------------ hooks de módulo

const FAKE_MODULES: Record<string, string> = {
  "@/lib/prisma": "export const prisma = globalThis.__r3.prisma;",
  "@/lib/notify":
    "const n = globalThis.__r3.notify;" +
    "export const teamEmails = n.teamEmails, raiseAlert = n.raiseAlert," +
    " notifyEmailHtml = n.notifyEmailHtml, escapeHtml = n.escapeHtml;",
  "@/lib/email":
    "const e = globalThis.__r3.email;" +
    "export const emailConfigured = e.emailConfigured, approvalEmailHtml = e.approvalEmailHtml," +
    " sendEmailEach = e.sendEmailEach;",
  "@/lib/api-auth": "export const requireAuth = async () => null; export const requireAdmin = async () => null;",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __r3: unknown }).__r3 = { prisma: fakePrisma, notify: fakeNotify, email: fakeEmail };
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

const lib = await import("../../src/lib/approval.ts");
const approveRoute = await import("../../src/app/api/aprovar/[token]/approve/route.ts");
const changesRoute = await import("../../src/app/api/aprovar/[token]/request-changes/route.ts");
const postRoute = await import("../../src/app/api/aprovar/[token]/post/[postId]/route.ts");
const weeklyRoute = await import("../../src/app/api/aprovar-semana/[token]/post/[postId]/route.ts");
const sendRoute = await import("../../src/app/api/schedules/[id]/send/route.ts");

// ------------------------------------------------------------ helpers

let ipN = 0;
const nextIp = () => `10.77.${Math.floor(ipN / 250) % 250}.${(ipN++ % 250) + 1}`;

type Res = { status: number; json: Row; headers: Headers };

async function read(res: Response): Promise<Res> {
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Row) : {}, headers: res.headers };
}

function jsonRequest(url: string, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": nextIp(), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type Ctx<P> = { params: Promise<P> };
const as = <T>(r: Request) => r as unknown as T;

async function approve(token: string, req?: Request): Promise<Res> {
  const r = req ?? jsonRequest(`http://localhost/api/aprovar/${token}/approve`);
  return read(await approveRoute.POST(as(r), { params: Promise.resolve({ token }) } as Ctx<{ token: string }>));
}
async function requestChanges(token: string, body: unknown = { note: "Trocar os temas da semana 2." }, req?: Request) {
  const r = req ?? jsonRequest(`http://localhost/api/aprovar/${token}/request-changes`, body);
  return read(await changesRoute.POST(as(r), { params: Promise.resolve({ token }) }));
}
async function postAction(token: string, postId: string, body: unknown, req?: Request) {
  const r = req ?? jsonRequest(`http://localhost/api/aprovar/${token}/post/${postId}`, body);
  return read(await postRoute.POST(as(r), { params: Promise.resolve({ token, postId }) }));
}
async function weekly(token: string, postId: string, body: unknown, req?: Request) {
  const r = req ?? jsonRequest(`http://localhost/api/aprovar-semana/${token}/post/${postId}`, body);
  return read(await weeklyRoute.POST(as(r), { params: Promise.resolve({ token, postId }) }));
}
async function send(id: string) {
  const r = Object.assign(new Request(`http://localhost/api/schedules/${id}/send`, { method: "POST" }), {
    nextUrl: new URL("http://localhost/api/schedules/send"),
  });
  return read(await sendRoute.POST(as(r), { params: Promise.resolve({ id }) }));
}

function addSchedule(over: Row = {}): Row {
  const row: Row = {
    id: SCHEDULE_ID,
    clientId: "cli-r3",
    monthRef: new Date("2099-01-01T00:00:00Z"),
    status: "enviado_cliente",
    approvalToken: lib.newApprovalToken(),
    sentAt: new Date(Date.now() - 2 * DAY),
    createdAt: new Date(Date.now() - 5 * DAY),
    clientNote: null,
    client: {
      name: "ZZ QA OWASP-R3 Cliente",
      plan: "sem_aprovacao",
      agencyPublishes: true,
      email: "zzqa.owasp-r3@example.com",
      extraEmails: [],
    },
    ...over,
  };
  state.schedules.push(row);
  state.posts.push({
    id: "p1",
    clientId: "cli-r3",
    scheduleId: row.id,
    status: "draft",
    theme: "ZZ QA OWASP-R3 Tema",
    clientNote: null,
  });
  return row;
}

function addReview(over: Row = {}, post: Row = {}): { review: Row; post: Row } {
  const review: Row = {
    id: "rev-r3",
    clientId: "cli-r3",
    token: lib.newApprovalToken(),
    status: "enviado",
    sentAt: new Date(Date.now() - 3 * DAY),
    client: { name: "ZZ QA OWASP-R3 Cliente", agencyPublishes: true },
    ...over,
  };
  state.reviews.push(review);
  const p: Row = {
    id: "w1",
    weeklyReviewId: review.id,
    theme: "ZZ QA OWASP-R3 Semanal",
    status: "draft",
    clientApproval: null,
    ...post,
  };
  state.posts.push(p);
  return { review, post: p };
}

const snapshot = () =>
  JSON.stringify({ s: state.schedules, p: state.posts, a: state.adjustments, al: state.alerts, e: state.emails });

function assertPublicHeaders(r: Res) {
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(r.headers.get("x-robots-tag"), "noindex, nofollow");
}

const APPROVED = "Este cronograma já foi aprovado.";
const EXPIRED = "Este link expirou. Peça um novo link à agência.";

// ------------------------------------------------------------ lib: token e ciclo de vida

describe("lib/approval: token e prazo", () => {
  test("token do CSPRNG com 192 bits (24 bytes → 32 caracteres base64url), sem repetição", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = lib.newApprovalToken();
      assert.match(t, /^[A-Za-z0-9_-]{32}$/);
      assert.equal(Buffer.from(t, "base64url").length, 24);
      seen.add(t);
    }
    assert.equal(seen.size, 200);
  });

  test("tokenKey: 16 hex estáveis, não contém o token e não é reversível por fatia", () => {
    const t = lib.newApprovalToken();
    const k = lib.tokenKey(t);
    assert.match(k, /^[0-9a-f]{16}$/);
    assert.equal(lib.tokenKey(t), k);
    assert.ok(!t.includes(k) && !k.includes(t.slice(0, 8)));
    assert.notEqual(lib.tokenKey(lib.newApprovalToken()), k);
  });

  test("isTokenShaped recusa formato impossível (sem ir ao banco)", () => {
    assert.ok(lib.isTokenShaped(lib.newApprovalToken()));
    for (const bad of ["", "curto", "a".repeat(129), "../../etc/passwd-xxxxxxxx", "tok en com espaço xx", "ç".repeat(20)]) {
      assert.equal(lib.isTokenShaped(bad), false, bad);
    }
  });

  test("60 dias exatos após o envio → expirado; 1 minuto antes → válido; sem data → expirado", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    assert.equal(lib.LINK_TTL_DAYS, 60);
    assert.equal(lib.linkExpired(new Date(now.getTime() - 60 * DAY), now), true);
    assert.equal(lib.linkExpired(new Date(now.getTime() - 60 * DAY + 60_000), now), false);
    assert.equal(lib.linkExpired(null, now), true);
    assert.equal(lib.linkExpired(new Date("x"), now), true);
  });

  test("estado mensal: expirado > aprovado > fechado > aberto; sem sent_at conta de created_at", () => {
    const now = new Date();
    const recent = new Date(now.getTime() - DAY);
    const old = new Date(now.getTime() - 61 * DAY);
    const st = (status: string, sentAt: Date | null, createdAt: Date | null = recent) =>
      lib.monthlyLinkState({ status, sentAt, createdAt }, now);
    assert.equal(st("enviado_cliente", recent), "aberto");
    assert.equal(st("em_revisao", recent), "aberto");
    assert.equal(st("aprovado_cliente", recent), "aprovado");
    assert.equal(st("aprovado_interno", recent), "aprovado");
    assert.equal(st("rascunho", recent), "fechado");
    assert.equal(st("aprovado_cliente", old), "expirado");
    assert.equal(st("enviado_cliente", null, old), "expirado");
    assert.equal(st("enviado_cliente", null, recent), "aberto");
  });

  test("estado semanal: expirado > concluído > aberto", () => {
    const now = new Date();
    assert.equal(lib.weeklyLinkState({ status: "enviado", sentAt: new Date(now.getTime() - DAY) }, now), "aberto");
    assert.equal(lib.weeklyLinkState({ status: "concluido", sentAt: new Date(now.getTime() - DAY) }, now), "concluido");
    assert.equal(lib.weeklyLinkState({ status: "concluido", sentAt: new Date(now.getTime() - 300 * DAY) }, now), "expirado");
  });
});

describe("lib/approval: corpo com teto (CF-16)", () => {
  test("Content-Length acima de 32 KB → recusado sem ler um byte", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(1024));
      },
    });
    const req = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-length": String(10 * 1024 * 1024) },
      body: stream,
      duplex: "half",
    } as RequestInit);
    assert.deepEqual(await lib.readJsonCapped(req), { tooLarge: true });
    assert.ok(pulled <= 1, `leu ${pulled} pedaços`); // o ReadableStream pode pré-carregar 1 pedaço
  });

  test("sem Content-Length (chunked): para de ler logo depois do teto", async () => {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += 8192;
        c.enqueue(new Uint8Array(8192).fill(32));
        if (sent >= 10 * 1024 * 1024) c.close();
      },
    });
    const req = new Request("http://localhost/x", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    assert.deepEqual(await lib.readJsonCapped(req), { tooLarge: true });
    assert.ok(sent <= lib.PUBLIC_BODY_MAX_BYTES + 3 * 8192, `leu ${sent} bytes`);
  });

  test("JSON válido passa; inválido vira null (o zod recusa com 400)", async () => {
    const ok = await lib.readJsonCapped(new Request("http://localhost/x", { method: "POST", body: '{"a":1}' }));
    assert.deepEqual(ok, { tooLarge: false, value: { a: 1 } });
    const bad = await lib.readJsonCapped(new Request("http://localhost/x", { method: "POST", body: "{nope" }));
    assert.deepEqual(bad, { tooLarge: false, value: null });
  });
});

// ------------------------------------------------------------ link MENSAL

describe("link mensal aprovado → só leitura: as 3 ações dão 409 e nada é gravado", () => {
  beforeEach(reset);

  for (const status of ["aprovado_cliente", "aprovado_interno"]) {
    test(`${status}: aprovar, pedir ajustes, ajuste e observação no post → 409 pt-BR`, async () => {
      const s = addSchedule({ status });
      const token = s.approvalToken as string;
      const before = snapshot();
      const results = [
        await approve(token),
        await requestChanges(token),
        await postAction(token, "p1", { action: "adjust", comment: COMMENT }),
        await postAction(token, "p1", { action: "note", clientNote: "Gostei." }),
      ];
      for (const r of results) {
        assert.equal(r.status, 409);
        assert.equal(r.json.error, APPROVED);
        assertPublicHeaders(r);
      }
      assert.equal(snapshot(), before);
      assert.deepEqual(state.writes, []);
      assert.equal(state.alerts.length, 0);
    });
  }
});

describe("link mensal expirado (60 dias após o envio) → 410 em toda ação", () => {
  beforeEach(reset);

  test("aberto, enviado há 61 dias: aprovar/ajustes/ajuste/observação → 410, nada gravado", async () => {
    const s = addSchedule({ sentAt: new Date(Date.now() - 61 * DAY) });
    const token = s.approvalToken as string;
    const before = snapshot();
    const results = [
      await approve(token),
      await requestChanges(token),
      await postAction(token, "p1", { action: "adjust", comment: COMMENT }),
      await postAction(token, "p1", { action: "note", clientNote: "Gostei." }),
    ];
    for (const r of results) {
      assert.equal(r.status, 410);
      assert.deepEqual(r.json, { error: EXPIRED, code: "LINK_EXPIRED" });
      assertPublicHeaders(r);
    }
    assert.equal(snapshot(), before);
    assert.deepEqual(state.writes, []);
  });

  test("aprovado E expirado → 410 (o prazo vale primeiro)", async () => {
    const s = addSchedule({ status: "aprovado_cliente", sentAt: new Date(Date.now() - 90 * DAY) });
    assert.equal((await approve(s.approvalToken as string)).status, 410);
  });

  test("sem sent_at: conta de created_at (criado há 61 dias → 410; há 10 dias → aprova)", async () => {
    const old = addSchedule({ sentAt: null, createdAt: new Date(Date.now() - 61 * DAY) });
    assert.equal((await approve(old.approvalToken as string)).status, 410);
    reset();
    const recent = addSchedule({ sentAt: null, createdAt: new Date(Date.now() - 10 * DAY) });
    assert.equal((await approve(recent.approvalToken as string)).status, 200);
  });
});

describe("link mensal aberto continua funcionando", () => {
  beforeEach(reset);

  test("aprovar → 200, cronograma aprovado; depois o mesmo link só dá 409", async () => {
    const s = addSchedule();
    const token = s.approvalToken as string;
    const r = await approve(token);
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assertPublicHeaders(r);
    assert.equal(s.status, "aprovado_cliente");
    assert.equal(state.posts[0].status, "scheduled"); // plano sem aprovação: entra na fila
    const again = await approve(token);
    assert.equal(again.status, 409);
    assert.equal(again.json.error, APPROVED);
  });

  test("corrida: o cronograma muda entre a leitura e a gravação → 409, nada gravado", async () => {
    const s = addSchedule();
    const token = s.approvalToken as string;
    const original = fakePrisma.postAdjustment.count;
    // entre a checagem e o UPDATE condicional, outra aba aprova
    fakePrisma.postAdjustment.count = async (args) => {
      s.status = "aprovado_cliente";
      return original(args);
    };
    try {
      const r = await approve(token);
      assert.equal(r.status, 409);
      assert.equal(state.posts[0].status, "draft");
      assert.deepEqual(state.writes, []);
    } finally {
      fakePrisma.postAdjustment.count = original;
    }
  });

  test("pedir ajustes e observação → 200 com no-store", async () => {
    const s = addSchedule();
    const token = s.approvalToken as string;
    const a = await requestChanges(token);
    assert.equal(a.status, 200);
    assertPublicHeaders(a);
    const b = await postAction(token, "p1", { action: "note", clientNote: "Gostei." });
    assert.equal(b.status, 200);
    assertPublicHeaders(b);
  });

  test("token inexistente → 404; formato impossível → 404 sem consultar o banco", async () => {
    addSchedule();
    const r = await approve(lib.newApprovalToken());
    assert.equal(r.status, 404);
    assertPublicHeaders(r);
    state.reads = 0;
    const bad = await approve("x");
    assert.equal(bad.status, 404);
    assert.equal(state.reads, 0);
  });
});

describe("corpo das ações públicas com teto de 32 KB (CF-16)", () => {
  beforeEach(reset);

  test("Content-Length de 10 MB → 413 antes de consultar o banco (aprovar, ajustes, post)", async () => {
    const s = addSchedule();
    const token = s.approvalToken as string;
    const big = { "content-length": String(10 * 1024 * 1024) };
    const mk = (url: string) =>
      new Request(url, { method: "POST", headers: { ...big, "x-forwarded-for": nextIp() }, body: "{}" });
    state.reads = 0;
    const rs = [
      await approve(token, mk(`http://localhost/api/aprovar/${token}/approve`)),
      await requestChanges(token, undefined, mk(`http://localhost/api/aprovar/${token}/request-changes`)),
      await postAction(token, "p1", undefined, mk(`http://localhost/api/aprovar/${token}/post/p1`)),
      await weekly(token, "w1", undefined, mk(`http://localhost/api/aprovar-semana/${token}/post/w1`)),
    ];
    for (const r of rs) {
      assert.equal(r.status, 413);
      assert.equal(typeof r.json.error, "string");
      assertPublicHeaders(r);
    }
    assert.equal(state.reads, 0);
    assert.deepEqual(state.writes, []);
  });

  test("corpo real acima do teto (comentário gigante) → 413, nada gravado", async () => {
    const s = addSchedule();
    const r = await postAction(s.approvalToken as string, "p1", { action: "adjust", comment: "x".repeat(40_000) });
    assert.equal(r.status, 413);
    assert.deepEqual(state.writes, []);
  });

  test("dentro do teto continua normal (comentário de 2.000 caracteres)", async () => {
    const s = addSchedule();
    const r = await postAction(s.approvalToken as string, "p1", { action: "adjust", comment: "a".repeat(2000) });
    assert.equal(r.status, 200);
  });
});

describe("rate limit por link (qualquer IP) e por ajustes/hora", () => {
  beforeEach(reset);

  test("61ª ação no mesmo link em 1 minuto, cada uma de um IP diferente → 429 com no-store", async () => {
    const s = addSchedule();
    const token = s.approvalToken as string;
    for (let i = 0; i < lib.LINK_ACTIONS_PER_MINUTE; i++) {
      const r = await postAction(token, "p1", { action: "note", clientNote: `n${i}` });
      assert.equal(r.status, 200, `chamada ${i + 1}`);
    }
    const over = await postAction(token, "p1", { action: "note", clientNote: "demais" });
    assert.equal(over.status, 429);
    assert.match(String(over.json.error), /Muitas requisições/);
    assertPublicHeaders(over);
    // outro link não é afetado
    reset();
    const other = addSchedule();
    assert.equal((await postAction(other.approvalToken as string, "p1", { action: "note", clientNote: "ok" })).status, 200);
  });

  test("41º pedido de ajuste no mesmo link na mesma hora → 429; nenhum e-mail a mais", async () => {
    const s = addSchedule();
    const token = s.approvalToken as string;
    for (let i = 0; i < lib.LINK_ADJUSTS_PER_HOUR; i++) {
      assert.equal((await postAction(token, "p1", { action: "adjust", comment: `${COMMENT} ${i}` })).status, 200);
    }
    const alerts = state.alerts.length;
    const over = await postAction(token, "p1", { action: "adjust", comment: COMMENT });
    assert.equal(over.status, 429);
    assert.equal(state.alerts.length, alerts);
  });
});

// ------------------------------------------------------------ link SEMANAL

describe("link semanal: concluído/antigo não aprova mais (AC-05)", () => {
  beforeEach(reset);

  test("AC-05: semana de 300 dias atrás, 'concluido' → aprovar post draft dá 410 e o post continua draft", async () => {
    const { review, post } = addReview({ status: "concluido", sentAt: new Date(Date.now() - 300 * DAY) });
    const before = snapshot();
    const r = await weekly(review.token as string, post.id as string, { action: "approve" });
    assert.equal(r.status, 410);
    assert.deepEqual(r.json, { error: EXPIRED, code: "LINK_EXPIRED" });
    assertPublicHeaders(r);
    assert.deepEqual({ status: post.status, clientApproval: post.clientApproval }, { status: "draft", clientApproval: null });
    assert.equal(snapshot(), before);
  });

  test("antigo mas ainda 'enviado' (61 dias) → 410 em aprovar e em ajuste", async () => {
    const { review, post } = addReview({ sentAt: new Date(Date.now() - 61 * DAY) });
    for (const body of [{ action: "approve" }, { action: "adjust", comment: COMMENT }]) {
      assert.equal((await weekly(review.token as string, post.id as string, body)).status, 410);
    }
    assert.deepEqual(state.writes, []);
    assert.equal(state.alerts.length, 0);
  });

  test("concluído e recente → 409 WEEK_CONCLUDED em aprovar e em ajuste, nada gravado", async () => {
    const { review, post } = addReview({ status: "concluido" });
    for (const body of [{ action: "approve" }, { action: "adjust", comment: COMMENT }]) {
      const r = await weekly(review.token as string, post.id as string, body);
      assert.equal(r.status, 409);
      assert.equal(r.json.code, "WEEK_CONCLUDED");
      assert.equal(typeof r.json.error, "string");
    }
    assert.deepEqual(state.writes, []);
  });

  test("post já aprovado que a equipe tirou da fila (draft): link antigo NÃO o põe de volta (409)", async () => {
    const { review, post } = addReview({}, { status: "draft", clientApproval: "aprovado" });
    const r = await weekly(review.token as string, post.id as string, { action: "approve" });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, "POST_ALREADY_APPROVED");
    assert.equal(post.status, "draft");
    assert.deepEqual(state.writes, []);
  });

  test("aberto e recente → aprovar funciona como antes (draft → scheduled) com no-store", async () => {
    const { review, post } = addReview();
    const r = await weekly(review.token as string, post.id as string, { action: "approve" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, approved: true });
    assertPublicHeaders(r);
    assert.equal(post.status, "scheduled");
    assert.equal(post.clientApproval, "aprovado");
  });
});

// ------------------------------------------------------------ reenvio

describe("reenvio (POST /api/schedules/[id]/send) troca o token", () => {
  beforeEach(reset);

  test("token novo, sent_at renovado, e-mail com o link novo; o link antigo passa a 404", async () => {
    const s = addSchedule({ status: "em_revisao", sentAt: new Date(Date.now() - 59 * DAY) });
    const oldToken = s.approvalToken as string;
    const oldSent = (s.sentAt as Date).getTime();

    const r = await send(SCHEDULE_ID);
    assert.equal(r.status, 200);
    const newToken = s.approvalToken as string;
    assert.notEqual(newToken, oldToken);
    assert.match(newToken, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(s.status, "enviado_cliente");
    assert.ok((s.sentAt as Date).getTime() > oldSent);
    assert.ok(Date.now() - (s.sentAt as Date).getTime() < 5_000);

    // e-mail interceptado: 1 por destinatário, com o link NOVO e sem o antigo
    assert.equal(state.emails.length, 1);
    assert.ok(state.emails[0].html.includes(`/aprovar/${newToken}`));
    assert.ok(!state.emails[0].html.includes(oldToken));
    assert.ok(String(r.json.link).endsWith(`/aprovar/${newToken}`));

    // o link antigo deixou de valer; o novo aprova
    const old = await approve(oldToken);
    assert.equal(old.status, 404);
    assert.equal((await approve(newToken)).status, 200);
  });

  test("dois reenvios seguidos geram dois tokens diferentes", async () => {
    const s = addSchedule();
    await send(SCHEDULE_ID);
    const t1 = s.approvalToken;
    await send(SCHEDULE_ID);
    assert.notEqual(s.approvalToken, t1);
  });

  test("cronograma já aprovado continua recusado (409) e o token não muda", async () => {
    const s = addSchedule({ status: "aprovado_cliente" });
    const before = s.approvalToken;
    const r = await send(SCHEDULE_ID);
    assert.equal(r.status, 409);
    assert.equal(s.approvalToken, before);
    assert.equal(state.emails.length, 0);
  });

  test("falha do provedor que ecoa o conteúdo: o log do servidor não leva o token", async () => {
    const s = addSchedule({ id: "6f1d3c2a-0000-4000-8000-0000000000c3" });
    state.emailFails = true;
    const logged: string[] = [];
    const spy = mock.method(console, "error", (...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
    try {
      const r = await send("6f1d3c2a-0000-4000-8000-0000000000c3");
      assert.equal(r.status, 200);
      assert.equal(r.json.emailed, false);
    } finally {
      spy.mock.restore();
    }
    const token = s.approvalToken as string;
    assert.ok(logged.length > 0, "a falha deve ir para o log");
    assert.ok(logged.every((l) => !l.includes(token)), "token vazou no log");
    assert.ok(logged.some((l) => l.includes("/aprovar/<token>")));
  });

  test("id que não é UUID → 404 sem consultar o banco", async () => {
    state.reads = 0;
    const r = await send("nao-e-uuid");
    assert.equal(r.status, 404);
    assert.equal(state.reads, 0);
  });

  test("6º envio do mesmo cronograma em 10 minutos → 429 (e-mail ao cliente não vira spam)", async () => {
    addSchedule({ id: "6f1d3c2a-0000-4000-8000-0000000000b2" });
    const id = "6f1d3c2a-0000-4000-8000-0000000000b2";
    for (let i = 0; i < 5; i++) assert.equal((await send(id)).status, 200, `envio ${i + 1}`);
    const sixth = await send(id);
    assert.equal(sixth.status, 429);
    assert.equal(state.emails.length, 5);
  });
});
