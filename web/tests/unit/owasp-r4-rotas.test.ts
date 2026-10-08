/**
 * OWASP R4 — entradas e arquivos nas rotas (handlers REAIS; banco, sessão, R2 e Google falsos):
 * - AUD2 upload: o tipo vem dos BYTES (SVG/HTML com MIME image/png|jpeg eram aceitos e gravados no R2);
 *   nome do objeto gerado no servidor; teto de 8 MB.
 * - AUD2 /api/media: nunca repassa o tipo do Drive (SVG/HTML → 415); nosniff + CSP.
 * - AUD2-08 Drive: `?parent=` fora da raiz dos clientes → 403 pt-BR (antes listava qualquer pasta).
 * - AUD2-04 URLs: `mediaUrl` (posts) e `baseImageUrl` (artes-base) com javascript:/data:/http:/IP interno → 400 pt-BR.
 * - AUD2 limpeza do R2: só mídia de POST e só se nenhum outro registro usar a URL (logo/arte-base ficam).
 * - AUD2-02 e-mail: nome do cliente escapado no e-mail de aprovação; assunto sem quebra de linha.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { generateKeyPairSync } from "node:crypto";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
// (sharp vem de web/node_modules, o mesmo que o lib/media-thumb usa)
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const R2 = "https://pub-r4teste.r2.dev";

// ------------------------------------------------------------ estado e fakes

type Put = { key: string; contentType: string; bytes: number };
const state = {
  puts: [] as Put[],
  deletes: [] as string[],
  r2: true,
  posts: [] as { id: string; status: string; clientId: string; mediaUrl: string | null; mediaItems: { url: string }[] | null; mediaDriveId?: string | null }[],
  clients: [] as { id: string; logoUrl: string | null }[],
  templates: [] as { id: string; baseImageUrl: string }[],
  updates: [] as unknown[],
  drive: new Map<string, { parents: string[] }>(),
  driveFile: { contentType: "image/png", body: Buffer.alloc(0) },
  driveCalls: 0,
};

const fakePrisma = {
  post: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const p = state.posts.find((x) => x.id === where.id);
      return p ? { ...p, status: p.status, clientId: p.clientId, mediaDriveId: p.mediaDriveId ?? null } : null;
    },
    update: async (args: unknown) => {
      state.updates.push(args);
      return { id: "ok" };
    },
    create: async (args: unknown) => {
      state.updates.push(args);
      return { id: "novo" };
    },
  },
  user: { findUnique: async () => ({ id: uid(9) }) },
  artTemplate: {
    create: async (args: unknown) => {
      state.updates.push(args);
      return { id: "tpl" };
    },
    update: async (args: unknown) => {
      state.updates.push(args);
      return { id: "tpl" };
    },
  },
  /** só a consulta de "outro registro usa a URL?" (lib/r2-cleanup) */
  $queryRaw: async (_strings: TemplateStringsArray, postId: string, url: string, items: string, url2: string, url3: string) => {
    assert.equal(url, url2);
    assert.equal(url, url3);
    assert.deepEqual(JSON.parse(items), [{ url }]);
    const n =
      state.posts.filter((p) => p.id !== postId && (p.mediaUrl === url || (p.mediaItems ?? []).some((i) => i.url === url))).length +
      state.clients.filter((c) => c.logoUrl === url).length +
      state.templates.filter((t) => t.baseImageUrl === url).length;
    return [{ n: BigInt(n) }];
  },
};

const FAKE_MODULES: Record<string, string> = {
  "next/server": "export class NextRequest extends Request { get nextUrl() { return new URL(this.url); } } export class NextResponse extends Response {}",
  "@/lib/prisma": "export const prisma = globalThis.__r4r.prisma;",
  "@/lib/api-auth": "export async function requireAuth() { return null; }",
  "@/lib/audit": "export async function audit() {}",
  "@/lib/permissions": "export const ADMIN_ONLY = {}; export const isAdmin = () => true; export async function sessionActor() { return null; }",
  "@/lib/publish-guard": "export async function guardQueueTransition() { return null; }",
  "@/lib/rate-limit": "export function enforceRateLimit() { return null; } export function clientIp() { return '127.0.0.1'; }",
  "@/lib/media-token": "export function verifyMedia() { return true; }",
  "@/generated/prisma/client":
    "export const Prisma = { JsonNull: 'JsonNull', PrismaClientKnownRequestError: class extends Error {} };",
  "@/lib/r2":
    "const s = globalThis.__r4r.state;" +
    "export const r2Configured = () => s.r2;" +
    "export async function uploadToR2(key, buf, ct) { s.puts.push({ key, contentType: ct, bytes: buf.length }); return 'https://pub-r4teste.r2.dev/' + key; }" +
    "export async function deleteFromR2(key) { s.deletes.push(key); }" +
    "export function r2KeyFromUrl(u) { const b = 'https://pub-r4teste.r2.dev/'; return u.startsWith(b) ? u.slice(b.length) : null; }",
};
(globalThis as unknown as { __r4r: unknown }).__r4r = { prisma: fakePrisma, state };
type ResolveHook = (s: string, c: unknown, n: (s: string, c: unknown) => unknown) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (h: { resolve: ResolveHook }) => void };
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

// Google falso (nada sai daqui)
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: "teste@exemplo.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});
const ROOT = "RaizClientes0001";
process.env.DRIVE_ROOT_FOLDER_ID = ROOT;
process.env.R2_PUBLIC_BASE_URL = R2;
const realFetch = globalThis.fetch;
const sentEmails: { url: string; body: { subject: string; html: string; to: string[] } }[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.origin === "https://oauth2.googleapis.com") return Response.json({ access_token: "t", expires_in: 3600 });
  if (url.origin === "https://api.resend.com") {
    sentEmails.push({ url: url.href, body: JSON.parse(String(init?.body)) });
    return Response.json({ id: "x" });
  }
  const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
  if (url.origin === "https://www.googleapis.com" && m && url.searchParams.get("alt") === "media") {
    return new Response(new Uint8Array(state.driveFile.body), { headers: { "content-type": state.driveFile.contentType } });
  }
  if (url.origin === "https://www.googleapis.com" && m) {
    state.driveCalls++;
    const node = state.drive.get(decodeURIComponent(m[1]));
    return node ? Response.json({ id: m[1], parents: node.parents, trashed: false }) : new Response("nf", { status: 404 });
  }
  if (url.origin === "https://www.googleapis.com" && url.pathname === "/drive/v3/files") {
    return Response.json({ files: [{ id: "SubPasta000001", name: "2026", mimeType: "application/vnd.google-apps.folder" }] });
  }
  throw new Error(`fetch inesperado: ${url.href}`);
}) as typeof fetch;

const { NextRequest } = (await import("next/server")) as unknown as { NextRequest: typeof Request };
const upload = await import("../../src/app/api/upload/route.ts");
const media = await import("../../src/app/api/media/[postId]/route.ts");
const folders = await import("../../src/app/api/drive/folders/route.ts");
const postsId = await import("../../src/app/api/posts/[id]/route.ts");
const posts = await import("../../src/app/api/posts/route.ts");
const tpl = await import("../../src/app/api/art-templates/route.ts");
const tplId = await import("../../src/app/api/art-templates/[id]/route.ts");
const cleanup = await import("../../src/lib/r2-cleanup.ts");
const email = await import("../../src/lib/email.ts");
const drive = await import("../../src/lib/google-drive.ts");

const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#f00" } }).png().toBuffer();
const jpg = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#f00" } }).jpeg().toBuffer();
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)"><script>alert(1)</script></svg>';
const HTML = "<html><script>alert(document.cookie)</script></html>";

beforeEach(() => {
  state.puts = [];
  state.deletes = [];
  state.r2 = true;
  state.posts = [];
  state.clients = [];
  state.templates = [];
  state.updates = [];
  state.drive = new Map();
  state.driveCalls = 0;
  drive.clearDriveAncestryCache();
});

const jsonOf = async (res: Response) => ({ status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null });
const ptBr = (json: Record<string, unknown> | null) => {
  assert.equal(typeof json?.error, "string", JSON.stringify(json));
  assert.doesNotMatch(String(json?.error), /Invalid|Expected|Required|undefined|SafeFetch|https?:\/\//);
};

// ------------------------------------------------------------ upload

async function sendUpload(blob: Blob, name: string, kind: string, clientId?: string) {
  const fd = new FormData();
  fd.append("file", new File([blob], name, { type: blob.type }));
  fd.append("kind", kind);
  if (clientId) fd.append("clientId", clientId);
  return jsonOf(await upload.POST(new Request("http://localhost/api/upload", { method: "POST", body: fd }) as never));
}

describe("POST /api/upload — tipo pelos bytes", () => {
  test("SVG/HTML com MIME de imagem (antes 200 e gravado no R2) → 400; nada vai ao R2", async () => {
    for (const [label, blob, name] of [
      ["SVG declarado image/svg+xml", new Blob([SVG], { type: "image/svg+xml" }), "a.svg"],
      ["SVG com MIME image/png", new Blob([SVG], { type: "image/png" }), "a.png"],
      ["HTML com MIME image/jpeg", new Blob([HTML], { type: "image/jpeg" }), "x.jpg"],
      ["GIF", new Blob([Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64")], { type: "image/png" }), "x.png"],
    ] as const) {
      const r = await sendUpload(blob, name, "template");
      assert.equal(r.status, 400, label);
      ptBr(r.json);
    }
    assert.deepEqual(state.puts, []);
  });

  test("PNG/JPEG de verdade: aceitos com o tipo dos bytes e nome gerado no servidor (sem o nome/caminho enviado)", async () => {
    const a = await sendUpload(new Blob([png], { type: "image/jpeg" }), "../../logos/evil.svg", "logo", uid(1));
    const b = await sendUpload(new Blob([jpg], { type: "application/octet-stream" }), "foto.png", "post", uid(2));
    const c = await sendUpload(new Blob([png], { type: "image/png" }), "x.png", "template");
    assert.deepEqual([a.status, b.status, c.status], [200, 200, 200]);
    const [pa, pb, pc] = state.puts;
    assert.match(pa.key, new RegExp(`^logos/${uid(1)}/\\d+-[0-9a-f-]{36}\\.png$`));
    assert.equal(pa.contentType, "image/png");
    assert.match(pb.key, new RegExp(`^posts/${uid(2)}/\\d+-[0-9a-f-]{36}\\.jpg$`));
    assert.equal(pb.contentType, "image/jpeg");
    assert.match(pc.key, /^templates\/\d+-[0-9a-f-]{36}\.png$/);
    for (const p of state.puts) assert.doesNotMatch(p.key, /evil|foto|\.\./);
  });

  test("clientId com caminho → 400; arquivo maior que 8 MB → 400", async () => {
    assert.equal((await sendUpload(new Blob([png], { type: "image/png" }), "a.png", "logo", "../../templates")).status, 400);
    const big = Buffer.concat([png, Buffer.alloc(8 * 1024 * 1024)]);
    assert.equal((await sendUpload(new Blob([big], { type: "image/png" }), "a.png", "post", uid(3))).status, 400);
    assert.deepEqual(state.puts, []);
  });
});

// ------------------------------------------------------------ /api/media

describe("GET /api/media/[postId] — tipo seguro", () => {
  const get = () =>
    media.GET(new NextRequest(`http://localhost/api/media/${uid(5)}?sig=x`) as never, { params: Promise.resolve({ postId: uid(5) }) } as never);

  test("SVG do Drive (antes repassado como image/svg+xml) → 415; HTML disfarçado de PNG → 415", async () => {
    state.posts = [{ id: uid(5), status: "scheduled", clientId: uid(1), mediaUrl: null, mediaItems: null, mediaDriveId: "ArquivoDrive01" }];
    state.driveFile = { contentType: "image/svg+xml", body: Buffer.from(SVG) };
    assert.equal((await get()).status, 415);
    state.driveFile = { contentType: "image/png", body: Buffer.from(HTML) };
    assert.equal((await get()).status, 415);
  });

  test("PNG: tipo da lista + nosniff + CSP sem execução", async () => {
    state.posts = [{ id: uid(5), status: "scheduled", clientId: uid(1), mediaUrl: null, mediaItems: null, mediaDriveId: "ArquivoDrive01" }];
    state.driveFile = { contentType: "image/png; charset=binary", body: png };
    const res = await get();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(String(res.headers.get("content-security-policy")), /default-src 'none'; sandbox/);
  });
});

// ------------------------------------------------------------ Drive: pasta só dentro da raiz

describe("GET /api/drive/folders — confused deputy (AUD2-08)", () => {
  const list = (parent?: string) =>
    folders.GET(new Request(`http://localhost/api/drive/folders${parent ? `?parent=${encodeURIComponent(parent)}` : ""}`) as never);

  test("pasta de FORA da raiz (antes listada) → 403 pt-BR, sem listar", async () => {
    state.drive.set("PastaPessoal01", { parents: ["MeuDriveRaiz01"] });
    const r = await jsonOf(await list("PastaPessoal01"));
    assert.equal(r.status, 403);
    assert.equal(r.json?.error, drive.FOLDER_OUTSIDE_ROOT);
    assert.equal(r.json?.folders, undefined);
  });

  test("pasta dentro da raiz (2 níveis) → 200; raiz → 200; ID inválido/injeção → 400; inexistente → 403", async () => {
    state.drive.set("PastaCliente01", { parents: [ROOT] });
    state.drive.set("PastaAno202601", { parents: ["PastaCliente01"] });
    assert.equal((await list("PastaAno202601")).status, 200);
    assert.equal((await list()).status, 200);
    assert.equal((await list(ROOT)).status, 200);
    assert.equal((await list("x' or name contains '")).status, 400);
    assert.equal((await list("NaoExiste00001")).status, 403);
  });

  test("ancestralidade com cache (a 2ª consulta não chama o Drive)", async () => {
    state.drive.set("PastaCliente01", { parents: [ROOT] });
    assert.equal(await drive.isInsideRoot("PastaCliente01"), true);
    const calls = state.driveCalls;
    assert.equal(await drive.isInsideRoot("PastaCliente01"), true);
    assert.equal(state.driveCalls, calls);
  });
});

// ------------------------------------------------------------ URLs de mídia e de arte-base

const BAD_URLS = [
  "javascript:alert(document.cookie)",
  "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+",
  "http://cdn.example.com/x.png",
  "https://127.0.0.1/x.png",
  "https://[::ffff:127.0.0.1]/x.png",
  "https://169.254.169.254/latest/meta-data/",
  "https://localhost/x.png",
  "https://user:senha@cdn.example.com/x.png",
];

describe("mediaUrl (posts) e baseImageUrl (artes-base) — AUD2-04", () => {
  test("PATCH /api/posts/[id]: URLs perigosas (antes gravadas) → 400 pt-BR; https público passa", async () => {
    state.posts = [{ id: uid(7), status: "draft", clientId: uid(1), mediaUrl: null, mediaItems: null }];
    const patch = (mediaUrl: string) =>
      postsId.PATCH(
        new Request(`http://localhost/api/posts/${uid(7)}`, { method: "PATCH", body: JSON.stringify({ mediaUrl }) }) as never,
        { params: Promise.resolve({ id: uid(7) }) }
      );
    for (const u of BAD_URLS) {
      const r = await jsonOf(await patch(u));
      assert.equal(r.status, 400, u);
      ptBr(r.json);
      assert.equal(r.json?.field, "mediaUrl");
    }
    assert.equal(state.updates.length, 0);
    assert.equal((await patch(`${R2}/posts/${uid(1)}/a.png`)).status, 200);
    assert.equal((await patch("https://cdn.example.com/imagem.jpg")).status, 200, "URL pública colada continua valendo");
    assert.equal((await patch("")).status, 200, "vazio limpa a mídia");
  });

  test("POST /api/posts: javascript:/data: → 400 pt-BR", async () => {
    for (const u of BAD_URLS.slice(0, 2)) {
      const res = await posts.POST(
        new Request("http://localhost/api/posts", {
          method: "POST",
          body: JSON.stringify({ clientId: uid(1), mediaUrl: u, scheduledAt: "2026-11-01T12:00:00.000Z", targets: ["instagram"] }),
        }) as never
      );
      const r = await jsonOf(res);
      assert.equal(r.status, 400, u);
      ptBr(r.json);
    }
    assert.equal(state.updates.length, 0);
  });

  test("artes-base: só do R2 público (outro host, javascript:, data:, IP interno → 400 pt-BR)", async () => {
    const create = (baseImageUrl: string) =>
      tpl.POST(new Request("http://localhost/api/art-templates", { method: "POST", body: JSON.stringify({ name: "ZZ QA OWASP-R4", baseImageUrl }) }) as never);
    const update = (baseImageUrl: string) =>
      tplId.PATCH(
        new Request("http://localhost/api/art-templates/x", { method: "PATCH", body: JSON.stringify({ baseImageUrl }) }) as never,
        { params: Promise.resolve({ id: uid(8) }) }
      );
    for (const u of [...BAD_URLS, "https://cdn.example.com/arte.png"]) {
      for (const call of [create, update]) {
        const r = await jsonOf(await call(u));
        assert.equal(r.status, 400, u);
        ptBr(r.json);
      }
    }
    assert.equal(state.updates.length, 0);
    assert.equal((await create(`${R2}/templates/1-a.png`)).status, 201);
    assert.equal((await update(`${R2}/templates/2-b.png`)).status, 200);
  });
});

// ------------------------------------------------------------ limpeza do R2

describe("limpeza do R2 — só mídia de post que ninguém mais usa", () => {
  test("prefixos: posts/, arts/, <cliente>/ (sync) saem; logos/, templates/, uploads/ nunca", () => {
    for (const k of [`posts/${uid(1)}/1-a.png`, "posts/sem-cliente/1.jpg", `arts/${uid(1)}/2026-11-01-abcd1234.png`, `${uid(1)}/${uid(2)}-1.mp4`]) {
      assert.equal(cleanup.isPostMediaKey(k), true, k);
    }
    for (const k of [`logos/${uid(1)}/1.png`, "templates/1.png", "uploads/1.png", `posts/${uid(1)}/../../logos/x.png`, "posts/x/1.png", `${uid(1)}/sub/1.png`]) {
      assert.equal(cleanup.isPostMediaKey(k), false, k);
    }
  });

  test("logo e arte-base coladas como mídia do post (antes apagadas) ficam; mídia compartilhada fica; a própria sai", async () => {
    const logo = `${R2}/logos/${uid(1)}/1.png`;
    const base = `${R2}/templates/1.png`;
    const shared = `${R2}/arts/${uid(1)}/2026-11-01-abcd1234.png`;
    const own = `${R2}/posts/${uid(1)}/9-a.png`;
    state.clients = [{ id: uid(1), logoUrl: logo }];
    state.templates = [{ id: uid(8), baseImageUrl: base }];
    state.posts = [
      { id: uid(10), status: "published", clientId: uid(1), mediaUrl: own, mediaItems: [{ url: shared }, { url: logo }, { url: base }] },
      { id: uid(11), status: "scheduled", clientId: uid(1), mediaUrl: shared, mediaItems: null },
    ];
    const r = await cleanup.deletePostMedia(uid(10), [own, shared, logo, base, "https://cdn.example.com/x.png"]);
    assert.deepEqual(state.deletes, [`posts/${uid(1)}/9-a.png`]);
    assert.deepEqual(r, { freed: 1, kept: 3 });
  });
});

// ------------------------------------------------------------ e-mail

describe("e-mail de aprovação — AUD2-02", () => {
  const PAYLOAD =
    'ZZ QA OWASP-R4 </p><h1 style="color:red">Pagamento pendente</h1><p>Atualize em <a href="https://phishing.example.com/login">aqui</a></p><img src="https://tracker.example.com/pixel.gif"><p>';

  test("o nome do cliente (payload da auditoria, antes cru no HTML) sai escapado", () => {
    const html = email.approvalEmailHtml(PAYLOAD, "novembro de 2026", "https://flow.example.com/aprovar/TOKEN");
    assert.ok(!html.includes('<a href="https://phishing.example.com/login">'));
    assert.ok(!html.includes("<img"));
    assert.ok(!html.includes("<h1"));
    assert.ok(html.includes("&lt;h1 style=&quot;color:red&quot;&gt;Pagamento pendente&lt;/h1&gt;"));
    assert.ok(html.includes('href="https://flow.example.com/aprovar/TOKEN"'));
    assert.match(email.approvalEmailHtml("A", "<b>mês</b>", "https://x.example.com/a"), /Cronograma de &lt;b&gt;mês&lt;\/b&gt;/);
  });

  test("link que não é http(s) não vira botão; aspas no link não fecham o atributo", () => {
    const js = email.approvalEmailHtml("A", "m", "javascript:alert(1)");
    assert.ok(!js.includes("javascript:"));
    const quoted = email.approvalEmailHtml("A", "m", 'https://x.example.com/a"onmouseover="alert(1)');
    assert.ok(!quoted.includes('"onmouseover="'));
  });

  test("assunto em uma linha (sem injeção de cabeçalho) e destinatário único", async () => {
    assert.equal(email.safeSubject("Cronograma\r\nBcc: vitima@example.com\nX"), "Cronograma Bcc: vitima@example.com X");
    assert.ok(email.safeSubject("a".repeat(500)).length <= 200);
    process.env.RESEND_API_KEY = "chave-falsa";
    process.env.RESEND_FROM = "zz@example.com";
    try {
      sentEmails.length = 0;
      const bad = await email.sendEmail({ to: "a@example.com\r\nBcc: b@example.com", subject: "s", html: "h" });
      assert.equal(bad.sent, false);
      const list = await email.sendEmail({ to: "a@example.com, b@example.com", subject: "s", html: "h" });
      assert.equal(list.sent, false);
      assert.equal(sentEmails.length, 0);
      const ok = await email.sendEmail({ to: "zz-qa-owasp-r4@example.com", subject: "Linha 1\nLinha 2", html: "h" });
      assert.equal(ok.sent, true);
      assert.equal(sentEmails[0].body.subject, "Linha 1 Linha 2");
    } finally {
      delete process.env.RESEND_API_KEY;
      delete process.env.RESEND_FROM;
    }
  });
});

test("restaura o fetch", () => {
  globalThis.fetch = realFetch;
});
