/**
 * OWASP-R5 — configuração, CSP, CSRF e corpo.
 *   1. lib/request-guard (CF-14/AC-09): POST/PUT/PATCH/DELETE em /api só com Origin (ou Referer) do
 *      próprio sistema e Content-Type JSON; o ataque do AUD-4 (Origin de fora + text/plain → 201)
 *      vira 403; /api/auth e chamadas do n8n com x-internal-key ficam fora; corpo declarado grande → 413.
 *   2. lib/csp (CF-08): CSP com nonce, 'strict-dynamic', frame-ancestors 'none'… e hosts de mídia.
 *   3. proxy.ts: /api passa pela guarda sem ler a sessão; links públicos e páginas ganham CSP com
 *      nonce (resposta + cabeçalho da requisição); sessão sem id (objeto de erro, CF-01) → /login;
 *      robots.txt fora do matcher (CF-20).
 *   4. lib/read-json (CF-16): teto por Content-Length e por bytes lidos (chunked).
 *   5. next.config / layout raiz / design-system / package.json (estático).
 *
 * Hooks de módulo: "@/" → fontes; "@/auth" falso (a sessão vem do teste). O resto é real,
 * inclusive o next/server.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const WEB = fileURLToPath(new URL("../../", import.meta.url));

type Session = { user?: { id?: unknown; role?: string } } | Record<string, unknown> | null;
const state = { session: null as Session, authCalls: 0 };

const FAKE_MODULES: Record<string, string> = {
  // como o wrapper do NextAuth: põe a sessão em req.auth e chama o callback
  "@/auth":
    "export const auth = (fn) => async (req, ev) => { globalThis.__r5.state.authCalls++; req.auth = globalThis.__r5.state.session; return fn(req, ev); };",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };
(globalThis as unknown as { __r5: unknown }).__r5 = { state };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in FAKE_MODULES) {
      return { url: `data:text/javascript,${encodeURIComponent(FAKE_MODULES[specifier])}`, shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      return { url: pathToFileURL(path.join(SRC, `${specifier.slice(2)}.ts`)).href, shortCircuit: true };
    }
    // o pacote next não tem "exports": no ESM do Node o subcaminho precisa da extensão
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
});

const guard = await import("../../src/lib/request-guard.ts");
const csp = await import("../../src/lib/csp.ts");
const readJson = await import("../../src/lib/read-json.ts");
const { NextRequest } = await import("next/server");
const proxyMod = await import("../../src/proxy.ts");

const warns: string[] = [];
console.warn = (...args: unknown[]) => void warns.push(args.map(String).join(" "));

const SELF = "http://localhost:3000";
const ALLOWED = [SELF];
const ORIGIN_MSG = guard.REQUEST_GUARD_MESSAGES.origin;

function check(method: string, pathname: string, headers: Record<string, string>) {
  return guard.checkApiRequest({ method, pathname, headers: new Headers(headers), allowedOrigins: ALLOWED });
}

beforeEach(() => {
  state.session = null;
  state.authCalls = 0;
  warns.length = 0;
});

// --------------------------------------------------------------------------------------------
describe("1. CSRF em /api (lib/request-guard)", () => {
  test("ATAQUE do AUD-4: POST /api/clients com Origin de fora + text/plain (antes 201) → 403", () => {
    const r = check("POST", "/api/clients", {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
      "content-type": "text/plain",
      "content-length": "20",
    });
    assert.equal(r?.status, 403);
    assert.equal(r?.error, ORIGIN_MSG);
  });

  test("DELETE /api/clients/<id> com Origin de fora (antes 200) → 403", () => {
    assert.equal(check("DELETE", "/api/clients/abc", { origin: "https://evil.example" })?.status, 403);
  });

  test("subdomínio irmão (mesmo site, Origin diferente) → 403, também só pelo Sec-Fetch-Site", () => {
    assert.equal(check("PATCH", "/api/posts/1", { origin: "https://site.grupocoletivo.com.br", "content-type": "application/json", "content-length": "2" })?.status, 403);
    assert.equal(check("PATCH", "/api/posts/1", { origin: SELF, "sec-fetch-site": "same-site", "content-type": "application/json", "content-length": "2" })?.status, 403);
    assert.equal(check("POST", "/api/clients", { origin: SELF, "sec-fetch-site": "cross-site" })?.status, 403);
  });

  test("sem Origin e sem Referer, ou Origin 'null' (iframe sandbox) → 403", () => {
    assert.equal(check("POST", "/api/clients", { "content-type": "application/json", "content-length": "2" })?.status, 403);
    assert.equal(check("POST", "/api/clients", { origin: "null", "content-type": "application/json", "content-length": "2" })?.status, 403);
    assert.equal(check("POST", "/api/clients", { origin: "javascript:alert(1)" })?.status, 403);
  });

  test("sem Origin, Referer do próprio sistema vale; Referer de fora → 403", () => {
    assert.equal(check("POST", "/api/clients", { referer: `${SELF}/clients/new`, "content-type": "application/json", "content-length": "2" }), null);
    assert.equal(check("POST", "/api/clients", { referer: "https://evil.example/x", "content-type": "application/json", "content-length": "2" })?.status, 403);
  });

  test("a própria tela: Origin do sistema + JSON (com charset) → segue", () => {
    assert.equal(check("POST", "/api/clients", { origin: SELF, "sec-fetch-site": "same-origin", "content-type": "application/json", "content-length": "15" }), null);
    assert.equal(check("PUT", "/api/clients/1/credentials", { origin: SELF, "content-type": "application/json; charset=utf-8", "content-length": "15" }), null);
    // DELETE sem corpo e POST sem corpo (resumo do dia) não precisam de Content-Type
    assert.equal(check("DELETE", "/api/posts/1", { origin: SELF }), null);
    assert.equal(check("POST", "/api/ai/daily-summary", { origin: SELF, "content-length": "0" }), null);
  });

  test("mesma origem mas text/plain, formulário comum ou sem tipo, com corpo → 415", () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""]) {
      const h: Record<string, string> = { origin: SELF, "content-length": "10" };
      if (type) h["content-type"] = type;
      const r = check("POST", "/api/clients", h);
      assert.equal(r?.status, 415, type);
      assert.equal(r?.error, guard.REQUEST_GUARD_MESSAGES.contentType);
    }
    // corpo chunked (sem Content-Length) também conta como corpo
    assert.equal(check("POST", "/api/clients", { origin: SELF, "transfer-encoding": "chunked", "content-type": "text/plain" })?.status, 415);
  });

  test("multipart só no upload", () => {
    assert.equal(check("POST", "/api/upload", { origin: SELF, "content-type": "multipart/form-data; boundary=abc", "content-length": "5000" }), null);
    assert.equal(check("POST", "/api/upload", { origin: "https://evil.example", "content-type": "multipart/form-data; boundary=abc", "content-length": "5000" })?.status, 403);
  });

  test("corpo declarado acima do teto → 413 sem ler (JSON 2 MB, upload 9 MB)", () => {
    const big = String(guard.BODY_LIMITS.json + 1);
    assert.equal(check("POST", "/api/posts", { origin: SELF, "content-type": "application/json", "content-length": big })?.status, 413);
    assert.equal(check("POST", "/api/upload", { origin: SELF, "content-type": "multipart/form-data; boundary=a", "content-length": String(8 * 1024 * 1024 + 4096) }), null);
    assert.equal(check("POST", "/api/upload", { origin: SELF, "content-type": "multipart/form-data; boundary=a", "content-length": String(guard.BODY_LIMITS.upload + 1) })?.status, 413);
  });

  test("métodos seguros nunca são recusados", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) assert.equal(check(m, "/api/clients", { origin: "https://evil.example" }), null);
  });

  test("/api/auth (NextAuth tem o próprio token CSRF) fica fora; links públicos /api/aprovar* entram", () => {
    assert.equal(check("POST", "/api/auth/callback/credentials", { "content-type": "application/x-www-form-urlencoded", "content-length": "40" }), null);
    assert.equal(check("POST", "/api/aprovar/tok/approve", { origin: "https://evil.example" })?.status, 403);
    assert.equal(check("POST", "/api/aprovar/tok/approve", { origin: SELF, "content-type": "application/json", "content-length": "2" }), null);
  });

  test("/api/internal: n8n com x-internal-key fica fora; botão da tela (sem chave) passa pela guarda", () => {
    assert.equal(check("POST", "/api/internal/publish/1", { "x-internal-key": "k", "content-type": "application/json", "content-length": "2" }), null);
    assert.equal(check("POST", "/api/internal/weekly/run", { origin: "https://evil.example" })?.status, 403);
    assert.equal(check("POST", "/api/internal/weekly/run", { origin: SELF }), null);
  });

  test("allowedOriginsFor: Host (http/https), X-Forwarded-Host, SYSTEM_BASE_URL e AUTH_URL; host malformado é ignorado", () => {
    const set = guard.allowedOriginsFor(
      new Headers({ host: "flow.grupocoletivo.com.br", "x-forwarded-host": "app.exemplo.com" }),
      "https://flow.grupocoletivo.com.br",
      { SYSTEM_BASE_URL: "https://flow.grupocoletivo.com.br/", AUTH_URL: "https://auth.exemplo.com/api/auth" }
    );
    for (const o of ["https://flow.grupocoletivo.com.br", "http://flow.grupocoletivo.com.br", "https://app.exemplo.com", "https://auth.exemplo.com"]) {
      assert.ok(set.has(o), o);
    }
    assert.ok(!set.has("https://evil.example"));
    const bad = guard.allowedOriginsFor(new Headers({ host: "evil.example/x@" }), "http://localhost:3000", {});
    assert.deepEqual([...bad], ["http://localhost:3000"]);
  });
});

// --------------------------------------------------------------------------------------------
describe("2. CSP (lib/csp)", () => {
  const nonce = "QUJDREVGR0hJSktMTU5PUA==";

  test("produção: nonce + strict-dynamic, sem unsafe-eval; frame-ancestors/base-uri/form-action/object-src; upgrade-insecure", () => {
    const v = csp.buildCsp({ nonce, dev: false, mediaSources: ["https://pub-x.r2.dev"] });
    const d = Object.fromEntries(v.split("; ").map((x) => [x.split(" ")[0], x]));
    assert.equal(d["default-src"], "default-src 'self'");
    assert.equal(d["script-src"], `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    assert.doesNotMatch(v, /unsafe-eval/);
    assert.doesNotMatch(d["script-src"], /unsafe-inline/);
    assert.equal(d["style-src"], "style-src 'self' 'unsafe-inline'");
    assert.equal(d["connect-src"], "connect-src 'self'");
    assert.equal(d["frame-ancestors"], "frame-ancestors 'none'");
    assert.equal(d["form-action"], "form-action 'self'");
    assert.equal(d["base-uri"], "base-uri 'self'");
    assert.equal(d["object-src"], "object-src 'none'");
    assert.ok("upgrade-insecure-requests" in d);
    for (const host of ["https://pub-x.r2.dev", "https://*.cdninstagram.com", "https://*.fbcdn.net", "https://*.googleusercontent.com", "data:", "blob:"]) {
      assert.ok(d["img-src"].includes(host), host);
    }
    assert.ok(d["media-src"].includes("https://pub-x.r2.dev"));
    // r2.dev genérico só em dev
    assert.ok(!v.includes("https://*.r2.dev"));
  });

  test("dev: 'unsafe-eval' (React) e r2.dev genérico; sem upgrade-insecure-requests", () => {
    const v = csp.buildCsp({ nonce, dev: true });
    assert.match(v, /script-src 'self' 'nonce-[^']+' 'strict-dynamic' 'unsafe-eval'/);
    assert.ok(v.includes("https://*.r2.dev"));
    assert.doesNotMatch(v, /upgrade-insecure-requests/);
  });

  test("nonce: 128 bits aleatórios em base64, um diferente por chamada; nonce estranho é recusado", () => {
    const a = csp.generateNonce();
    const b = csp.generateNonce();
    assert.match(a, /^[A-Za-z0-9+/]{22}==$/);
    assert.notEqual(a, b);
    assert.throws(() => csp.buildCsp({ nonce: "x' 'unsafe-inline", dev: false }));
  });

  test("hosts de mídia do ambiente: R2 vira origem; extras aceitam https e curinga; esquema perigoso é ignorado", () => {
    assert.deepEqual(
      csp.mediaSourcesFromEnv({
        R2_PUBLIC_BASE_URL: "https://pub-abc.r2.dev/pasta/",
        CSP_EXTRA_MEDIA_HOSTS: "https://cdn.exemplo.com/x, https://*.exemplo.net, javascript:alert(1), data:, https://u:p@h.com, *",
      }),
      ["https://pub-abc.r2.dev", "https://cdn.exemplo.com", "https://*.exemplo.net"]
    );
    assert.deepEqual(csp.mediaSourcesFromEnv({ R2_PUBLIC_BASE_URL: "" }), []);
  });
});

// --------------------------------------------------------------------------------------------
describe("3. proxy.ts", () => {
  const proxy = proxyMod.proxy as (req: InstanceType<typeof NextRequest>, ev: unknown) => Promise<Response>;
  const run = (url: string, init: RequestInit = {}) => proxy(new NextRequest(`${SELF}${url}`, init as never), {});
  const cspOf = (res: Response) => res.headers.get("content-security-policy") ?? "";

  test("/api: Origin de fora → 403 pt-BR (no-store), SEM ler a sessão; mesma origem segue", async () => {
    const bad = await run("/api/clients", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "text/plain" },
      body: '{"name":"x"}',
    });
    assert.equal(bad.status, 403);
    assert.deepEqual(await bad.json(), { error: ORIGIN_MSG });
    assert.equal(bad.headers.get("cache-control"), "no-store");
    assert.match(warns.join("\n"), /POST \/api\/clients recusado \(403\)/);

    const ok = await run("/api/clients", {
      method: "POST",
      headers: { origin: SELF, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(ok.headers.get("x-middleware-next"), "1");
    assert.equal(cspOf(ok), "", "API não recebe o CSP das páginas");
    assert.equal(state.authCalls, 0, "a guarda de /api não lê a sessão");
  });

  test("link público /aprovar/<token>: CSP com nonce na resposta e na requisição (x-nonce), sem sessão", async () => {
    const res = await run("/aprovar/AAAAAAAAAAAAAAAAAAAAAAAA");
    const value = cspOf(res);
    const nonce = /'nonce-([^']+)'/.exec(value)?.[1];
    assert.ok(nonce, value);
    assert.equal(res.headers.get("x-middleware-request-x-nonce"), nonce);
    assert.equal(res.headers.get("x-middleware-request-content-security-policy"), value);
    assert.equal(state.authCalls, 0);
    const again = cspOf(await run("/aprovar-semana/BBBBBBBBBBBBBBBBBBBBBBBB"));
    assert.notEqual(/'nonce-([^']+)'/.exec(again)?.[1], nonce, "nonce novo a cada resposta");
  });

  test("página interna sem sessão → /login; sessão sem id (objeto de erro do Auth.js, CF-01) → /login", async () => {
    for (const session of [null, { message: "There was a problem with the server configuration" }, { user: { role: "admin" } }, { user: { id: "" } }]) {
      state.session = session;
      const res = await run("/clients");
      assert.equal(res.status, 302, JSON.stringify(session));
      assert.equal(res.headers.get("location"), `${SELF}/login`);
    }
  });

  test("com sessão: página recebe CSP; /login → /", async () => {
    state.session = { user: { id: "00000000-0000-4000-8000-000000000001", role: "staff" } };
    const page = await run("/posts");
    assert.match(cspOf(page), /script-src 'self' 'nonce-/);
    assert.ok(page.headers.get("x-middleware-request-x-nonce"));
    const login = await run("/login");
    assert.equal(login.status, 302);
    assert.equal(login.headers.get("location"), `${SELF}/`);
  });

  test("/login sem sessão abre (com CSP)", async () => {
    const res = await run("/login");
    assert.equal(res.headers.get("x-middleware-next"), "1");
    assert.match(cspOf(res), /frame-ancestors 'none'/);
  });

  test("matcher: robots.txt, estáticos e ícones fora; /api e links públicos dentro", () => {
    const [source] = proxyMod.config.matcher;
    const re = new RegExp(`^${source}$`);
    for (const p of ["/robots.txt", "/_next/static/chunks/a.js", "/_next/image", "/favicon.ico", "/icon.png", "/apple-icon.png"]) {
      assert.ok(!re.test(p), `deveria ficar fora: ${p}`);
    }
    for (const p of ["/", "/login", "/api/clients", "/api/aprovar/x/approve", "/aprovar/x", "/aprovar-semana/x", "/aprovacoes"]) {
      assert.ok(re.test(p), `deveria entrar: ${p}`);
    }
  });
});

// --------------------------------------------------------------------------------------------
describe("4. readJsonLimited (CF-16)", () => {
  const body = (s: string, headers: Record<string, string> = {}) =>
    new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: s });

  test("dentro do teto → valor; JSON inválido/vazio → null", async () => {
    assert.deepEqual(await readJson.readJsonLimited(body('{"a":1}'), 100), { ok: true, value: { a: 1 } });
    assert.deepEqual(await readJson.readJsonLimited(body("{oops"), 100), { ok: true, value: null });
    assert.deepEqual(await readJson.readJsonLimited(new Request("http://x", { method: "POST" }), 100), { ok: true, value: null });
  });

  test("Content-Length acima do teto → 413 pt-BR sem ler", async () => {
    const r = await readJson.readJsonLimited(body("{}", { "content-length": "999999" }), 100);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.response.status, 413);
      assert.deepEqual(await r.response.json(), { error: readJson.BODY_TOO_LARGE_MESSAGE });
    }
  });

  test("sem Content-Length (fluxo): para de ler ao passar do teto → 413", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        pulled++;
        if (pulled > 1000) return ctrl.close();
        ctrl.enqueue(new TextEncoder().encode("x".repeat(1024)));
      },
    });
    const req = new Request("http://x", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    const r = await readJson.readJsonLimited(req, 4096);
    assert.equal(r.ok, false);
    assert.ok(pulled < 20, `leu ${pulled} pedaços`);
  });
});

// --------------------------------------------------------------------------------------------
describe("5. next.config, layout raiz, design-system e package.json", () => {
  test("next.config: sem X-Powered-By, sem source maps no navegador, COOP, Permissions-Policy e cabeçalhos de antes", async () => {
    const cfg = (await import("../../next.config.ts")).default as {
      poweredByHeader: boolean;
      productionBrowserSourceMaps: boolean;
      headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>;
    };
    assert.equal(cfg.poweredByHeader, false);
    assert.equal(cfg.productionBrowserSourceMaps, false);
    const rules = await cfg.headers();
    const all = rules.find((r) => r.source === "/:path*")!;
    const get = (k: string) => all.headers.find((h) => h.key === k)?.value ?? "";
    assert.equal(get("X-Frame-Options"), "DENY");
    assert.equal(get("X-Content-Type-Options"), "nosniff");
    assert.equal(get("Referrer-Policy"), "strict-origin-when-cross-origin");
    assert.match(get("Strict-Transport-Security"), /max-age=63072000/);
    assert.match(get("X-Robots-Tag"), /noindex/);
    assert.equal(get("Cross-Origin-Opener-Policy"), "same-origin");
    for (const f of ["camera=()", "microphone=()", "geolocation=()", "payment=()", "usb=()", "browsing-topics=()"]) {
      assert.ok(get("Permissions-Policy").includes(f), f);
    }
    // o CSP das páginas é do proxy (nonce por requisição): aqui só o das APIs
    assert.equal(get("Content-Security-Policy"), "");
    const api = rules.find((r) => r.source === "/api/:path*")!;
    assert.equal(api.headers.find((h) => h.key === "Content-Security-Policy")?.value, "default-src 'none'; frame-ancestors 'none'");
    const noStore = rules.find((r) => r.headers.some((h) => h.key === "Cache-Control"))!;
    const re = new RegExp(`^${noStore.source}$`);
    assert.ok(re.test("/api/clients/1/credentials") && re.test("/api/users"));
    assert.ok(!re.test("/api/media/abc"), "/api/media tem cache próprio");
  });

  test("layout raiz: script de tema com o nonce do x-nonce", () => {
    const src = fs.readFileSync(path.join(SRC, "app/layout.tsx"), "utf8");
    assert.match(src, /\(await headers\(\)\)\.get\("x-nonce"\)/);
    assert.match(src, /<script nonce=\{nonce\}[^>]*dangerouslySetInnerHTML=\{\{ __html: THEME_SCRIPT \}\}/);
  });

  test("/design-system: decidido no servidor — 404 em produção (sem DESIGN_SYSTEM_ENABLED=1) e para quem não é admin", () => {
    const page = fs.readFileSync(path.join(SRC, "app/(app)/design-system/page.tsx"), "utf8");
    assert.doesNotMatch(page, /^"use client"/m);
    assert.match(page, /process\.env\.NODE_ENV !== "production" \|\| process\.env\.DESIGN_SYSTEM_ENABLED === "1"/);
    assert.match(page, /if \(!designSystemEnabled\(\)\) notFound\(\);/);
    assert.match(page, /if \(user\?\.role !== "admin"\) notFound\(\);/);
    const catalog = fs.readFileSync(path.join(SRC, "app/(app)/design-system/DesignSystemCatalog.tsx"), "utf8");
    assert.match(catalog, /^"use client"/);
    assert.doesNotMatch(catalog, /\/api\/auth\/session/, "o acesso não depende mais de checagem no navegador");
  });

  test("package.json: CLI do Prisma só em devDependencies; o client gerado no postinstall continua", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(WEB, "package.json"), "utf8"));
    assert.equal(pkg.dependencies.prisma, undefined);
    assert.ok(pkg.devDependencies.prisma);
    assert.ok(pkg.dependencies["@prisma/client"] && pkg.dependencies["@prisma/adapter-pg"]);
    assert.equal(pkg.scripts.postinstall, "prisma generate");
    const lock = JSON.parse(fs.readFileSync(path.join(WEB, "package-lock.json"), "utf8"));
    // "devOptional": de desenvolvimento e par opcional do @prisma/client (fora de `npm ci --omit=dev --omit=optional`)
    const entry = lock.packages["node_modules/prisma"];
    assert.ok(entry.dev === true || entry.devOptional === true, JSON.stringify(entry).slice(0, 120));
    assert.equal(lock.packages[""].dependencies.prisma, undefined);
  });
});
