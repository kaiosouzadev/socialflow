/**
 * ADENDO-1 A1 / P4-A2 item 7 (pedido do usuário: trocar "SocialFlow" por "Grupo Coletivo"):
 *   - o assistente de IA se apresenta como "assistente de IA da agência Grupo Coletivo"
 *     (resto do prompt igual) e nunca como SocialFlow;
 *   - os e-mails gerados (aprovação do cronograma e notificações) não mostram "SocialFlow".
 *
 * A rota do assistente roda de verdade (zod, rate limit, lib/gemini) com hooks de módulo para
 * "@/" (técnica do doc-import-captions.test.ts), Prisma e sessão falsos e um `fetch` falso que
 * captura o pedido à IA — nenhuma chamada de rede real.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const CLIENT_ID = "55555555-5555-4555-8555-555555555555";
const BRAND_OLD = /social\s*flow/i;

// ------------------------------------------------------------ falsos

const sent: { url: string; body: Record<string, unknown> }[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\//, `rede real bloqueada no teste: ${url}`);
  sent.push({ url, body: JSON.parse(String(init?.body)) });
  const text = JSON.stringify({ reply: "Sugestão pronta." });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const fakePrisma = {
  client: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === CLIENT_ID ? { name: "ZZ QA P4A2 Marca", toneOfVoice: "leve", briefing: null } : null,
  },
};

const FAKE_MODULES: Record<string, string> = {
  "next/server": "export class NextRequest extends Request {} export class NextResponse extends Response {}",
  "@/auth": "export const auth = async () => ({ user: { id: '00000000-0000-4000-8000-0000000000a5', role: 'staff' } });",
  "@/lib/prisma": "export const prisma = globalThis.__p4a2m.prisma;",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __p4a2m: unknown }).__p4a2m = { prisma: fakePrisma };
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
const assistant = await import("../../src/app/api/ai/assistant/route.ts");
const { approvalEmailHtml } = await import("../../src/lib/email.ts");
const { notifyEmailHtml } = await import("../../src/lib/notify.ts");

// ------------------------------------------------------------ testes

describe("assistente de IA se apresenta como Grupo Coletivo", () => {
  test("prompt de sistema: 'assistente de IA da agência Grupo Coletivo', sem SocialFlow, resto igual", async () => {
    const req = new Request("http://localhost/api/ai/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.42.7.1" },
      body: JSON.stringify({
        clientId: CLIENT_ID,
        post: { theme: "Dia do Cliente", format: "feed", targets: ["instagram"] },
        messages: [{ role: "user", content: "Quem é você?" }],
      }),
    });
    const res = await assistant.POST(req as never);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { reply: "Sugestão pronta." });

    assert.equal(sent.length, 1);
    const system = (sent[0].body.systemInstruction as { parts: { text: string }[] }).parts[0].text;
    const lines = system.split("\n");
    assert.equal(
      lines[0],
      "Você é o assistente de IA da agência Grupo Coletivo, agência brasileira de social media: estrategista e redator."
    );
    assert.doesNotMatch(system, BRAND_OLD);
    // resto do prompt igual ao de antes
    assert.equal(lines[1], "Ajuda a equipe interna a melhorar posts e cronogramas. Sempre em português do Brasil.");
    assert.equal(lines[2], "Cliente: ZZ QA P4A2 Marca.");
    assert.ok(lines.includes("REGRAS DE RESPOSTA — responda SOMENTE com JSON válido neste formato:"));
    assert.ok(lines.includes("- Não invente dados do cliente (telefones, preços, promoções)."));
  });
});

describe("e-mails sem 'SocialFlow' no template renderizado", () => {
  const LINK = "https://exemplo.invalid/aprovar/token-falso";

  test("e-mail de aprovação do cronograma", () => {
    const html = approvalEmailHtml("ZZ QA P4A2 Marca", "outubro de 2026", LINK);
    assert.match(html, /Cronograma de outubro de 2026/);
    assert.doesNotMatch(html, BRAND_OLD);
    assert.doesNotMatch(html, /#7c5cff/i);
  });

  test("e-mail de notificação (equipe e cliente, com e sem botão)", () => {
    for (const html of [
      notifyEmailHtml("Ajuste solicitado", ["Linha 1", "Linha 2"], LINK, "Abrir o post"),
      notifyEmailHtml("Suas postagens da próxima semana estão prontas para revisão", ["Olá!"]),
    ]) {
      assert.doesNotMatch(html, BRAND_OLD);
      assert.doesNotMatch(html, /#7c5cff/i);
    }
  });

  test("nenhum arquivo que monta e-mail (assunto ou corpo) cita SocialFlow", () => {
    // quem monta e-mail: os templates e todo arquivo com `subject:` (assunto do e-mail)
    const files = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.tsx?$/.test(f) && !f.startsWith("generated"))
      .filter((f) => /(^|[\\/])(email|notify)\.ts$/.test(f) || /\bsubject:/.test(readFileSync(path.join(SRC, f), "utf8")));
    assert.ok(files.length >= 5, `poucos arquivos de e-mail encontrados: ${files.join(", ")}`);
    for (const file of files) {
      assert.doesNotMatch(readFileSync(path.join(SRC, file), "utf8"), BRAND_OLD, file);
    }
  });
});
