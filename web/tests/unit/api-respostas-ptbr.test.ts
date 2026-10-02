/**
 * S35 / P4-A2: respostas de erro das rotas de API em pt-BR, sem texto técnico.
 *   1. falha de configuração (Drive/R2/chave ausente, token ilegível) → 503 em drive/sync e meta assets;
 *   2. ai/calendar/commit não expõe "Banco: <Prisma>" (detalhe só no log);
 *   3. drive/folders e internal/weekly/run sem `e.message` cru;
 *   4. 401/403 em pt-BR (api-auth, internal-auth), mantendo status e o formato { error };
 *   5. meta/connections (POST) e art-templates/generate-month sem texto em inglês da Graph/IA.
 *
 * Técnica do doc-import-captions.test.ts: hooks de módulo resolvem "@/" para os fontes e trocam
 * Prisma, a sessão (@/auth) e as libs de Drive/semanal por versões falsas em memória. As libs da
 * Meta (lib/meta) e da IA (lib/gemini) rodam de verdade sobre um `fetch` falso — nenhuma
 * chamada de rede real (qualquer URL não prevista falha o teste).
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const KEY_HEX = "a".repeat(64);

// ------------------------------------------------------------ estado falso

type Row = Record<string, unknown>;
type Session = { user: { role?: string } } | null;
const state = {
  session: { user: { role: "admin" } } as Session,
  connections: new Map<string, Row>(),
  txError: null as Error | null,
  syncMedia: async (): Promise<unknown> => ({ attached: 0 }),
  listFolders: async (): Promise<unknown> => [],
  runWeeklyReviews: async (): Promise<unknown> => ({ sent: 0 }),
  /** resposta falsa por URL (Graph da Meta e Gemini) */
  fetch: null as null | ((url: string, init?: RequestInit) => Promise<Response>),
};

const fakePrisma = {
  metaConnection: {
    findUnique: async ({ where }: { where: { id: string } }) => state.connections.get(where.id) ?? null,
    create: async ({ data }: { data: Row }) => ({ id: "conn-nova", name: data.name, businessId: data.businessId, status: data.status }),
  },
  client: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === CLIENT_ID ? { id: CLIENT_ID, name: "ZZ QA P4A2", driveFolderId: null } : null,
  },
  schedule: { findFirst: async () => null },
  $transaction: async () => {
    throw state.txError ?? new Error("transação não configurada no teste");
  },
  artTemplate: { create: async () => ({}) },
};

const logs: string[] = [];
console.error = (...args: unknown[]) => {
  logs.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" "));
};

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!state.fetch) throw new Error(`rede real bloqueada no teste: ${url}`);
  return state.fetch(url, init);
}) as typeof fetch;

// ------------------------------------------------------------ hooks de módulo

const FAKE_MODULES: Record<string, string> = {
  "next/server": "export class NextRequest extends Request {} export class NextResponse extends Response {}",
  "@/auth": "export const auth = async () => globalThis.__p4a2.state.session;",
  "@/lib/prisma": "export const prisma = globalThis.__p4a2.prisma;",
  "@/generated/prisma/client":
    "export const Prisma = { PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {} };",
  "@/lib/drive-sync":
    "const s = globalThis.__p4a2.state;" +
    " export const syncMedia = (...a) => s.syncMedia(...a);" +
    " export const prepareClientDriveFolders = async () => ({});" +
    " export const spMonthKey = (d) => d.toISOString().slice(0, 7);",
  "@/lib/google-drive":
    "const s = globalThis.__p4a2.state;" +
    " export const listFolders = (...a) => s.listFolders(...a); export const driveConfigured = () => true;",
  "@/lib/weekly": "const s = globalThis.__p4a2.state; export const runWeeklyReviews = (...a) => s.runWeeklyReviews(...a);",
  "@/lib/basic-plan": "export const genTemplateCaptions = async () => ({});",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __p4a2: unknown }).__p4a2 = { state, prisma: fakePrisma };
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

const { requireAuth, requireAdmin } = await import("../../src/lib/api-auth.ts");
const { checkInternalKey } = await import("../../src/lib/internal-auth.ts");
const { encryptToken } = await import("../../src/lib/crypto.ts");
const driveSync = await import("../../src/app/api/drive/sync/route.ts");
const metaAssets = await import("../../src/app/api/meta/connections/[id]/assets/route.ts");
const calendarCommit = await import("../../src/app/api/ai/calendar/commit/route.ts");
const driveFolders = await import("../../src/app/api/drive/folders/route.ts");
const weeklyRun = await import("../../src/app/api/internal/weekly/run/route.ts");
const metaConnections = await import("../../src/app/api/meta/connections/route.ts");
const generateMonth = await import("../../src/app/api/art-templates/generate-month/route.ts");

// ------------------------------------------------------------ helpers

let ip = 0;
type Req = Request & { nextUrl: URL };
function req(url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Req {
  const full = `http://localhost${url}`;
  const r = new Request(full, {
    method: init.method ?? "GET",
    // IP próprio por chamada: o rate limit real não interfere
    headers: { "content-type": "application/json", "x-forwarded-for": `10.42.0.${++ip}`, ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return Object.assign(r, { nextUrl: new URL(full) });
}

async function read(res: Response | null): Promise<{ status: number; json: Row }> {
  assert.ok(res, "esperava uma Response");
  return { status: res.status, json: (await res.json()) as Row };
}

/** `error` é texto pt-BR para o usuário: string, sem os trechos técnicos/ingleses informados. */
function assertFriendly(json: Row, forbidden: RegExp[] = []) {
  assert.equal(typeof json.error, "string", `error não é string: ${JSON.stringify(json)}`);
  const text = json.error as string;
  for (const re of [/Unauthorized|Forbidden/, /\bError\b|Exception/, /https?:\/\//, /[A-Z][A-Z0-9]*_[A-Z0-9_]+/, ...forbidden]) {
    assert.doesNotMatch(text, re, `texto técnico na resposta: ${text}`);
  }
}

const graphError = (status: number, message: string, code: number) =>
  new Response(JSON.stringify({ error: { message, type: "OAuthException", code } }), {
    status,
    headers: { "content-type": "application/json" },
  });

const geminiText = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const SESSION_EXPIRED = "Sua sessão expirou. Entre de novo.";
const ADMIN_ONLY = "Acesso restrito a administradores";
const DRIVE_NOT_CONFIGURED =
  "A integração com o Google Drive não está configurada no servidor. Avise o administrador do sistema.";
const R2_NOT_CONFIGURED = "O armazenamento de mídia não está configurado no servidor. Avise o administrador do sistema.";
const AI_NOT_CONFIGURED = "A inteligência artificial não está configurada no servidor. Avise o administrador do sistema.";
const TOKEN_UNREADABLE =
  "Não foi possível ler o token salvo desta conexão. Cole o token de novo para atualizar a conexão.";

function resetState() {
  state.session = { user: { role: "admin" } };
  state.connections.clear();
  state.txError = null;
  state.fetch = null;
  logs.length = 0;
  process.env.TOKEN_ENC_KEY = KEY_HEX;
  process.env.INTERNAL_API_KEY = "chave-interna-falsa";
  process.env.GEMINI_API_KEY = "chave-ia-falsa";
  process.env.DRIVE_ROOT_FOLDER_ID = "raiz-falsa";
}

// ------------------------------------------------------------ 4. 401/403 em pt-BR

describe("4. 401/403 em pt-BR (api-auth e internal-auth), mesmo status e formato { error }", () => {
  beforeEach(resetState);

  test("requireAuth sem sessão → 401 { error: 'Sua sessão expirou. Entre de novo.' }; com sessão → null", async () => {
    state.session = null;
    const r = await read(await requireAuth());
    assert.equal(r.status, 401);
    assert.deepEqual(r.json, { error: SESSION_EXPIRED });
    state.session = { user: { role: "staff" } };
    assert.equal(await requireAuth(), null);
  });

  test("requireAdmin: sem sessão → 401 pt-BR; staff → 403 pt-BR; admin → null", async () => {
    state.session = null;
    const anon = await read(await requireAdmin());
    assert.equal(anon.status, 401);
    assert.deepEqual(anon.json, { error: SESSION_EXPIRED });
    state.session = { user: { role: "staff" } };
    const staff = await read(await requireAdmin());
    assert.equal(staff.status, 403);
    assert.deepEqual(staff.json, { error: ADMIN_ONLY });
    state.session = { user: { role: "admin" } };
    assert.equal(await requireAdmin(), null);
  });

  test("rota protegida sem sessão (drive/sync) → 401 com o texto pt-BR", async () => {
    state.session = null;
    const r = await read(await driveSync.POST(req("/api/drive/sync", { method: "POST", body: {} }) as never));
    assert.equal(r.status, 401);
    assert.deepEqual(r.json, { error: SESSION_EXPIRED });
  });

  test("checkInternalKey: chave errada → 401 { error } pt-BR; chave certa → null", async () => {
    const wrong = await read(checkInternalKey(req("/api/internal/x", { headers: { "x-internal-key": "errada" } }) as never));
    assert.equal(wrong.status, 401);
    assert.deepEqual(Object.keys(wrong.json), ["error"]);
    assertFriendly(wrong.json);
    assert.match(wrong.json.error as string, /chave/i);
    assert.equal(checkInternalKey(req("/api/internal/x", { headers: { "x-internal-key": "chave-interna-falsa" } }) as never), null);
  });

  test("internal/weekly/run sem sessão e sem chave → 401 pt-BR", async () => {
    state.session = null;
    const r = await read(await weeklyRun.POST(req("/api/internal/weekly/run", { method: "POST" }) as never));
    assert.equal(r.status, 401);
    assertFriendly(r.json);
  });
});

// ------------------------------------------------------------ 1. configuração → 503

describe("1. falha de configuração → 503 com texto pt-BR (drive/sync e meta assets)", () => {
  beforeEach(resetState);

  const sync = async () => read(await driveSync.POST(req("/api/drive/sync", { method: "POST", body: { clientId: CLIENT_ID } }) as never));

  test("drive/sync: Drive não configurado → 503 + texto do Drive; detalhe no log", async () => {
    state.syncMedia = async () => {
      throw new Error("Drive não configurado (.env)");
    };
    const r = await sync();
    assert.equal(r.status, 503);
    assert.deepEqual(r.json, { error: DRIVE_NOT_CONFIGURED });
    assert.ok(logs.some((l) => l.includes("Drive não configurado (.env)")), logs.join("\n"));
  });

  test("drive/sync: service account ausente e R2 não configurado → 503, sem nome de variável", async () => {
    state.syncMedia = async () => {
      throw new Error("Nenhuma service account configurada. Defina GOOGLE_SERVICE_ACCOUNT_JSON (produção) ou GOOGLE_SERVICE_ACCOUNT_FILE (dev).");
    };
    const sa = await sync();
    assert.equal(sa.status, 503);
    assert.deepEqual(sa.json, { error: DRIVE_NOT_CONFIGURED });
    state.syncMedia = async () => {
      throw new Error("R2 não configurado");
    };
    const r2 = await sync();
    assert.equal(r2.status, 503);
    assert.deepEqual(r2.json, { error: R2_NOT_CONFIGURED });
  });

  test("drive/sync: falha de execução (não de configuração) continua 500 com texto pt-BR", async () => {
    state.syncMedia = async () => {
      throw new Error('Drive list falhou: 500 {"error":{"message":"Internal Error"}}');
    };
    const r = await sync();
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: "Não foi possível acessar o Google Drive. Tente de novo em instantes." });
  });

  const assets = async (id: string) =>
    read(await metaAssets.GET(req(`/api/meta/connections/${id}/assets?refresh=1`) as never, { params: Promise.resolve({ id }) }));

  test("meta assets: token salvo ilegível → 503 TOKEN_UNREADABLE; detalhe no log", async () => {
    state.connections.set("conn-ilegivel", { accessTokenEnc: "isto-nao-e-um-token-cifrado", status: "active" });
    const r = await assets("conn-ilegivel");
    assert.equal(r.status, 503);
    assert.deepEqual(r.json, { error: TOKEN_UNREADABLE });
    assert.ok(logs.some((l) => l.includes("conn-ilegivel")), logs.join("\n"));
  });

  test("meta assets: sem TOKEN_ENC_KEY → 503 'A proteção de credenciais não está configurada…'", async () => {
    state.connections.set("conn-sem-chave", { accessTokenEnc: encryptToken("EAAG-token-falso-0123456789"), status: "active" });
    delete process.env.TOKEN_ENC_KEY;
    const r = await assets("conn-sem-chave");
    assert.equal(r.status, 503);
    assert.deepEqual(r.json, {
      error: "A proteção de credenciais não está configurada no servidor. Avise o administrador do sistema.",
    });
  });

  test("meta assets: token expirado na Graph (texto em inglês) continua 502 com texto pt-BR", async () => {
    state.connections.set("conn-expirada", { accessTokenEnc: encryptToken("EAAG-token-falso-0123456789"), status: "active" });
    state.fetch = async (url) => {
      assert.match(url, /^https:\/\/graph\.facebook\.com\//);
      return graphError(400, "Error validating access token: Session has expired on Thursday, 01-Oct-26.", 190);
    };
    const r = await assets("conn-expirada");
    assert.equal(r.status, 502);
    assertFriendly(r.json, [/Session|validating/]);
    assert.match(r.json.error as string, /expirou ou foi revogado/);
  });
});

// ------------------------------------------------------------ 2. commit sem texto do Prisma

describe("2. ai/calendar/commit: erro do banco → 500 pt-BR genérico, detalhe só no log", () => {
  beforeEach(resetState);

  const body = {
    clientId: CLIENT_ID,
    month: "2026-11",
    posts: [{ theme: "ZZ QA P4A2", format: "feed", scheduledAt: "2026-11-10T21:00:00.000Z", targets: ["instagram"] }],
  };
  const commit = async () => read(await calendarCommit.POST(req("/api/ai/calendar/commit", { method: "POST", body }) as never));

  for (const [name, message] of [
    ["PrismaClientKnownRequestError", "\nInvalid `tx.post.createMany()` invocation:\n\nUnique constraint failed on the fields: (`id`)"],
    [
      "PrismaClientKnownRequestError",
      "Transaction already closed: A commit cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms.",
    ],
    ["PrismaClientUnknownRequestError", 'invalid byte sequence for encoding "UTF8": 0x00'],
  ] as const) {
    test(`${name}: "${message.trim().slice(0, 40)}…" não chega à resposta`, async () => {
      const e = new Error(message);
      e.name = name;
      state.txError = e;
      const r = await commit();
      assert.equal(r.status, 500);
      assertFriendly(r.json, [/Banco/, /invocation|constraint|Transaction|commit|byte sequence|UTF8|prisma/i]);
      assert.match(r.json.error as string, /cronograma/);
      assert.ok(logs.some((l) => l.includes(message.trim().slice(0, 30))), `detalhe não foi logado: ${logs.join("\n")}`);
    });
  }
});

// ------------------------------------------------------------ 3. drive/folders e weekly/run

describe("3. drive/folders e internal/weekly/run: nada de e.message cru", () => {
  beforeEach(resetState);

  const folders = async () => read(await driveFolders.GET(req("/api/drive/folders") as never));

  test("drive/folders: 'Drive list falhou: 403 {…}' → 502 'Sem acesso à pasta…'; detalhe no log", async () => {
    state.listFolders = async () => {
      throw new Error('Drive list falhou: 403 {"error":{"code":403,"message":"The caller does not have permission"}}');
    };
    const r = await folders();
    assert.equal(r.status, 502);
    assertFriendly(r.json, [/caller|permission/]);
    assert.match(r.json.error as string, /^Sem acesso à pasta no Google Drive/);
    assert.ok(logs.some((l) => l.includes("The caller does not have permission")), logs.join("\n"));
  });

  test("drive/folders: exceção do runtime em inglês → 502 com texto pt-BR da rota", async () => {
    state.listFolders = async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'files')");
    };
    const r = await folders();
    assert.equal(r.status, 502);
    assertFriendly(r.json, [/Cannot read|properties|undefined/]);
    assert.match(r.json.error as string, /pastas do Google Drive/);
  });

  const weekly = async () => read(await weeklyRun.POST(req("/api/internal/weekly/run", { method: "POST" }) as never));

  test("weekly/run: exceção crua → 500 com texto pt-BR; detalhe no log", async () => {
    state.runWeeklyReviews = async () => {
      throw new TypeError("Cannot read properties of null (reading 'token')");
    };
    const r = await weekly();
    assert.equal(r.status, 500);
    assertFriendly(r.json, [/Cannot read|properties|null/]);
    assert.match(r.json.error as string, /links da semana/);
    assert.ok(logs.some((l) => l.includes("Cannot read properties of null")), logs.join("\n"));
  });

  test("weekly/run: IA sem chave → 500 com o texto de configuração da IA (sem nome de variável)", async () => {
    state.runWeeklyReviews = async () => {
      throw new Error("GEMINI_API_KEY não configurada");
    };
    const r = await weekly();
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: AI_NOT_CONFIGURED });
  });
});

// ------------------------------------------------------------ 5. Graph e IA sem inglês

describe("5. meta/connections (POST) e generate-month: sem texto em inglês da Graph/IA", () => {
  beforeEach(resetState);

  const connect = async () =>
    read(await metaConnections.POST(req("/api/meta/connections", { method: "POST", body: { token: "EAAG-token-falso-0123456789" } }) as never));

  test("token expirado/inválido (Graph #190) → 400 'Token recusado pela Meta: …' em pt-BR; detalhe no log", async () => {
    state.fetch = async () => graphError(400, "Error validating access token: Session has expired on Thursday, 01-Oct-26.", 190);
    const r = await connect();
    assert.equal(r.status, 400);
    assertFriendly(r.json, [/Session|validating|access token/i]);
    assert.match(r.json.error as string, /^Token recusado pela Meta/);
    assert.match(r.json.error as string, /expirou|revogado/);
    assert.ok(logs.some((l) => l.includes("Session has expired")), logs.join("\n"));
  });

  test("sem permissão (Graph #10) → 400 pt-BR que fala de permissão", async () => {
    state.fetch = async () => graphError(403, "(#10) Requires business_management permission to manage the object", 10);
    const r = await connect();
    assert.equal(r.status, 400);
    assertFriendly(r.json, [/Requires|business_management|manage the object/]);
    assert.match(r.json.error as string, /^Token recusado pela Meta/);
    assert.match(r.json.error as string, /permissão/);
  });

  test("erro desconhecido da Graph → 400 pt-BR genérico", async () => {
    state.fetch = async () => graphError(400, "(#100) Unsupported get request. Please read the Graph API documentation", 100);
    const r = await connect();
    assert.equal(r.status, 400);
    assertFriendly(r.json, [/Unsupported|Please read|documentation/]);
    assert.match(r.json.error as string, /^Token recusado pela Meta/);
  });

  test("demora (AbortError) e falha de rede → 502 com o texto do toUserMessage", async () => {
    state.fetch = async () => {
      const e = new Error("This operation was aborted");
      e.name = "AbortError";
      throw e;
    };
    const slow = await connect();
    assert.equal(slow.status, 502);
    assert.deepEqual(slow.json, { error: "A Meta demorou demais para responder. Tente de novo em instantes." });
    state.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const offline = await connect();
    assert.equal(offline.status, 502);
    assert.deepEqual(offline.json, { error: "Falha de conexão com o serviço externo. Tente de novo em instantes." });
  });

  const generate = async () =>
    read(
      await generateMonth.POST(
        req("/api/art-templates/generate-month", { method: "POST", body: { month: "2027-03", baseImageUrl: "https://example.com/arte.png" } }) as never
      )
    );

  test("generate-month: Gemini 400 com JSON em inglês → 502 pt-BR; detalhe no log", async () => {
    state.fetch = async (url) => {
      assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\//);
      return new Response('{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}', { status: 400 });
    };
    const r = await generate();
    assert.equal(r.status, 502);
    assertFriendly(r.json, [/^IA:/, /API key|INVALID_ARGUMENT|Gemini/]);
    assert.ok(logs.some((l) => l.includes("API key not valid")), logs.join("\n"));
  });

  test("generate-month: JSON sem 'titles' → 502 'não devolveu um resultado válido'", async () => {
    state.fetch = async () => geminiText('{"items":[]}');
    const r = await generate();
    assert.equal(r.status, 502);
    assert.deepEqual(r.json, { error: "A inteligência artificial não devolveu um resultado válido. Tente de novo." });
  });

  test("generate-month: resposta que não é JSON → 502 com texto pt-BR da rota (sem SyntaxError)", async () => {
    state.fetch = async () => geminiText("Claro! Aqui estão os títulos: …");
    const r = await generate();
    assert.equal(r.status, 502);
    assertFriendly(r.json, [/^IA:/, /Unexpected token|JSON|SyntaxError/]);
  });

  test("generate-month: IA sem chave → 502 com o texto de configuração da IA", async () => {
    delete process.env.GEMINI_API_KEY;
    const r = await generate();
    assert.equal(r.status, 502);
    assert.deepEqual(r.json, { error: AI_NOT_CONFIGURED });
  });
});
