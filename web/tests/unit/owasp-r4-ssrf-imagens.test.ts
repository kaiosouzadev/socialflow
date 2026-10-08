/**
 * OWASP R4 — SSRF (AUD2-03) e imagens/sharp (AUD-4 CF-03).
 *
 * - `lib/safe-fetch`: só https público; IP privado/loopback/link-local/metadata (IPv4, IPv6 e IPv4-mapeado)
 *   recusado; DNS conferido na conexão (nome que resolve para 127.0.0.1 não conecta); redirecionamento
 *   revalidado; teto de bytes; tempo-limite; content-type.
 * - `lib/media-thumb`: antes buscava QUALQUER URL (o servidor de eco em 127.0.0.1 recebia o pedido e até
 *   seguia redirect para /interno). Agora o servidor de eco recebe 0 pedidos; só JPEG/PNG/WebP pelo conteúdo
 *   chegam ao sharp, com os outros decodificadores bloqueados e teto de 40 megapixels.
 * - `lib/art-gen`: as 15 URLs da auditoria (8 passavam pela lista de bloqueio antiga) não chegam à rede.
 *
 * Sem rede: o DNS é falso (`dns.lookup` trocado) e, nos testes do caminho feliz, `https.request` é
 * redirecionado para um servidor HTTP local (só para testar status/tamanho/tipo/redirect — a checagem de
 * IP é provada separadamente com o `https.request` real).
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32 } from "node:zlib";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
// (sharp vem de web/node_modules, o mesmo que o lib/media-thumb usa)

// ------------------------------------------------------------ DNS falso (nenhuma consulta real)

const DNS: Record<string, string[]> = {
  "cdn.example.com": ["93.184.216.34"],
  "rebind.example.com": ["127.0.0.1"],
  "localtest.me": ["127.0.0.1"],
  "metadata.example.com": ["169.254.169.254"],
  "misto.example.com": ["93.184.216.34", "10.0.0.5"],
  "v6interno.example.com": ["fd00::1"],
};
const realLookup = dns.lookup;
(dns as unknown as { lookup: unknown }).lookup = (
  host: string,
  opts: unknown,
  cb: (err: Error | null, addrs: { address: string; family: number }[]) => void
) => {
  // IP literal resolve para ele mesmo (o listen do servidor de eco em 127.0.0.1 passa por aqui)
  const list = DNS[host] ?? (isIP(host) ? [host] : host === "localhost" ? ["127.0.0.1"] : undefined);
  const callback = typeof opts === "function" ? (opts as typeof cb) : cb;
  const all = typeof opts === "object" && opts !== null && (opts as { all?: boolean }).all;
  if (list && !all) {
    const single = callback as unknown as (err: Error | null, address: string, family: number) => void;
    return process.nextTick(() => single(null, list[0], list[0].includes(":") ? 6 : 4));
  }
  if (!list) return process.nextTick(() => callback(Object.assign(new Error(`ENOTFOUND ${host}`), { code: "ENOTFOUND" }), []));
  process.nextTick(() => callback(null, list.map((a) => ({ address: a, family: a.includes(":") ? 6 : 4 }))));
};
nodeModule.syncBuiltinESMExports();

// ------------------------------------------------------------ "@/..." e fakes do Gemini (art-gen)

const FAKE_MODULES: Record<string, string> = {
  "@/lib/gemini":
    "export const GEMINI_BASE='https://gemini.invalid'; export const IMAGE_MODEL='x';" +
    "export async function geminiFetch(){ globalThis.__r4.gemini++; throw new Error('stub gemini'); }" +
    "export function logTextGeneration(){} export function parseModelJson(s){ return JSON.parse(s); }",
  "@/lib/ai-models": "export async function getGeminiTextModel(){ return 'x'; }",
};
const shared = { gemini: 0 };
(globalThis as unknown as { __r4: typeof shared }).__r4 = shared;
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

const sf = await import("../../src/lib/safe-fetch.ts");
const { thumbFromUrl, thumbFromBuffer, restrictImageDecoders } = await import("../../src/lib/media-thumb.ts");
const { generateArt } = await import("../../src/lib/art-gen.ts");

// ------------------------------------------------------------ servidor de eco em 127.0.0.1

const hits: string[] = [];
let png: Buffer;
let routes: Record<string, (res: http.ServerResponse) => void> = {};
const echo = http.createServer((req, res) => {
  hits.push(`${req.method} ${req.url}`);
  const r = routes[req.url ?? ""];
  if (r) return r(res);
  res.writeHead(200, { "content-type": "image/png" });
  res.end(png);
});
let port = 0;

/** Desvia o https.request do safe-fetch para o servidor local (só nos testes do caminho feliz). */
function routeHttpsToEcho(): () => void {
  const real = https.request;
  (https as unknown as { request: unknown }).request = (u: URL, opts: http.RequestOptions, cb: (res: http.IncomingMessage) => void) =>
    http.request({ host: "127.0.0.1", port, path: `${u.pathname}${u.search}`, method: opts.method, headers: opts.headers }, cb);
  return () => {
    (https as unknown as { request: unknown }).request = real;
  };
}

before(async () => {
  png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff0000" } }).png().toBuffer();
  await new Promise<void>((r) => echo.listen(0, "127.0.0.1", () => r()));
  port = (echo.address() as { port: number }).port;
});
after(() => {
  echo.close();
  (dns as unknown as { lookup: unknown }).lookup = realLookup;
  nodeModule.syncBuiltinESMExports();
});
beforeEach(() => {
  hits.length = 0;
  routes = {};
  shared.gemini = 0;
});

// ------------------------------------------------------------ 1. IPs e URLs

describe("safe-fetch — IPs e URLs (sem rede)", () => {
  test("IP público × interno (IPv4, IPv6, IPv4-mapeado, NAT64, 6to4)", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111", "[2001:4860:4860::8888]", "::ffff:8.8.8.8", "64:ff9b::808:808"]) {
      assert.equal(sf.isPublicIp(ip), true, ip);
    }
    for (const ip of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.169.254", "100.64.0.1",
      "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "::", "::1", "[::1]", "::ffff:127.0.0.1",
      "::ffff:a9fe:a9fe", "::ffff:10.0.0.1", "fd00::1", "fc00::1", "fe80::1", "fe80::1%eth0", "ff02::1",
      "2001:db8::1", "2001::1", "2002:7f00:1::1", "64:ff9b::7f00:1", "::127.0.0.1", "não-é-ip",
    ]) {
      assert.equal(sf.isPublicIp(ip), false, ip);
    }
  });

  test("as 15 URLs da auditoria (art-gen) e outras são recusadas sem rede", () => {
    const blocked = [
      "http://169.254.169.254/latest/meta-data/", "https://127.0.0.1/x.png", "https://localhost/x.png", "https://[::1]/x.png",
      "https://[::ffff:127.0.0.1]/x.png", "https://[::ffff:a9fe:a9fe]/x.png", "https://[fd00::1]/x.png", "https://[fe80::1]/x.png",
      "https://100.64.0.1/x.png", "https://0177.0.0.1/x.png", "https://2130706433/x.png", "https://metadata.google.internal./x.png",
      "https://printer.lan/x.png", "https://intranet/x.png", "https://x.localhost/x.png", "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz4=", "ftp://cdn.example.com/x.png", "https://user:senha@cdn.example.com/x.png",
      "https://cdn.example.com:8443/x.png", "file:///etc/passwd",
    ];
    for (const u of blocked) assert.throws(() => sf.assertSafeUrl(u), sf.SafeFetchError, u);
    assert.equal(sf.assertSafeUrl("https://cdn.example.com/a.png").hostname, "cdn.example.com");
  });

  test("lista de hosts permitidos: exato e sufixo", () => {
    const allow = ["pub-abc.r2.dev", ".googleusercontent.com"];
    assert.ok(sf.assertSafeUrl("https://pub-abc.r2.dev/x.png", allow));
    assert.ok(sf.assertSafeUrl("https://lh3.googleusercontent.com/x", allow));
    for (const u of ["https://pub-abc.r2.dev.evil.com/x", "https://googleusercontent.com.evil.com/x", "https://cdn.example.com/x"]) {
      assert.throws(() => sf.assertSafeUrl(u, allow), (e: unknown) => (e as { code?: string }).code === "host", u);
    }
  });

  test("redirecionamento: cada salto passa por todas as checagens", () => {
    const base = new URL("https://cdn.example.com/a/b.png");
    assert.equal(sf.nextHopUrl("/c.png", base).href, "https://cdn.example.com/c.png");
    for (const loc of ["http://cdn.example.com/c.png", "https://127.0.0.1/", "https://[::ffff:7f00:1]/", "https://169.254.169.254/", null]) {
      assert.throws(() => sf.nextHopUrl(loc, base), sf.SafeFetchError, String(loc));
    }
    assert.throws(() => sf.nextHopUrl("https://outro.example.com/x", base, ["cdn.example.com"]), sf.SafeFetchError);
  });
});

// ------------------------------------------------------------ 2. DNS conferido na conexão (https.request real)

describe("safe-fetch — DNS que aponta para dentro não conecta", () => {
  for (const host of ["rebind.example.com", "localtest.me", "metadata.example.com", "misto.example.com", "v6interno.example.com"]) {
    test(`${host} → recusado no lookup da conexão`, async () => {
      await assert.rejects(
        sf.safeFetchBuffer(`https://${host}/x.png`, { maxBytes: 1024 }),
        (e: unknown) => e instanceof sf.SafeFetchError && e.code === "host"
      );
      assert.equal(hits.length, 0);
    });
  }
});

// ------------------------------------------------------------ 3. caminho feliz: status, tamanho, tipo, redirect, tempo

describe("safe-fetch — resposta (servidor local no lugar do host público)", () => {
  test("200 com imagem: devolve os bytes; teto de bytes e content-type", async () => {
    const restore = routeHttpsToEcho();
    try {
      const ok = await sf.safeFetchBuffer("https://cdn.example.com/x.png", { maxBytes: 1024 * 1024, accept: (t) => t.startsWith("image/") });
      assert.deepEqual(ok.buffer, png);
      assert.equal(ok.contentType, "image/png");
      await assert.rejects(sf.safeFetchBuffer("https://cdn.example.com/x.png", { maxBytes: 10 }), (e: unknown) => (e as { code?: string }).code === "too_large");
      routes["/html"] = (res) => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<script>1</script>");
      };
      await assert.rejects(
        sf.safeFetchBuffer("https://cdn.example.com/html", { maxBytes: 1024, accept: (t) => t.startsWith("image/") }),
        (e: unknown) => (e as { code?: string }).code === "type"
      );
    } finally {
      restore();
    }
  });

  test("redirect para endereço interno é recusado; sem maxRedirects nenhum redirect é seguido; tempo-limite", async () => {
    const restore = routeHttpsToEcho();
    try {
      routes["/redir-interno"] = (res) => {
        res.writeHead(302, { location: "http://127.0.0.1/interno/segredo.png" });
        res.end();
      };
      routes["/redir-ok"] = (res) => {
        res.writeHead(302, { location: "/x.png" });
        res.end();
      };
      routes["/lento"] = () => {
        /* nunca responde */
      };
      await assert.rejects(sf.safeFetchBuffer("https://cdn.example.com/redir-interno", { maxBytes: 1e6, maxRedirects: 3 }), sf.SafeFetchError);
      await assert.rejects(sf.safeFetchBuffer("https://cdn.example.com/redir-ok", { maxBytes: 1e6 }), (e: unknown) => (e as { code?: string }).code === "redirect");
      const ok = await sf.safeFetchBuffer("https://cdn.example.com/redir-ok", { maxBytes: 1e6, maxRedirects: 1 });
      assert.equal(ok.finalUrl, "https://cdn.example.com/x.png");
      assert.ok(!hits.some((h) => h.includes("/interno/")), "o salto interno nunca é pedido");
      await assert.rejects(sf.safeFetchBuffer("https://cdn.example.com/lento", { maxBytes: 1e6, timeoutMs: 150 }), (e: unknown) => (e as { code?: string }).code === "timeout");
    } finally {
      restore();
    }
  });
});

// ------------------------------------------------------------ 4. miniatura (media-thumb) — AUD2-03 + CF-03

/** PNG só com o cabeçalho dizendo largura × altura (sem pixels): testa o teto de megapixels sem memória. */
function pngHeader(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IEND", Buffer.alloc(0))]);
}

describe("media-thumb — SSRF e formatos", () => {
  test("ANTES o servidor de eco recebia o pedido (e o redirect); AGORA: 0 pedidos, sem miniatura", async () => {
    routes["/redirect"] = (res) => {
      res.writeHead(302, { location: "/interno/segredo.png" });
      res.end();
    };
    for (const u of [
      `http://127.0.0.1:${port}/interno/admin.png`,
      `http://localhost:${port}/redirect`,
      `https://127.0.0.1:${port}/x.png`,
      "https://rebind.example.com/x.png",
      "https://[::ffff:127.0.0.1]/x.png",
    ]) {
      assert.equal(await thumbFromUrl(u), null, u);
    }
    assert.deepEqual(hits, [], "nenhum pedido chegou ao servidor interno");
  });

  test("só JPEG/PNG/WebP pelo conteúdo; SVG/GIF/HTML → null; teto de 40 megapixels", async () => {
    assert.match(String(await thumbFromBuffer(png)), /^data:image\/jpeg;base64,/);
    const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#00f" } }).webp().toBuffer();
    assert.match(String(await thumbFromBuffer(webp)), /^data:image\/jpeg;base64,/);
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#00f" } }).gif().toBuffer();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" width="8" height="8"/>');
    for (const [name, buf] of [["gif", gif], ["svg", svg], ["html", Buffer.from("<html><script>1</script>")], ["vazio", Buffer.alloc(0)]] as const) {
      assert.equal(await thumbFromBuffer(buf), null, name);
    }
    assert.equal(await thumbFromBuffer(pngHeader(50_000, 50_000)), null, "2,5 gigapixels declarados → recusado antes de decodificar");
  });

  test("decodificadores de SVG/GIF bloqueados no libvips (mesmo se a checagem de bytes falhasse)", async () => {
    restrictImageDecoders();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>');
    await assert.rejects(sharp(svg).png().toBuffer());
    const gif = Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");
    await assert.rejects(sharp(gif).png().toBuffer());
    assert.ok((await sharp(png).jpeg().toBuffer()).length > 0, "PNG continua funcionando");
  });
});

// ------------------------------------------------------------ 5. art-gen: lista de bloqueio trocada pelo safe-fetch

describe("art-gen — URLs da auditoria não chegam à rede", () => {
  test("as 8 que passavam antes (IPv6 mapeado, fd00::, fe80::, CGNAT, DNS interno…) e as outras: recusadas", async () => {
    process.env.GEMINI_API_KEY = "chave-falsa-de-teste";
    const realFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched++;
      throw new Error("sem rede no teste");
    }) as typeof fetch;
    try {
      for (const u of [
        "http://169.254.169.254/latest/meta-data/", "https://127.0.0.1/x.png", "https://localhost/x.png", "https://[::1]/x.png",
        "https://[::ffff:127.0.0.1]/x.png", "https://[::ffff:a9fe:a9fe]/x.png", "https://[fd00::1]/x.png", "https://[fe80::1]/x.png",
        "https://100.64.0.1/x.png", "https://0177.0.0.1/x.png", "https://2130706433/x.png", "https://localtest.me/x.png",
        "https://rebind.example.com/x.png", "https://metadata.google.internal./x.png", "https://printer.lan/x.png",
      ]) {
        await assert.rejects(generateArt({ templateUrl: u, theme: "t" }), (e: unknown) => {
          const msg = (e as Error).message;
          assert.doesNotMatch(msg, /https?:\/\//, "a mensagem não leva a URL");
          assert.match(msg, /^(URL de imagem deve ser https|Host de imagem não permitido|Falha ao baixar imagem)/);
          return true;
        }, u);
      }
      assert.equal(fetched, 0, "nenhum fetch");
      assert.equal(hits.length, 0);
      assert.equal(shared.gemini, 0, "a IA nem é chamada");
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.GEMINI_API_KEY;
    }
  });

  test("arte-base que não é JPEG/PNG/WebP (SVG servido como image/png) é recusada", async () => {
    process.env.GEMINI_API_KEY = "chave-falsa-de-teste";
    const restore = routeHttpsToEcho();
    routes["/svg"] = (res) => {
      res.writeHead(200, { "content-type": "image/png" });
      res.end('<svg xmlns="http://www.w3.org/2000/svg"/>');
    };
    try {
      await assert.rejects(generateArt({ templateUrl: "https://cdn.example.com/svg", theme: "t" }), /não é JPEG, PNG nem WebP/);
      assert.equal(shared.gemini, 0);
    } finally {
      restore();
      delete process.env.GEMINI_API_KEY;
    }
  });
});
