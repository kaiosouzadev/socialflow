/**
 * OWASP R2 — cifra (CR-10) e tela/rota "Registro de ações".
 *   CR-10: lib/crypto exige tag de autenticação de 16 bytes. Antes, uma tag truncada (4 bytes) era
 *          aceita e decifrava; um blob com menos de 28 bytes decifrava para "". O formato
 *          iv(12)+tag(16)+texto continua o mesmo: cifras antigas (feitas sem `authTagLength`) abrem.
 *   GET /api/audit: só admin (anônimo 401, staff 403), filtros por ação/pessoa/cliente/período,
 *          paginação (padrão: as últimas 200), filtro inválido → 400 pt-BR, `Cache-Control: no-store`.
 *   lib/audit-query: textos pt-BR dos detalhes (nunca segredo) e o `where` dos filtros.
 *   lib/client-urls: normalização https (unidade).
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { createCipheriv, randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const KEY_HEX = randomBytes(32).toString("hex");
process.env.TOKEN_ENC_KEY = KEY_HEX;

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Session = { user: { id?: string; email?: string; role?: string } } | null;
type Row = {
  id: string;
  at: Date;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  clientId: string | null;
  meta: unknown;
  ip: string | null;
};

const state = {
  session: { user: { id: uid(900), email: "zzqa.r2.admin@example.com", role: "admin" } } as Session,
  rows: [] as Row[],
  lastArgs: null as null | { where: Record<string, unknown>; skip: number; take: number },
  fail: false,
};

function matches(r: Row, where: Record<string, unknown>): boolean {
  if (where.action !== undefined && r.action !== where.action) return false;
  if (where.actorId !== undefined && r.actorId !== where.actorId) return false;
  if (where.clientId !== undefined && r.clientId !== where.clientId) return false;
  const at = where.at as { gte?: Date; lt?: Date } | undefined;
  if (at?.gte && r.at < at.gte) return false;
  if (at?.lt && r.at >= at.lt) return false;
  return true;
}

const USERS: Record<string, string> = { [uid(900)]: "ZZ QA R2 Admin", [uid(901)]: "ZZ QA R2 Staff" };
const fakePrisma = {
  auditLog: {
    count: async ({ where }: { where: Record<string, unknown> }) => {
      if (state.fail) throw Object.assign(new Error("boom"), { code: "P2021" });
      return state.rows.filter((r) => matches(r, where)).length;
    },
    findMany: async (args: { where: Record<string, unknown>; skip: number; take: number }) => {
      state.lastArgs = args;
      return state.rows
        .filter((r) => matches(r, args.where))
        .sort((a, b) => +b.at - +a.at)
        .slice(args.skip, args.skip + args.take)
        .map((r) => ({ ...r, actor: r.actorId && USERS[r.actorId] ? { name: USERS[r.actorId] } : null }));
    },
  },
  client: {
    findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.filter((id) => id === uid(1)).map((id) => ({ id, name: "ZZ QA R2 Cliente atual" })),
  },
};

const FAKE_MODULES: Record<string, string> = {
  "@/auth": "export const auth = async () => globalThis.__r2a.state.session;",
  "@/lib/prisma": "export const prisma = globalThis.__r2a.prisma;",
};
type ResolveHook = (specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
(globalThis as unknown as { __r2a: unknown }).__r2a = { state, prisma: fakePrisma };
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

const { encryptToken, decryptToken } = await import("../../src/lib/crypto.ts");
const auditRoute = await import("../../src/app/api/audit/route.ts");
const { describeAuditEvent, auditWhere, parseAuditFilters, AUDIT_PAGE_SIZE } = await import("../../src/lib/audit-query.ts");
const { normalizeClientUrl } = await import("../../src/lib/client-urls.ts");

// ------------------------------------------------------------ CR-10

/** Cifra no formato de SEMPRE, com o código antigo (sem authTagLength): o que já está no banco. */
function legacyEncrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(KEY_HEX, "hex"), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

describe("CR-10: tag de autenticação de 16 bytes", () => {
  test("ida e volta continua igual; cifra antiga (formato atual) abre", () => {
    assert.equal(decryptToken(encryptToken("token-ZZQA-R2")), "token-ZZQA-R2");
    assert.equal(decryptToken(legacyEncrypt("credenciais-antigas")), "credenciais-antigas");
    assert.equal(decryptToken(encryptToken("")), "");
  });

  test("formato não mudou: iv(12) + tag(16) + texto", () => {
    assert.equal(Buffer.from(encryptToken("abc"), "base64").length, 12 + 16 + 3);
  });

  test("ataque que passava antes: blob curto com tag de 4 bytes → recusado", () => {
    // iv + tag truncada (4 bytes) e nenhum texto: antes decifrava para "" (DEP0182)
    const full = Buffer.from(encryptToken(""), "base64");
    const truncated = full.subarray(0, 12 + 4).toString("base64");
    assert.throws(() => decryptToken(truncated));
    assert.throws(() => decryptToken(full.subarray(0, 27).toString("base64")));
    assert.throws(() => decryptToken(""));
  });

  test("tag adulterada → recusado (integridade)", () => {
    const buf = Buffer.from(encryptToken("segredo"), "base64");
    buf[12] ^= 0x01;
    assert.throws(() => decryptToken(buf.toString("base64")));
  });

  test("chave que não é hexadecimal de 64 caracteres → erro claro (nada cifrado)", () => {
    const saved = process.env.TOKEN_ENC_KEY;
    try {
      process.env.TOKEN_ENC_KEY = "z".repeat(64);
      assert.throws(() => encryptToken("x"), /TOKEN_ENC_KEY/);
      process.env.TOKEN_ENC_KEY = "a".repeat(63);
      assert.throws(() => encryptToken("x"), /TOKEN_ENC_KEY/);
    } finally {
      process.env.TOKEN_ENC_KEY = saved;
    }
  });
});

// ------------------------------------------------------------ GET /api/audit

function seedRows() {
  const base = Date.parse("2026-10-07T15:00:00Z");
  state.rows = [];
  for (let i = 0; i < 250; i++) {
    state.rows.push({
      id: uid(10_000 + i),
      at: new Date(base - i * 60_000),
      action: i % 2 ? "credential.reveal" : "posts.bulk_delete",
      actorId: i % 3 ? uid(901) : uid(900),
      actorEmail: i % 3 ? "zzqa.r2.staff@example.com" : "zzqa.r2.admin@example.com",
      targetType: "client",
      targetId: uid(1),
      clientId: i % 5 ? uid(1) : uid(2),
      meta: i % 2 ? { clientName: "ZZ QA R2 Cliente antigo", networks: ["Instagram"], count: 1 } : { deleted: 2, byStatus: { draft: 2 } },
      ip: "203.0.113.1",
    });
  }
}

const get = async (qs = "") => {
  const res = await auditRoute.GET(new Request(`http://localhost/api/audit${qs}`));
  return { status: res.status, headers: res.headers, json: (await res.json()) as Record<string, unknown> };
};

describe("GET /api/audit — só admin, filtros e paginação", () => {
  beforeEach(() => {
    state.session = { user: { id: uid(900), email: "zzqa.r2.admin@example.com", role: "admin" } };
    state.fail = false;
    seedRows();
  });

  test("anônimo → 401; staff → 403 (nenhuma leitura)", async () => {
    state.session = null;
    assert.equal((await get()).status, 401);
    state.session = { user: { id: uid(901), email: "zzqa.r2.staff@example.com", role: "staff" } };
    state.lastArgs = null;
    const r = await get();
    assert.equal(r.status, 403);
    assert.equal(state.lastArgs, null);
  });

  test("admin sem filtro → as últimas 200, mais recentes primeiro, no-store", async () => {
    const r = await get();
    assert.equal(r.status, 200);
    assert.match(r.headers.get("cache-control") ?? "", /no-store/);
    const items = r.json.items as { id: string; at: string }[];
    assert.equal(AUDIT_PAGE_SIZE, 200);
    assert.equal(items.length, 200);
    assert.equal(r.json.total, 250);
    assert.equal(r.json.totalPages, 2);
    assert.ok(items.every((x, i) => i === 0 || x.at <= items[i - 1].at));
  });

  test("página 2 traz as 50 restantes", async () => {
    const r = await get("?pagina=2");
    assert.equal((r.json.items as unknown[]).length, 50);
    assert.equal(state.lastArgs!.skip, 200);
  });

  test("filtros por ação, pessoa e cliente viram o where", async () => {
    const r = await get(`?acao=credential.reveal&pessoa=${uid(901)}&cliente=${uid(1)}`);
    assert.equal(r.status, 200);
    assert.deepEqual(state.lastArgs!.where, { action: "credential.reveal", actorId: uid(901), clientId: uid(1) });
    const items = r.json.items as { action: string; actorName: string; clientName: string; summary: string; clientDeleted: boolean }[];
    assert.ok(items.length > 0);
    assert.ok(items.every((x) => x.action === "credential.reveal" && x.actorName === "ZZ QA R2 Staff"));
    assert.equal(items[0].clientName, "ZZ QA R2 Cliente atual", "nome atual do cliente");
    assert.equal(items[0].summary, "Redes: Instagram");
  });

  test("cliente excluído: aparece com o nome gravado no registro", async () => {
    const r = await get(`?cliente=${uid(2)}&acao=credential.reveal`);
    const item = (r.json.items as { clientName: string; clientDeleted: boolean }[])[0];
    assert.equal(item.clientDeleted, true);
    assert.equal(item.clientName, "ZZ QA R2 Cliente antigo");
  });

  test("período (dias em São Paulo, 'até' inclusivo)", async () => {
    await get("?de=2026-10-07&ate=2026-10-07");
    const at = state.lastArgs!.where.at as { gte: Date; lt: Date };
    assert.equal(at.gte.toISOString(), "2026-10-07T03:00:00.000Z");
    assert.equal(at.lt.toISOString(), "2026-10-08T03:00:00.000Z");
  });

  for (const qs of ["?acao=DROP TABLE", "?pessoa=abc", "?cliente=1", "?de=07/10/2026", "?pagina=0", "?limite=201"]) {
    test(`filtro inválido ${qs} → 400 pt-BR`, async () => {
      const r = await get(qs);
      assert.equal(r.status, 400);
      assert.equal(typeof r.json.error, "string");
      assert.match(String(r.json.error), /^Filtro inválido/);
    });
  }

  test("falha do banco → 500 pt-BR sem detalhe técnico", async () => {
    state.fail = true;
    const r = await get();
    assert.equal(r.status, 500);
    assert.doesNotMatch(String(r.json.error), /P2021|boom|Prisma/);
  });
});

// ------------------------------------------------------------ textos e filtros (unidade)

describe("lib/audit-query — textos pt-BR dos detalhes", () => {
  const cases: [string, Record<string, unknown> | null, string][] = [
    ["credential.reveal", { networks: ["Instagram", "Facebook"] }, "Redes: Instagram, Facebook"],
    ["credential.reveal", { networks: [] }, "Nenhuma credencial salva"],
    ["credential.reveal_blocked", { limit: 30 }, "Chegou ao limite de 30 revelações por hora"],
    ["credential.update", { added: ["LinkedIn"], changed: ["Instagram"], removed: ["Facebook"] }, "Incluídas: LinkedIn · alteradas: Instagram · removidas: Facebook"],
    ["client.delete", { posts: 12, publishedPosts: 3, schedules: 2, accounts: 1 }, "12 posts (3 publicados), 2 cronogramas, 1 conta"],
    ["client.account_change", { op: "create", platform: "instagram", externalId: "178" }, "Conta Instagram adicionada (178)"],
    [
      "client.account_change",
      { op: "update", platform: "facebook", externalId: "1", changes: { tokenReplaced: true, status: { from: "active", to: "inactive" } } },
      "Conta Facebook (1): token trocado, status ativa → inativa",
    ],
    ["client.meta_link", { pageName: "Página X", connected: ["facebook", "instagram"] }, "Página “Página X” → Facebook + Instagram"],
    ["posts.bulk_delete", { deleted: 4, byStatus: { draft: 1, scheduled: 2, published: 1 } }, "4 posts excluídos: 1 rascunho, 2 agendados, 1 publicado"],
    ["schedule.approve_internal", { monthRef: "2026-11-01", queued: 10 }, "Cronograma de Novembro de 2026 · 10 posts na fila"],
    ["settings.ai_model", { from: null, to: { provider: "openai", model: "gpt-5-mini" } }, "De Padrão do sistema para ChatGPT gpt-5-mini"],
    ["settings.openai_key", { op: "removed", modelReset: true }, "Chave removida; o modelo voltou ao padrão do sistema"],
    ["user.role_change", { name: "Fulana", from: "staff", to: "admin" }, "Fulana · papel Equipe → Administrador"],
  ];
  for (const [action, meta, expected] of cases) {
    test(`${action} → "${expected}"`, () => assert.equal(describeAuditEvent(action, meta), expected));
  }

  test("parseAuditFilters: período invertido é trocado; valores válidos passam", () => {
    const { filters, invalid } = parseAuditFilters({ de: "2026-10-09", ate: "2026-10-01", limite: "50" });
    assert.deepEqual(invalid, []);
    assert.equal(filters.from, "2026-10-01");
    assert.equal(filters.to, "2026-10-09");
    assert.equal(filters.pageSize, 50);
    assert.deepEqual(auditWhere({ page: 1, pageSize: 200 }), {});
  });
});

describe("lib/client-urls — só https", () => {
  test("recusa esquemas perigosos e aceita/normaliza endereços da web", () => {
    for (const bad of ["javascript:alert(1)", " data:text/html,x", "vbscript:x", "file:///etc/passwd", "mailto:a@b.com", "https://a b.com", "localhost:3000", "https://x", "https:\\\\evil.com"]) {
      assert.equal(normalizeClientUrl("website", bad).ok, false, bad);
    }
    assert.deepEqual(normalizeClientUrl("website", "  "), { ok: true, value: "" });
    assert.deepEqual(normalizeClientUrl("website", "site.com.br:8080/x"), { ok: true, value: "https://site.com.br:8080/x" });
    assert.deepEqual(normalizeClientUrl("facebookUrl", "http://facebook.com/x"), { ok: true, value: "https://facebook.com/x" });
    assert.equal(normalizeClientUrl("website", `https://${"a".repeat(200)}.com`).ok, false, "acima de 200 caracteres");
  });
});
