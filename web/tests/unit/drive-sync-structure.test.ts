/**
 * S16: estrutura Cliente/AAAA/Mês no sync, no commit do cronograma e no plano básico.
 *
 * `drive-sync.ts` usa o alias "@/" e o Prisma, então não dá para importá-lo
 * direto como os módulos puros. Duas técnicas, ambas sem rede e sem banco:
 * 1. leitura do código-fonte: prova que o sync usa `resolveMonthFolder` e
 *    `buildMonthIndex` do `drive-layout` e que não sobrou cópia local;
 * 2. execução real de `syncMedia`, `ensureYearMonthFolders` e
 *    `prepareClientDriveFolders` (e, no P4-D, os vários stories do mesmo
 *    post: "4story.jpg", "4story2.jpg"…): hooks de módulo resolvem "@/" e trocam
 *    Prisma, R2 e media-token por versões falsas; o `fetch` é trocado por um
 *    Google Drive falso em memória (qualquer outra URL faz o teste falhar).
 */
import { after, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const source = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

// ---------------------------------------------------------------------------
// 1. Estrutura (leitura do código-fonte)
// ---------------------------------------------------------------------------

describe("estrutura do código (S16)", () => {
  const sync = source("lib/drive-sync.ts");
  const drive = source("lib/google-drive.ts");
  const basic = source("lib/basic-plan.ts");

  test("drive-sync importa resolveMonthFolder, buildMonthIndex e buildMonthFileNames do drive-layout e os usa", () => {
    const imp = /import\s*\{([^}]*)\}\s*from\s*"@\/lib\/drive-layout"/.exec(sync);
    assert.ok(imp, "drive-sync.ts não importa de @/lib/drive-layout");
    for (const name of ["resolveMonthFolder", "buildMonthIndex", "buildMonthFileNames", "drivePathLabel"]) {
      assert.match(imp[1], new RegExp(`\\b${name}\\b`), name);
    }
    assert.match(sync, /resolveMonthFolder\(listFolders, clientFolderId, y, m, client\.name\)/);
    // plano básico: N.ext pelo buildMonthIndex (sem mudança); sync: nomes com a ordem do story
    assert.match(sync, /return buildMonthIndex\(monthPosts\)/);
    assert.match(sync, /return buildMonthFileNames\(monthPosts\)/);
    assert.match(sync, /await monthFileNamesFor\(client\.id, monthKey\)/);
  });

  test("nenhuma cópia local de buildMonthIndex, buildMonthFileNames ou monthFolderName", () => {
    for (const [name, src] of [
      ["drive-sync.ts", sync],
      ["google-drive.ts", drive],
      ["basic-plan.ts", basic],
    ]) {
      assert.doesNotMatch(src, /function\s+(buildMonthIndex|buildMonthFileNames|monthFolderName)\b/, name);
    }
    assert.doesNotMatch(basic, /ensureFolder\(monthFolderName/);
  });

  test("revisão do cronograma usa os mesmos nomes do sync (buildMonthFileNames), sem \"Nstory\" fixo", () => {
    const review = source("app/(app)/clients/[id]/CalendarReviewModal.tsx");
    assert.match(review, /import\s*\{[^}]*\bbuildMonthFileNames\b[^}]*\}\s*from\s*"@\/lib\/drive-layout"/);
    assert.match(review, /buildMonthFileNames\(list\)/);
    assert.doesNotMatch(review, /`\$\{n\}story\.jpg`/);
  });

  test("google-drive.ts sem bytes NUL (o git o tratava como binário)", () => {
    assert.equal(drive.includes("\u0000"), false);
  });

  test("google-drive e basic-plan usam o drive-layout (ano/mês, story, N.ext)", () => {
    assert.match(drive, /from "@\/lib\/drive-layout"/);
    assert.match(basic, /ensureYearMonthFolders\(clientFolderId, monthKey, client\.name\)/);
    assert.match(basic, /uploadToDrive\(`\$\{n\}\.\$\{ext\}`/);
    assert.doesNotMatch(basic, /\$\{pad\(day\)\} - \$\{tpl\.name\}/);
  });
});

// ---------------------------------------------------------------------------
// 2. Execução real com Drive, Prisma e R2 falsos
// ---------------------------------------------------------------------------

const FOLDER = "application/vnd.google-apps.folder";
type DriveNode = { id: string; name: string; mimeType: string; parent: string };
type FakePost = {
  id: string;
  clientId: string;
  format: string;
  status: string;
  theme: string | null;
  scheduledAt: Date;
  createdAt: Date;
  mediaUrl: string | null;
  mediaDriveId: string | null;
  mediaItems: unknown;
};
type FakeClient = { id: string; name: string; driveFolderId: string | null };
type Range = { gte?: Date; lt?: Date };

const state = {
  nodes: [] as DriveNode[],
  posts: [] as FakePost[],
  clients: [] as FakeClient[],
  calls: [] as { method: string; url: URL }[],
  r2: false,
  failList: false,
  seq: 0,
};

function reset() {
  state.nodes = [];
  state.posts = [];
  state.clients = [];
  state.calls = [];
  state.r2 = false;
  state.failList = false;
  state.seq = 0;
}

function folder(parent: string, name: string): string {
  const id = `pasta${++state.seq}`;
  state.nodes.push({ id, name, mimeType: FOLDER, parent });
  return id;
}

function file(parent: string, name: string, mimeType = "image/jpeg"): string {
  const id = `arq${++state.seq}`;
  state.nodes.push({ id, name, mimeType, parent });
  return id;
}

const inRange = (d: Date, r?: Range) => !r || ((!r.gte || d >= r.gte) && (!r.lt || d < r.lt));
const chrono = (a: FakePost, b: FakePost) =>
  a.scheduledAt.getTime() - b.scheduledAt.getTime() ||
  a.createdAt.getTime() - b.createdAt.getTime() ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const fakePrisma = {
  post: {
    async findMany({ where }: { where: { clientId?: string; scheduledAt?: Range; status?: { in: string[] }; OR?: unknown } }) {
      return state.posts
        .filter(
          (p) =>
            (!where.clientId || p.clientId === where.clientId) &&
            inRange(p.scheduledAt, where.scheduledAt) &&
            (!where.status || where.status.in.includes(p.status)) &&
            (!where.OR || !p.mediaUrl)
        )
        .sort(chrono)
        .map((p) => ({ ...p, client: state.clients.find((c) => c.id === p.clientId) }));
    },
    async update({ where, data }: { where: { id: string }; data: Partial<FakePost> }) {
      const p = state.posts.find((x) => x.id === where.id);
      assert.ok(p, `post ${where.id} inexistente`);
      return Object.assign(p, data);
    },
  },
  client: {
    async update({ where, data }: { where: { id: string }; data: Partial<FakeClient> }) {
      const c = state.clients.find((x) => x.id === where.id);
      assert.ok(c, `cliente ${where.id} inexistente`);
      return Object.assign(c, data);
    },
  },
};

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = (init?.method ?? "GET").toUpperCase();
  state.calls.push({ method, url });
  if (url.origin === "https://oauth2.googleapis.com" && url.pathname === "/token") {
    return Response.json({ access_token: "token-falso", expires_in: 3600 });
  }
  if (url.origin === "https://www.googleapis.com" && url.pathname === "/drive/v3/files") {
    if (method === "GET") {
      if (state.failList) return new Response("forbidden", { status: 403 });
      const q = url.searchParams.get("q") ?? "";
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const onlyFolders = q.includes(`mimeType = '${FOLDER}'`);
      const files = state.nodes
        .filter((n) => n.parent === parent && (!onlyFolders || n.mimeType === FOLDER))
        .map(({ id, name, mimeType }) => ({ id, name, mimeType }));
      return Response.json({ files });
    }
    if (method === "POST") {
      const body = JSON.parse(String(init?.body)) as { name: string; mimeType: string; parents: string[] };
      assert.equal(body.mimeType, FOLDER);
      return Response.json({ id: folder(body.parents[0], body.name) });
    }
  }
  const media = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
  // OWASP AUD2-08: metadados (pais) para conferir se a pasta salva fica dentro da raiz
  if (url.origin === "https://www.googleapis.com" && media && method === "GET" && url.searchParams.get("fields") === "id,parents,trashed") {
    if (state.failList) return new Response("forbidden", { status: 403 });
    const node = state.nodes.find((n) => n.id === decodeURIComponent(media[1]));
    return node ? Response.json({ id: node.id, parents: [node.parent], trashed: false }) : new Response("not found", { status: 404 });
  }
  if (url.origin === "https://www.googleapis.com" && media && url.searchParams.get("alt") === "media") {
    const node = state.nodes.find((n) => n.id === media[1]);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": node?.mimeType ?? "image/jpeg" } });
  }
  throw new Error(`fetch inesperado no teste: ${method} ${url.href}`);
}

const FAKE_MODULES: Record<string, string> = {
  "@/lib/prisma": "export const prisma = globalThis.__s16.prisma;",
  "@/generated/prisma/client": "export const Prisma = { JsonNull: 'JsonNull' };",
  "@/lib/media-token": "export const mediaUrlFor = (id) => 'https://app.test/api/media/' + id;",
  "@/lib/r2":
    "export const r2Configured = () => globalThis.__s16.state.r2;" +
    "export const uploadToR2 = async (key) => 'https://r2.test/' + key;",
};

type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __s16: unknown }).__s16 = { prisma: fakePrisma, state };
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

// service account de mentira (nada sai daqui: o fetch é falso) e raiz falsa
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: "teste@exemplo.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});
process.env.DRIVE_ROOT_FOLDER_ID = "raiz";
delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
delete process.env.GOOGLE_IMPERSONATE_EMAIL;

const realFetch = globalThis.fetch;
globalThis.fetch = fakeFetch as typeof fetch;

const { syncMedia, prepareClientDriveFolders } = await import("../../src/lib/drive-sync.ts");
const { ensureYearMonthFolders, matchesIndexName } = await import("../../src/lib/google-drive.ts");

const CLIENT = "Clínica Ação";
const at = (iso: string) => new Date(`${iso}:00-03:00`);

function post(id: string, format: string, when: string, extra: Partial<FakePost> = {}): FakePost {
  const p: FakePost = {
    id,
    clientId: "c1",
    format,
    status: "draft",
    theme: null,
    scheduledAt: at(when),
    createdAt: at("2026-09-20T10:00"),
    mediaUrl: null,
    mediaDriveId: null,
    mediaItems: null,
    ...extra,
  };
  state.posts.push(p);
  return p;
}

/** Raiz com a pasta do cliente com outro jeito de escrever (sem acento, maiúsculas). */
function clientFolder(): string {
  state.clients.push({ id: "c1", name: CLIENT, driveFolderId: null });
  return folder("raiz", "CLINICA ACAO");
}

const posted = () => state.calls.filter((c) => c.method !== "GET" && c.url.origin === "https://www.googleapis.com");
const LEAK = /API_KEY|\.env|R2|RESEND|LINKEDIN_CLIENT|GEMINI|SECRET/;

describe("syncMedia com Drive falso (S16)", () => {
  before(() => {
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-05T12:00:00-03:00") });
  });
  after(() => {
    mock.timers.reset();
  });
  beforeEach(reset);

  test("Cliente/2026/10 - Outubro: N.jpg, Nstory.jpg; o ano/mês vence a pasta antiga", async () => {
    const cli = clientFolder();
    const out = folder(folder(cli, "2026"), "10 - Outubro");
    const f1 = file(out, "1.jpg");
    const s1 = file(out, "1story.jpg");
    const f2 = file(out, "2.png", "image/png");
    file(folder(cli, "outubro"), "1.jpg"); // estrutura antiga do mesmo mês: ignorada
    const p1 = post("p1", "feed", "2026-10-06T09:00");
    const ps = post("ps", "story", "2026-10-06T09:15");
    const p2 = post("p2", "feed", "2026-10-08T18:00");

    const r = await syncMedia({ clientId: "c1" });

    assert.equal(r.attached, 3);
    assert.equal(r.checked, 3);
    assert.deepEqual([p1.mediaDriveId, ps.mediaDriveId, p2.mediaDriveId], [f1, s1, f2]);
    assert.equal(p1.mediaUrl, "https://app.test/api/media/p1");
    assert.deepEqual(r.layout, [
      { client: CLIENT, month: "2026-10", layout: "ano/mes", path: `${CLIENT}/2026/10 - Outubro` },
    ]);
    assert.deepEqual([r.skipped, r.missing, r.ambiguous], [[], [], []]);
    assert.equal(posted().length, 0, "o sync não cria nada no Drive");
  });

  test("estrutura antiga Cliente/outubro: anexa os mesmos arquivos que o sync antigo", async () => {
    const leg = folder(clientFolder(), "outubro");
    const f1 = file(leg, "1.jpg");
    const s1 = file(leg, "1story.jpg");
    const f2 = file(leg, "02 - Promoção.jpg");
    const p1 = post("p1", "feed", "2026-10-06T09:00");
    const ps = post("ps", "story", "2026-10-06T09:15");
    const p2 = post("p2", "reels", "2026-10-08T18:00");

    const r = await syncMedia({ clientId: "c1" });

    assert.equal(r.attached, 3);
    assert.deepEqual([p1.mediaDriveId, ps.mediaDriveId, p2.mediaDriveId], [f1, s1, f2]);
    assert.deepEqual(r.layout, [
      { client: CLIENT, month: "2026-10", layout: "legado", path: `${CLIENT}/outubro (estrutura antiga)` },
    ]);
  });

  test("ano sem o mês cai na estrutura antiga (A1)", async () => {
    const cli = clientFolder();
    folder(folder(cli, "2026"), "09 - Setembro");
    const f1 = file(folder(cli, "Outubro"), "1.jpg");
    const p1 = post("p1", "feed", "2026-10-06T09:00");

    const r = await syncMedia({ clientId: "c1" });

    assert.equal(p1.mediaDriveId, f1);
    assert.equal(r.layout[0].layout, "legado");
    assert.equal(r.layout[0].path, `${CLIENT}/Outubro (estrutura antiga)`);
  });

  test("missing mostra o caminho completo (ano/mês e estrutura antiga)", async () => {
    const cli = clientFolder();
    file(folder(folder(cli, "2026"), "10 - Outubro"), "1.jpg");
    post("p1", "feed", "2026-10-06T09:00");
    post("p2", "reels", "2026-10-08T18:00", { theme: "Lançamento" });
    post("p2s", "story", "2026-10-08T18:15");

    const r = await syncMedia({ clientId: "c1" });

    assert.equal(r.attached, 1);
    assert.deepEqual(r.missing, [
      { client: CLIENT, post: "post 2 (Lançamento)", expected: `${CLIENT}/2026/10 - Outubro/2.mp4` },
      { client: CLIENT, post: "post 2", expected: `${CLIENT}/2026/10 - Outubro/2story.jpg` },
    ]);

    reset();
    file(folder(clientFolder(), "outubro"), "1.jpg");
    post("p1", "feed", "2026-10-06T09:00");
    post("p2", "feed", "2026-10-08T18:00");
    const legacy = await syncMedia({ clientId: "c1" });
    assert.deepEqual(legacy.missing, [
      { client: CLIENT, post: "post 2", expected: `${CLIENT}/outubro/2.jpg (estrutura antiga)` },
    ]);
  });

  test("sem pasta do mês: skipped com o caminho esperado e layout null", async () => {
    folder(clientFolder(), "Fotos");
    post("p1", "feed", "2026-10-06T09:00");

    const r = await syncMedia({ clientId: "c1" });

    assert.equal(r.attached, 0);
    assert.deepEqual(r.skipped, [
      { client: CLIENT, reason: `pasta do mês não encontrada no Drive (esperado "${CLIENT}/2026/10 - Outubro")` },
    ]);
    assert.deepEqual(r.layout, [
      { client: CLIENT, month: "2026-10", layout: null, path: `${CLIENT}/2026/10 - Outubro` },
    ]);
  });

  test("sem pasta do cliente: skipped e nenhuma pasta criada", async () => {
    state.clients.push({ id: "c1", name: CLIENT, driveFolderId: null });
    post("p1", "feed", "2026-10-06T09:00");

    const r = await syncMedia({ clientId: "c1" });

    assert.deepEqual(r.skipped, [{ client: CLIENT, reason: `pasta do cliente "${CLIENT}" não encontrada no Drive` }]);
    assert.equal(posted().length, 0);
  });

  test("ambiguous: pastas 'Outubro' e '10' no ano e dois arquivos para o mesmo N", async () => {
    const ano = folder(clientFolder(), "2026");
    folder(ano, "10");
    const out = folder(ano, "Outubro");
    const exato = file(out, "1.jpg");
    file(out, "01 - Capa.jpg");
    const p1 = post("p1", "feed", "2026-10-06T09:00");

    const r = await syncMedia({ clientId: "c1" });

    assert.equal(p1.mediaDriveId, exato);
    assert.deepEqual(r.ambiguous, [
      { client: CLIENT, path: CLIENT, chosen: "2026/Outubro", candidates: ["2026/Outubro", "2026/10"] },
      {
        client: CLIENT,
        post: "post 1",
        path: `${CLIENT}/2026/Outubro`,
        chosen: "1.jpg",
        candidates: ["1.jpg", "01 - Capa.jpg"],
      },
    ]);
  });

  test("carrossel N/ sem os arquivos de story; story achado dentro de N/ (com R2)", async () => {
    state.r2 = true;
    const out = folder(folder(clientFolder(), "2026"), "10 - Outubro");
    const c1 = folder(out, "1");
    const [a, b, j] = [file(c1, "2.jpg"), file(c1, "10.jpg"), file(c1, "1.jpg")];
    const s1 = file(c1, "1story.jpg");
    const c2 = folder(out, "02 - Dicas");
    file(c2, "a.jpg");
    file(c2, "b.jpg");
    const s2 = file(c2, "story.jpg");
    const pc1 = post("pc1", "carrossel", "2026-10-06T09:00");
    const ps1 = post("ps1", "story", "2026-10-06T09:15");
    const pc2 = post("pc2", "feed", "2026-10-09T09:00"); // 2+ mídias → vira carrossel
    const ps2 = post("ps2", "story", "2026-10-09T09:15");

    const r = await syncMedia({ clientId: "c1" });

    assert.equal(r.attached, 4);
    const ids = (p: FakePost) => (p.mediaItems as { driveId: string }[]).map((i) => i.driveId);
    assert.deepEqual(ids(pc1), [j, a, b], "slides 1, 2, 10 sem o 1story");
    assert.equal(ps1.mediaDriveId, s1);
    assert.equal(ids(pc2).length, 2, "story.jpg não entra nos slides");
    assert.equal(pc2.format, "carrossel");
    assert.equal(ps2.mediaDriveId, s2);
    assert.match(String(ps2.mediaUrl), /^https:\/\/r2\.test\/c1\/ps2-1\.jpg$/);
  });

  test("story na pasta do mês tem prioridade sobre o da subpasta N/", async () => {
    const out = folder(folder(clientFolder(), "2026"), "10 - Outubro");
    const noMes = file(out, "1story.jpg");
    file(folder(out, "1"), "1story.jpg");
    file(out, "1.jpg");
    post("p1", "feed", "2026-10-06T09:00");
    const ps = post("ps", "story", "2026-10-06T09:15");

    await syncMedia({ clientId: "c1" });

    assert.equal(ps.mediaDriveId, noMes);
  });

  test("carrossel sem R2: skipped com o caminho da subpasta, sem jargão", async () => {
    folder(folder(folder(clientFolder(), "2026"), "10 - Outubro"), "1");
    post("pc1", "carrossel", "2026-10-06T09:00");

    const r = await syncMedia({ clientId: "c1" });

    assert.equal(r.skipped.length, 1);
    assert.match(r.skipped[0].reason, new RegExp(`${CLIENT}/2026/10 - Outubro/1/`));
    assert.doesNotMatch(r.skipped[0].reason, LEAK);
  });

  test("numeração conta todos os status do mês (publicado e com falha também)", async () => {
    const out = folder(folder(clientFolder(), "2026"), "10 - Outubro");
    file(out, "1.jpg");
    file(out, "2.jpg");
    const f3 = file(out, "3.jpg");
    post("pub", "feed", "2026-10-01T09:00", { status: "published", mediaUrl: "https://r2.test/x.jpg" });
    post("fal", "carrossel", "2026-10-02T09:00", { status: "failed" });
    post("st", "story", "2026-10-02T09:15", { status: "failed" });
    const p3 = post("p3", "feed", "2026-10-06T09:00");

    const r = await syncMedia({ clientId: "c1" });

    assert.equal(r.checked, 1);
    assert.equal(p3.mediaDriveId, f3);
  });

  test("Cliente/2025/10 - Outubro não é usada para 2026", async () => {
    const cli = clientFolder();
    file(folder(folder(cli, "2025"), "10 - Outubro"), "1.jpg");
    const p1 = post("p1", "feed", "2026-10-06T09:00");

    const r = await syncMedia({ clientId: "c1" });

    assert.equal(p1.mediaDriveId, null);
    assert.equal(r.layout[0].layout, null);
  });
});

describe("vários stories do mesmo post: Nstory, Nstory2… (P4-D, A2)", () => {
  before(() => {
    mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-05T12:00:00-03:00") });
  });
  after(() => {
    mock.timers.reset();
  });
  beforeEach(reset);

  const MES = `${CLIENT}/2026/10 - Outubro`;
  /** Cliente/2026/10 - Outubro com 1.jpg, 2.jpg e 3.jpg (posts 1–3 já resolvidos). */
  function monthWithFirstThree(): string {
    const out = folder(folder(clientFolder(), "2026"), "10 - Outubro");
    for (const n of [1, 2, 3]) file(out, `${n}.jpg`);
    post("f1", "feed", "2026-10-06T09:00");
    post("f2", "feed", "2026-10-08T09:00");
    post("f3", "feed", "2026-10-10T09:00");
    return out;
  }

  test("reels nº4 + story junto + story avulso seguinte → 4story.jpg e 4story2.jpg (caso N-23)", async () => {
    const out = monthWithFirstThree();
    const reels = file(out, "4.mp4", "video/mp4");
    const story1 = file(out, "4story.jpg");
    const story2 = file(out, "4story2.jpg");
    const r4 = post("r4", "reels", "2026-10-12T18:00");
    const junto = post("s4junto", "story", "2026-10-12T18:15");
    const avulso = post("s4avulso", "story", "2026-10-13T18:00");

    const r = await syncMedia({ clientId: "c1" });

    assert.deepEqual([r4.mediaDriveId, junto.mediaDriveId, avulso.mediaDriveId], [reels, story1, story2]);
    assert.equal(r.attached, 6);
    assert.deepEqual([r.missing, r.ambiguous, r.skipped], [[], [], []]);
  });

  test("falta o 2º story: missing com o caminho …/4story2.jpg; o 1º continua com 4story.jpg", async () => {
    const out = monthWithFirstThree();
    file(out, "4.mp4", "video/mp4");
    const story1 = file(out, "4story.jpg");
    post("r4", "reels", "2026-10-12T18:00");
    const junto = post("s4junto", "story", "2026-10-12T18:15");
    const avulso = post("s4avulso", "story", "2026-10-13T18:00");

    const r = await syncMedia({ clientId: "c1" });

    assert.equal(junto.mediaDriveId, story1);
    assert.equal(avulso.mediaDriveId, null, "4story.jpg não serve ao 2º story");
    assert.deepEqual(r.missing, [{ client: CLIENT, post: "post 4", expected: `${MES}/4story2.jpg` }]);
  });

  test("só 4story2.jpg: vai para o 2º story; não serve ao 1º story nem ao reels 4", async () => {
    const out = monthWithFirstThree();
    const story2 = file(out, "4story2.jpg");
    const r4 = post("r4", "reels", "2026-10-12T18:00");
    const junto = post("s4junto", "story", "2026-10-12T18:15");
    const avulso = post("s4avulso", "story", "2026-10-13T18:00");

    const r = await syncMedia({ clientId: "c1" });

    assert.equal(avulso.mediaDriveId, story2);
    assert.equal(junto.mediaDriveId, null);
    assert.equal(r4.mediaDriveId, null);
    assert.deepEqual(r.missing, [
      { client: CLIENT, post: "post 4", expected: `${MES}/4.mp4` },
      { client: CLIENT, post: "post 4", expected: `${MES}/4story.jpg` },
    ]);
  });

  test('variações de nome: "4 story.jpg", "04_STORY_2.png", "4-story-3.mp4" (3 stories do mesmo N)', async () => {
    const out = monthWithFirstThree();
    const feed = file(out, "4.jpg");
    const a = file(out, "4 story.jpg");
    const b = file(out, "04_STORY_2.png", "image/png");
    const c = file(out, "4-story-3.mp4", "video/mp4");
    const f4 = post("f4", "feed", "2026-10-12T18:00");
    const s1 = post("s1", "story", "2026-10-12T18:15");
    const s2 = post("s2", "story", "2026-10-13T18:00");
    const s3 = post("s3", "story", "2026-10-14T18:00");

    const r = await syncMedia({ clientId: "c1" });

    assert.deepEqual([f4.mediaDriveId, s1.mediaDriveId, s2.mediaDriveId, s3.mediaDriveId], [feed, a, b, c]);
    assert.deepEqual(r.ambiguous, [], "04_STORY_2.png não concorre com 4.jpg pelo feed");
    assert.equal(r.attached, 7);
  });

  test("04_STORY_2.png sozinho nunca vira o feed 4", async () => {
    const out = monthWithFirstThree();
    file(out, "04_STORY_2.png", "image/png");
    const f4 = post("f4", "feed", "2026-10-12T18:00");

    const r = await syncMedia({ clientId: "c1" });

    assert.equal(f4.mediaDriveId, null);
    assert.deepEqual(r.missing, [{ client: CLIENT, post: "post 4", expected: `${MES}/4.jpg` }]);
  });

  test('"1story1.jpg" é o 1º story (sinônimo de 1story.jpg)', async () => {
    const out = folder(folder(clientFolder(), "2026"), "10 - Outubro");
    file(out, "1.jpg");
    const a = file(out, "1story1.jpg");
    const b = file(out, "1story2.jpg");
    post("f1", "feed", "2026-10-06T09:00");
    const s1 = post("s1", "story", "2026-10-06T09:15");
    const s2 = post("s2", "story", "2026-10-07T09:00");

    await syncMedia({ clientId: "c1" });

    assert.deepEqual([s1.mediaDriveId, s2.mediaDriveId], [a, b]);
  });

  test("story antes de qualquer post → 1story.jpg; o story do post 1 → 1story2.jpg", async () => {
    const out = folder(folder(clientFolder(), "2026"), "10 - Outubro");
    const feed = file(out, "1.jpg");
    const a = file(out, "1story.jpg");
    const b = file(out, "1story2.jpg");
    const antes = post("antes", "story", "2026-10-06T08:00");
    const f1 = post("f1", "feed", "2026-10-06T09:00");
    const s1 = post("s1", "story", "2026-10-06T09:15");

    const r = await syncMedia({ clientId: "c1" });

    assert.deepEqual([antes.mediaDriveId, f1.mediaDriveId, s1.mediaDriveId], [a, feed, b]);
    assert.equal(r.attached, 3);
  });

  test('dentro de N/: "story.jpg" e "story2.jpg" são os stories, não slides (com R2)', async () => {
    state.r2 = true;
    const out = folder(folder(clientFolder(), "2026"), "10 - Outubro");
    const n1 = folder(out, "1");
    const [s1, s2] = [file(n1, "1.jpg"), file(n1, "2.jpg")];
    const st1 = file(n1, "story.jpg");
    const st2 = file(n1, "story2.jpg");
    const c1 = post("c1", "carrossel", "2026-10-06T09:00");
    const junto = post("junto", "story", "2026-10-06T09:15");
    const avulso = post("avulso", "story", "2026-10-07T09:00");

    const r = await syncMedia({ clientId: "c1" });

    assert.deepEqual((c1.mediaItems as { driveId: string }[]).map((i) => i.driveId), [s1, s2], "story2.jpg fora dos slides");
    assert.deepEqual([junto.mediaDriveId, avulso.mediaDriveId], [st1, st2]);
    assert.equal(r.attached, 3);
  });

  test("dois arquivos para o 2º story: escolhe o nome exato e informa em ambiguous", async () => {
    const out = folder(folder(clientFolder(), "2026"), "10 - Outubro");
    file(out, "1.jpg");
    file(out, "1story.jpg");
    const exato = file(out, "1story2.jpg");
    file(out, "1 story 2.png", "image/png");
    post("f1", "feed", "2026-10-06T09:00");
    post("s1", "story", "2026-10-06T09:15");
    const s2 = post("s2", "story", "2026-10-07T09:00");

    const r = await syncMedia({ clientId: "c1" });

    assert.equal(s2.mediaDriveId, exato);
    assert.deepEqual(r.ambiguous, [
      { client: CLIENT, post: "post 1", path: MES, chosen: "1story2.jpg", candidates: ["1story2.jpg", "1 story 2.png"] },
    ]);
  });

  test("matchesIndexName: o N, o story e a ordem do story", () => {
    const casos: [string, number, boolean, number, boolean][] = [
      ["4story2", 4, true, 2, true],
      ["4 story 2", 4, true, 2, true],
      ["4-story-2", 4, true, 2, true],
      ["04_STORY_2", 4, true, 2, true],
      ["4story2", 4, true, 1, false], // não é o 1º story
      ["4story2", 4, false, 1, false], // nem o feed 4
      ["04_STORY_2", 4, false, 1, false],
      ["4story", 4, true, 2, false], // 4story não serve ao 2º
      ["4story", 4, true, 1, true],
      ["4story1", 4, true, 1, true],
      ["4story2", 3, true, 2, false],
      ["3", 3, false, 1, true],
      ["03 - Título", 3, false, 1, true],
      ["31", 3, false, 1, false],
    ];
    for (const [stem, idx, story, ord, esperado] of casos) {
      assert.equal(matchesIndexName(stem, idx, story, ord), esperado, `${stem} / N=${idx} story=${story} ordem=${ord}`);
    }
  });
});

describe("ensureYearMonthFolders com Drive falso (S16)", () => {
  beforeEach(reset);

  test("cria 2026 e '10 - Outubro' quando faltam; a 2ª chamada não cria nada", async () => {
    const cli = folder("raiz", "Cliente");
    const r = await ensureYearMonthFolders(cli, "2026-10", "Cliente");
    assert.deepEqual(r.created, ["2026", "10 - Outubro"]);
    assert.equal(r.layout, "ano/mes");
    assert.equal(r.path, "Cliente/2026/10 - Outubro");
    const ano = state.nodes.find((n) => n.parent === cli && n.name === "2026");
    assert.ok(ano);
    assert.equal(state.nodes.find((n) => n.id === r.folderId)?.parent, ano.id);

    const again = await ensureYearMonthFolders(cli, "2026-10", "Cliente");
    assert.deepEqual(again.created, []);
    assert.equal(again.folderId, r.folderId);
    assert.equal(posted().length, 2);
  });

  test("ano existente sem o mês (e sem pasta antiga): cria só o mês dentro dele", async () => {
    const cli = folder("raiz", "Cliente");
    const ano = folder(cli, "2026");
    const r = await ensureYearMonthFolders(cli, "2026-11", "Cliente");
    assert.deepEqual(r.created, ["11 - Novembro"]);
    assert.equal(state.nodes.find((n) => n.id === r.folderId)?.parent, ano);
  });

  test("pasta antiga Cliente/outubro existente: reaproveita e não cria nada", async () => {
    const cli = folder("raiz", "Cliente");
    const leg = folder(cli, "outubro");
    const r = await ensureYearMonthFolders(cli, "2026-10", "Cliente");
    assert.deepEqual(r, {
      folderId: leg,
      layout: "legado",
      path: "Cliente/outubro (estrutura antiga)",
      created: [],
      ambiguous: [],
    });
    assert.equal(posted().length, 0);
  });

  test("busca tolerante: '2026/Outubro' já existente não gera '10 - Outubro'", async () => {
    const cli = folder("raiz", "Cliente");
    const out = folder(folder(cli, "2026"), "Outubro");
    const r = await ensureYearMonthFolders(cli, "2026-10", "Cliente");
    assert.equal(r.folderId, out);
    assert.equal(r.path, "Cliente/2026/Outubro");
    assert.equal(posted().length, 0);
  });
});

describe("prepareClientDriveFolders (commit do cronograma, S16)", () => {
  beforeEach(reset);

  test("sem Drive configurado: indisponivel, sem aviso e sem chamada ao Drive", async () => {
    const root = process.env.DRIVE_ROOT_FOLDER_ID;
    delete process.env.DRIVE_ROOT_FOLDER_ID;
    try {
      const r = await prepareClientDriveFolders({ id: "c1", name: CLIENT, driveFolderId: null }, ["2026-11"]);
      assert.deepEqual(r, { drive: { status: "indisponivel" } });
      assert.equal(state.calls.length, 0);
    } finally {
      process.env.DRIVE_ROOT_FOLDER_ID = root;
    }
  });

  test("cria a pasta do cliente (A2), salva o ID e prepara cada mês tocado uma vez", async () => {
    const client = { id: "c1", name: CLIENT, driveFolderId: null };
    state.clients.push({ ...client });

    const r = await prepareClientDriveFolders(client, ["2026-12", "2026-11", "2026-11"]);

    const pasta = state.nodes.find((n) => n.parent === "raiz");
    assert.ok(pasta);
    assert.equal(pasta.name, CLIENT);
    assert.equal(state.clients[0].driveFolderId, pasta.id);
    assert.deepEqual(r, {
      drive: {
        status: "ok",
        folders: [
          { month: "2026-11", layout: "ano/mes", path: `${CLIENT}/2026/11 - Novembro`, created: ["2026", "11 - Novembro"] },
          { month: "2026-12", layout: "ano/mes", path: `${CLIENT}/2026/12 - Dezembro`, created: ["12 - Dezembro"] },
        ],
      },
    });
  });

  test("pasta do cliente já existe com outra grafia: não cria outra e salva o ID dela", async () => {
    const existente = clientFolder();
    const r = await prepareClientDriveFolders({ id: "c1", name: CLIENT, driveFolderId: null }, ["2026-11"]);
    assert.equal(r.drive.status, "ok");
    assert.equal(state.clients[0].driveFolderId, existente);
    assert.equal(state.nodes.filter((n) => n.parent === "raiz").length, 1);
  });

  test("falha no Drive vira driveWarning amigável e não lança", async (t) => {
    const logged = t.mock.method(console, "error", () => {});
    state.failList = true;

    const r = await prepareClientDriveFolders({ id: "c1", name: CLIENT, driveFolderId: "pasta-salva" }, ["2026-11"]);

    assert.deepEqual(r.drive, { status: "falhou", folders: [] });
    assert.match(String(r.driveWarning), /^Cronograma salvo, mas as pastas do mês não foram preparadas no Google Drive\./);
    assert.match(String(r.driveWarning), /Sem acesso à pasta no Google Drive/);
    assert.doesNotMatch(String(r.driveWarning), LEAK);
    assert.equal(logged.mock.callCount(), 1, "o detalhe técnico vai para o log");
  });
});

after(() => {
  globalThis.fetch = realFetch;
});
