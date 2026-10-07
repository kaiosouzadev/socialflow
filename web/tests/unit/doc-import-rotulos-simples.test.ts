/**
 * F11-DOC-IMPORT: documento mensal no formato de "rótulos simples" (rótulos com ":",
 * legenda sem "LEGENDA:", "BANNER ANIMADO | TÍTULO:", login/senha sob
 * "Referente ao Instagram:") sem quebrar o formato do S06 (fixture sintética
 * testada em doc-import.test.ts).
 *
 * - Parser: um .docx SINTÉTICO (montado aqui, dados fictícios "ZZ QA F11",
 *   senha "SENHA-FALSA-123") → docxToText → extractCredentials → parseMonthlyDoc.
 * - Credenciais (ciclos 1 e 2): só sai do texto o que parece credencial; frase,
 *   palavra de preenchimento ("Pendente", "N/A", "-"), data, hashtag, URL ou
 *   rótulo nunca vira senha nem login. O que estava no lugar da senha e foi
 *   recusado sai do texto só para "não importado" (oculto), nunca em claro no
 *   briefing; nenhuma outra linha some (casos V1–V19 do Tester e os dos ciclos).
 * - Prévia/commit (`lib/doc-import-commit`): como no doc-import-captions.test.ts,
 *   hooks de módulo resolvem "@/" e trocam o Prisma por um banco falso em memória.
 *   A cifra é a real (lib/crypto) com uma chave de TESTE.
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, docxToText } from "../../src/lib/docx-text.ts";
import { extractCredentials, parseMonthlyDoc, proposeBriefing, stripCredentials } from "../../src/lib/doc-import.ts";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const read = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8").replace(/\r\n?/g, "\n");
const ROTULOS = read("doc-rotulos-simples-sintetico.txt");
const S06 = read("doc-mensal-sintetico.txt");
const PASSWORD = "SENHA-FALSA-123";
const LOGIN = "zzqa.f11@example.com";
const TEST_KEY = "a1".repeat(32); // chave só de teste (64 hex)
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
/** cifra de outra chave (ilegível com a de teste) */
const UNREADABLE = Buffer.alloc(48, 7).toString("base64");

// ------------------------------------------------------------ .docx sintético (ZIP "stored", sem dependência)

const enc = new TextEncoder();
const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function le(bytes: number, value: number): Uint8Array {
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  if (bytes === 2) view.setUint16(0, value, true);
  else view.setUint32(0, value >>> 0, true);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** Texto (um parágrafo por linha) → .docx mínimo com só `word/document.xml`. */
function makeDocx(text: string): Uint8Array<ArrayBuffer> {
  const body = text
    .split("\n")
    .map((l) => (l ? `<w:p><w:r><w:t xml:space="preserve">${escapeXml(l)}</w:t></w:r></w:p>` : "<w:p/>"))
    .join("");
  const xml = enc.encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  );
  const name = enc.encode("word/document.xml");
  const crc = crc32(xml);
  const local = concat([
    le(4, 0x04034b50), le(2, 20), le(2, 0x800), le(2, 0), le(2, 0), le(2, 0),
    le(4, crc), le(4, xml.byteLength), le(4, xml.byteLength), le(2, name.byteLength), le(2, 0), name, xml,
  ]);
  const central = concat([
    le(4, 0x02014b50), le(2, 20), le(2, 20), le(2, 0x800), le(2, 0), le(2, 0), le(2, 0),
    le(4, crc), le(4, xml.byteLength), le(4, xml.byteLength), le(2, name.byteLength), le(2, 0), le(2, 0),
    le(2, 0), le(2, 0), le(4, 0), le(4, 0), name,
  ]);
  const eocd = concat([
    le(4, 0x06054b50), le(2, 0), le(2, 0), le(2, 1), le(2, 1),
    le(4, central.byteLength), le(4, local.byteLength), le(2, 0),
  ]);
  return concat([local, central, eocd]);
}

// ------------------------------------------------------------ parser (puro)

const docxText = await docxToText(makeDocx(ROTULOS.replace(/\n$/, "")));
const extracted = extractCredentials(docxText);
const doc = parseMonthlyDoc(extracted.text, { refMonth: "2026-11" });
const all = [...doc.posts, ...doc.avulsos];

describe("formato de rótulos simples — .docx sintético", () => {
  test("o .docx devolve o texto da fixture, linha a linha", () => {
    assert.equal(docxText, ROTULOS.replace(/\n$/, ""));
  });

  test("5 posts + 1 avulso, todos com data, redatora e legenda (sem “LEGENDA:” nos TÍTULO)", () => {
    assert.equal(doc.posts.length, 5);
    assert.equal(doc.avulsos.length, 1);
    assert.equal(doc.standBy.length, 0);
    assert.deepEqual(
      all.map((p) => p.date),
      ["2026-10-05", "2026-10-12", "2026-10-15", "2026-10-27", "2026-11-03", "2026-10-16"]
    );
    assert.ok(all.every((p) => p.writerName === "PAMELA"));
    assert.ok(all.every((p) => p.caption.length > 0), JSON.stringify(all.map((p) => p.caption.length)));
    const [p1] = doc.posts;
    assert.ok(p1.caption.startsWith("A primeira fornada sai às 6h"));
    assert.ok(p1.caption.includes("\n\nPasse para um café")); // parágrafos preservados
    assert.ok(p1.caption.endsWith("#zzqaf11 #zzqaexemplo #padaria #cafedamanha"));
    assert.equal(p1.internalNote, null); // a legenda não vai mais para a nota interna
    assert.deepEqual(doc.warnings, []);
  });

  test("REELS com TELA e LEGENDA:; “acesso a” no texto da tela continua no post", () => {
    const reels = doc.posts[2];
    assert.equal(reels.format, "reels");
    assert.equal(reels.slides.length, 3);
    assert.match(reels.slides[2].text, /você tem acesso a fornadas/);
    assert.ok(reels.caption.startsWith("Já viu como nasce o pão"));
  });

  test("“BANNER ANIMADO | TÍTULO: …” → feed, título limpo, nota “Banner animado”", () => {
    const banner = doc.posts[3];
    assert.equal(banner.format, "feed");
    assert.equal(banner.title, "Encomendas de bolos para a sua festa");
    assert.equal(banner.internalNote, "Banner animado");
    assert.equal(doc.avulsos[0].title, "16 de Outubro | Dia Mundial do Pão");
  });

  test("briefing com “Rótulo: valor”: unidade, Instagram, site, telefone fixo e WhatsApp; e-mail só sugestão", () => {
    assert.deepEqual(doc.briefing.client, {
      tradeName: "ZZ QA F11 Padaria Exemplo",
      instagramUrl: "https://www.instagram.com/zzqaf11exemplo/",
      website: "https://example.com/zzqaf11",
      phone: "(00) 3000-0000",
      whatsapp: "(00) 90000-0000",
    });
    assert.equal(doc.briefing.emailSuggestion, "contato.f11@example.com");
    assert.deepEqual(doc.briefing.unmapped, []);
    assert.match(doc.header ?? "", /^GESTÃO NÍVEL 2 ZZQA/);
  });

  test("propostas: Plano (linha do plano) e Hashtags (repetidas nas legendas)", () => {
    const p = proposeBriefing(doc);
    assert.equal(p.fields.plan?.value, doc.header);
    assert.equal(p.fields.hashtags?.value, "#zzqaf11 #zzqaexemplo #padaria #cafedamanha");
    assert.match(p.fields.hashtags?.hint ?? "", /legendas/);
    assert.equal(p.email, "contato.f11@example.com");
    assert.deepEqual(Object.keys(p.fields).sort(), ["hashtags", "instagramUrl", "phone", "plan", "tradeName", "website", "whatsapp"]);
  });

  test("credencial: Instagram com login e senha; sai do texto (linhas preservadas); nada dela no parser", () => {
    assert.equal(extracted.credentialDetected, true);
    assert.deepEqual(
      extracted.credentials.map((c) => ({ network: c.network, login: c.login, password: c.password, inBriefing: c.inBriefing })),
      [{ network: "Instagram", login: LOGIN, password: PASSWORD, inBriefing: true }]
    );
    assert.equal(extracted.text.split("\n").length, docxText.split("\n").length);
    assert.ok(!extracted.text.includes(PASSWORD));
    assert.ok(!extracted.text.includes(LOGIN));
    assert.ok(!extracted.text.includes("Referente ao Instagram"));
    // a linha de telefone (rótulo com mais de 60 letras) não é engolida como valor da senha
    assert.ok(extracted.text.includes("fixo e whatsapp: (00) 3000-0000"));
    assert.deepEqual(droppedLines(docxText, extracted.text), [
      "Referente ao Instagram:",
      `Login: ${LOGIN}`,
      `Senha: ${PASSWORD}`,
    ]);
    const json = JSON.stringify(doc);
    assert.ok(!json.includes(PASSWORD) && !json.includes(LOGIN));
  });
});

// ------------------------------------------------------------ credenciais: casos V1–V19 (Tester) e dos ciclos 1 e 2

/** linhas não vazias que saíram do texto (o resto tem de continuar igual, na mesma posição) */
function droppedLines(before: string, after: string): string[] {
  const a = before.split("\n");
  const b = after.split("\n");
  assert.equal(b.length, a.length, "a numeração das linhas não muda");
  a.forEach((l, i) => {
    if (b[i].trim()) assert.equal(b[i], l, `linha ${i + 1} mudou`);
  });
  return a.filter((l, i) => l.trim() && !b[i].trim());
}

const wrap = (snippet: string) =>
  [
    "GESTÃO NÍVEL 1 ZZQA - 2x POR SEMANA",
    "Nome da Unidade: ZZ QA F11 Variação",
    snippet,
    "",
    "PAMELA",
    "01 - TÍTULO: Post da variação (03/11)",
    "Legenda comum do post.",
    "#zzqaf11 #zzqavar",
  ].join("\n");

type Cred = [network: string, login: string, password: string];

function runCase(text: string) {
  const r = extractCredentials(text);
  const d = parseMonthlyDoc(r.text, { refMonth: "2026-11" });
  const p = proposeBriefing(d);
  return { r, d, p, creds: r.credentials.map((c): Cred => [c.network, c.login, c.password]) };
}

/**
 * O caso inteiro: credenciais, linhas que saíram, linhas retidas (no lugar da
 * senha e recusadas: [linha, rótulo]), post intacto, nada da senha nem do texto
 * retido no parser, extração idempotente.
 */
function checkCase(snippet: string, creds: Cred[], dropped: string[], withheld: [number, string][] = []) {
  const text = wrap(snippet);
  const out = runCase(text);
  assert.deepEqual(out.creds, creds);
  assert.deepEqual(droppedLines(text, out.r.text), dropped);
  assert.deepEqual(
    out.r.withheld.map((w): [number, string] => [w.line, w.label]),
    withheld
  );
  const lines = text.split("\n");
  // nenhuma linha retida chega a um campo, nota ou legenda (comparação por linha inteira)
  const landed = new Set(
    [
      ...Object.values(out.p.fields).map((f) => f?.value ?? ""),
      ...out.d.notes.map((n) => n.text),
      ...[...out.d.posts, ...out.d.avulsos].map((p) => p.caption),
    ].flatMap((v) => v.split("\n").map((l) => l.trim()))
  );
  for (const [line] of withheld) assert.ok(!landed.has(lines[line - 1].trim()), `linha ${line} retida não pode ir para o briefing`);
  for (const [line] of withheld) {
    const hidden = lines[line - 1].trim();
    if (hidden.length < 5 || /^[\p{Lu}\p{Ll}]+$/u.test(hidden)) continue; // "-", "na", "PAMELA"… aparecem em outros textos
    assert.ok(!JSON.stringify(out.d).includes(hidden) && !JSON.stringify(out.p).includes(hidden), "texto retido fora do parser");
  }
  const posts = [...out.d.posts, ...out.d.avulsos];
  assert.equal(posts.length, 1);
  assert.ok(posts[0].caption.includes("Legenda comum do post."));
  const parsed = JSON.stringify(out.d) + JSON.stringify(out.p) + out.r.text;
  for (const [, , password] of creds) if (password) assert.ok(!parsed.includes(password), "senha fora do parser");
  // rodar de novo sobre o texto limpo não tira mais nada
  const again = extractCredentials(out.r.text);
  assert.deepEqual(again.credentials, []);
  assert.equal(again.text, out.r.text);
  return out;
}

const PHRASE = "A cliente prefere posts às 9h";
const observations = (o: ReturnType<typeof runCase>) => o.p.fields.observations?.value ?? "";

describe("extractCredentials — casos V1–V14 do Tester", () => {
  test("V1 “Acesso ao Instagram::” + login e senha nas linhas de baixo", () => {
    checkCase("Acesso ao Instagram::\n@zzv1\nPASS-V1", [["Instagram", "@zzv1", "PASS-V1"]], ["Acesso ao Instagram::", "@zzv1", "PASS-V1"]);
  });

  test("V2 “Referente ao Instagram:” + “Login:”/“Senha:”", () => {
    checkCase(
      "Referente ao Instagram:\nLogin: zzv2\nSenha: PASS-V2",
      [["Instagram", "zzv2", "PASS-V2"]],
      ["Referente ao Instagram:", "Login: zzv2", "Senha: PASS-V2"]
    );
  });

  test("V3 “Senha do Facebook:”", () => {
    checkCase("Senha do Facebook: PASS-V3", [["Facebook", "", "PASS-V3"]], ["Senha do Facebook: PASS-V3"]);
  });

  test("V4 “@: perfil” (modelo do formulário)", () => {
    checkCase(
      "Acesso ao Instagram::\n@: zzv4\nSenha: PASS-V4",
      [["Instagram", "@zzv4", "PASS-V4"]],
      ["Acesso ao Instagram::", "@: zzv4", "Senha: PASS-V4"]
    );
  });

  test("V5 “x / y” na mesma linha", () => {
    checkCase("Acesso ao Instagram:: zzv5 / PASS-V5", [["Instagram", "zzv5", "PASS-V5"]], ["Acesso ao Instagram:: zzv5 / PASS-V5"]);
  });

  test("V6 “login: x senha: y” sem rede → Geral", () => {
    checkCase("login: zzv6 senha: PASS-V6", [["Geral", "zzv6", "PASS-V6"]], ["login: zzv6 senha: PASS-V6"]);
  });

  test("V6b (F-5) “Instagram: login: x senha: y” → Instagram, login x, senha y", () => {
    checkCase(
      "Instagram: login: zzv6b senha: PASS-V6B",
      [["Instagram", "zzv6b", "PASS-V6B"]],
      ["Instagram: login: zzv6b senha: PASS-V6B"]
    );
  });

  test("V7 (F-1) “Login: @perfil” sem senha: a frase de baixo NÃO vira senha e fica no briefing", () => {
    const line = "Atendimento de segunda a sexta das 8h às 18h";
    const o = checkCase(`Login: @zzv7\n${line}`, [["Geral", "@zzv7", ""]], ["Login: @zzv7"]);
    assert.ok(o.r.text.includes(line));
    assert.match(observations(o), new RegExp(line));
  });

  test("V7b “Login: @perfil” + linha em branco + frase", () => {
    const o = checkCase("Login: @zzv7b\n\nAtendimento de segunda a sexta", [["Geral", "@zzv7b", ""]], ["Login: @zzv7b"]);
    assert.match(observations(o), /Atendimento de segunda a sexta/);
  });

  test("V8 rótulo longo de senha na mesma linha", () => {
    const line = "Senha de acesso ao Instagram da unidade, combinada com o responsável técnico na reunião de outubro: PASS-V8";
    checkCase(line, [["Instagram", "", "PASS-V8"]], [line]);
  });

  test("V8b rótulo de telefone (61–120) logo depois do bloco: vai para o telefone", () => {
    const phone = "Telefone de contato para divulgação nas artes da unidade e para o público em geral – fixo e whatsapp: (00) 3222-2222";
    const o = checkCase(`Acesso ao Instagram::\n@zzv8b\n${phone}`, [["Instagram", "@zzv8b", ""]], ["Acesso ao Instagram::", "@zzv8b"]);
    assert.equal(o.p.fields.phone?.value, "(00) 3222-2222");
  });

  test("V8c (F-2) rótulo com mais de 120 caracteres depois do bloco: não vira senha nem some", () => {
    const phone =
      "Telefone de contato para divulgação nas artes da unidade e para o público em geral, inclusive nos stories e nos destaques do perfil – fixo e whatsapp: (00) 3333-3333";
    const o = checkCase(`Acesso ao Instagram::\n@zzv8c\n${phone}`, [["Instagram", "@zzv8c", ""]], ["Acesso ao Instagram::", "@zzv8c"]);
    assert.ok(o.r.text.includes(phone));
    assert.ok(JSON.stringify(o.p.fields).includes("(00) 3333-3333"));
  });

  test("V9 (obs. b) “Acesso ao Instagram e Facebook::” → as duas redes com o mesmo login e senha", () => {
    checkCase(
      "Acesso ao Instagram e Facebook::\n@zzv9\nPASS-V9",
      [
        ["Instagram", "@zzv9", "PASS-V9"],
        ["Facebook", "@zzv9", "PASS-V9"],
      ],
      ["Acesso ao Instagram e Facebook::", "@zzv9", "PASS-V9"]
    );
  });

  test("V9b duas redes por contexto (“Instagram:” / “Facebook:”)", () => {
    const snippet = "Instagram:\nLogin: zzig\nSenha: PASS-IG\nFacebook:\nLogin: zzfb\nSenha: PASS-FB";
    checkCase(
      snippet,
      [
        ["Instagram", "zzig", "PASS-IG"],
        ["Facebook", "zzfb", "PASS-FB"],
      ],
      snippet.split("\n")
    );
  });

  test("V9c duas redes com rótulos próprios", () => {
    checkCase(
      "Acesso ao Instagram::\n@zzig9\nPASS-IG9\n\nAcesso ao Facebook::\nzzfb9\nPASS-FB9",
      [
        ["Instagram", "@zzig9", "PASS-IG9"],
        ["Facebook", "zzfb9", "PASS-FB9"],
      ],
      ["Acesso ao Instagram::", "@zzig9", "PASS-IG9", "Acesso ao Facebook::", "zzfb9", "PASS-FB9"]
    );
  });

  test("V13 (F-3) linha depois de login e senha volta ao texto (Observações)", () => {
    const o = checkCase(
      `Acesso ao Instagram::\n@zzv13\nPASS-V13\n${PHRASE}`,
      [["Instagram", "@zzv13", "PASS-V13"]],
      ["Acesso ao Instagram::", "@zzv13", "PASS-V13"]
    );
    assert.match(observations(o), new RegExp(PHRASE));
  });

  test("V14 (F-1/O-1) “Senha:” vazia + frase: sem senha; a frase (no lugar da senha) só em “não importado”, oculta", () => {
    const o = checkCase(
      `Acesso ao Instagram::\n@zzv14\nSenha:\n${PHRASE}`,
      [["Instagram", "@zzv14", ""]],
      ["Acesso ao Instagram::", "@zzv14", "Senha:", PHRASE],
      [[6, "Senha"]]
    );
    assert.equal(observations(o), "");
  });

  test("V15 “Senha:” vazia sem rede + frase → nenhuma credencial; a frase só em “não importado”, oculta", () => {
    checkCase("Senha:\nAtendimento somente com hora marcada", [], ["Senha:", "Atendimento somente com hora marcada"], [[4, "Senha"]]);
  });

  test("V16 “Senha:” vazia + outro rótulo: o rótulo segue para o briefing", () => {
    const o = checkCase("Senha do Instagram:\nCidade: Exemplo - EX", [], ["Senha do Instagram:"]);
    assert.equal(o.p.fields.city?.value, "Exemplo - EX");
  });

  test("V17 “Senha:” vazia + linha em branco + token → senha (não vai em claro para Observações)", () => {
    const o = checkCase("Senha do Instagram:\n\nPASSV17", [["Instagram", "", "PASSV17"]], ["Senha do Instagram:", "PASSV17"]);
    assert.equal(observations(o), "");
  });

  test("V17b “Senha:” vazia + linha em branco + frase → no lugar da senha: oculta em “não importado”, nunca em Observações", () => {
    const o = checkCase(`Senha do Instagram:\n\n${PHRASE}`, [], ["Senha do Instagram:", PHRASE], [[5, "Senha do Instagram"]]);
    assert.equal(observations(o), "");
  });

  test("V18 “Senha:” vazia + hashtags: as hashtags seguem para o briefing", () => {
    const o = checkCase("Senha do Instagram:\n#zzloja #zzpadaria", [], ["Senha do Instagram:"]);
    assert.equal(o.p.fields.hashtags?.value, "#zzloja #zzpadaria");
  });

  test("V19 (O-1) senha com espaço no lugar da senha → só em “não importado”, oculta; nunca em Observações", () => {
    const o = checkCase(
      "Acesso ao Instagram::\n@zzv19\nminha senha 19",
      [["Instagram", "@zzv19", ""]],
      ["Acesso ao Instagram::", "@zzv19", "minha senha 19"],
      [[5, "Acesso ao Instagram"]]
    );
    assert.equal(observations(o), "");
  });

  test("V9d rótulo com rede + outra coisa → só a rede citada", () => {
    checkCase(
      "Acesso ao Instagram e site da loja::\n@zzv9d\nPASS-V9D",
      [["Instagram", "@zzv9d", "PASS-V9D"]],
      ["Acesso ao Instagram e site da loja::", "@zzv9d", "PASS-V9D"]
    );
  });

  test("D2b (O-2) link de outro site debaixo de “Acesso ao Instagram::” não vira login: fica no texto", () => {
    const o = checkCase("Acesso ao Instagram::\nhttps://example.com/zzsite", [], ["Acesso ao Instagram::"]);
    assert.match(observations(o), /https:\/\/example\.com\/zzsite/);
  });
});

// ------------------------------------------------------------ F-6: preenchimento nunca é login nem senha

/** valores que NÃO são senha: preenchimento, símbolo, data, hashtag, curto, frase */
const NOT_PASSWORDS = [
  "Pendente", "pendente.", "Ok", "Aguardando", "SIM", "Não", "N/A", "na", "-", "—", "?", "xxx",
  "a definir", "pedir_para_cliente", "Ver_com_cliente", "12/10", "12/10/2026", "#zzloja", "abc", "minha senha 19",
  "https://example.com/zz", "www.example.com",
];
/**
 * valores que NÃO são login (fora: "abc", login curto vale; o link, testado em D2b; e "minha senha 19",
 * que tem a palavra "senha" e é testado à parte)
 */
const NOT_LOGINS = NOT_PASSWORDS.filter((v) => v !== "abc" && !v.startsWith("https://") && v !== "minha senha 19");

describe("F-6 — palavras de preenchimento, datas e símbolos", () => {
  for (const value of NOT_PASSWORDS) {
    test(`“${value}” como senha: na mesma linha, debaixo de “Senha:” e no bloco → sem senha, oculto em “não importado”`, () => {
      checkCase(`Senha do Instagram: ${value}`, [], [`Senha do Instagram: ${value}`], [[3, "Senha do Instagram"]]);
      checkCase(`Senha do Instagram:\n${value}`, [], ["Senha do Instagram:", value], [[4, "Senha do Instagram"]]);
      checkCase(
        `Acesso ao Instagram::\n@zzf6\n${value}`,
        [["Instagram", "@zzf6", ""]],
        ["Acesso ao Instagram::", "@zzf6", value],
        [[5, "Acesso ao Instagram"]]
      );
    });
  }

  for (const value of NOT_LOGINS) {
    test(`“${value}” no lugar do login do bloco → não vira login e fica no texto`, () => {
      const text = wrap(`Acesso ao Instagram::\n${value}`);
      const o = runCase(text);
      assert.deepEqual(o.creds, []);
      assert.ok(droppedLines(text, o.r.text).every((l) => l === "Acesso ao Instagram::"));
      assert.deepEqual(o.r.withheld, []);
    });
  }

  test("“minha senha 19” no lugar do login do bloco → nem login nem senha; a linha fica oculta", () => {
    checkCase("Acesso ao Instagram::\nminha senha 19", [], ["Acesso ao Instagram::", "minha senha 19"], [[4, "Acesso ao Instagram"]]);
  });

  test("preenchimento no lugar do login passa a vez: a senha da linha de baixo ainda é lida", () => {
    checkCase(
      "Acesso ao Instagram::\nPendente\nPASS-F6L",
      [["Instagram", "", "PASS-F6L"]],
      ["Acesso ao Instagram::", "PASS-F6L"]
    );
  });

  test("“x / Pendente” na mesma linha → só o login; a senha recusada aparece oculta", () => {
    checkCase("Acesso ao Instagram:: @zzf6b / Pendente", [["Instagram", "@zzf6b", ""]], ["Acesso ao Instagram:: @zzf6b / Pendente"], [[3, "Acesso ao Instagram"]]);
  });

  test("senhas válidas continuam valendo (número, símbolo, 4+ caracteres)", () => {
    checkCase("Senha do Instagram: 00900000000", [["Instagram", "", "00900000000"]], ["Senha do Instagram: 00900000000"]);
    checkCase("Senha do Instagram: Pendente@2024", [["Instagram", "", "Pendente@2024"]], ["Senha do Instagram: Pendente@2024"]);
    checkCase("Senha do Instagram: Ab1!", [["Instagram", "", "Ab1!"]], ["Senha do Instagram: Ab1!"]);
  });

  test("na legenda, “Senha: Pendente” não é credencial e fica na legenda", () => {
    const text = ["GESTÃO NÍVEL 1 ZZQA", "", "PAMELA", "01 - TÍTULO: Post (03/11)", "Senha: Pendente", "Legenda comum."].join("\n");
    const o = runCase(text);
    assert.deepEqual(o.creds, []);
    assert.deepEqual(o.r.withheld, []);
    assert.ok(o.d.posts[0].caption.includes("Senha: Pendente"));
  });
});

// ------------------------------------------------------------ F-7: na linha de baixo, palavra comum nunca é senha

/** os 22 casos do Tester (11 palavras × direto e depois de linha em branco), mais variações com enfeite */
const COMMON_WORDS = [
  "Importante", "OBSERVAÇÕES", "Designer", "Instagram", "Atenção", "Obrigada", "Hashtags", "Referências", "Clínica",
  "PAMELA", "Agendamentos",
];
/** senhas plausíveis na linha de baixo: têm dígito ou símbolo */
const BELOW_PASSWORDS = ["Cliente#2026", "senha123", "Ab1!xyz", "00900000000", "PASSV17", "Ver.2026"];

describe("F-7 — senha na linha de baixo: só token com dígito ou símbolo", () => {
  for (const word of [...COMMON_WORDS, "*IMPORTANTE*", "ATENÇÃO!!!", "Flamengo"]) {
    test(`“${word}” debaixo de “Senha:” (direto e depois de linha em branco) e na linha da senha do bloco → oculto, sem senha`, () => {
      checkCase(`Senha do Instagram:\n${word}`, [], ["Senha do Instagram:", word], [[4, "Senha do Instagram"]]);
      checkCase(`Senha do Instagram:\n\n${word}`, [], ["Senha do Instagram:", word], [[5, "Senha do Instagram"]]);
      checkCase(
        `Acesso ao Instagram::\n@zzf7\n${word}`,
        [["Instagram", "@zzf7", ""]],
        ["Acesso ao Instagram::", "@zzf7", word],
        [[5, "Acesso ao Instagram"]]
      );
    });
  }

  test("na MESMA linha do rótulo, palavra só de letras continua valendo (regra do F-6)", () => {
    checkCase("Senha do Instagram: Flamengo", [["Instagram", "", "Flamengo"]], ["Senha do Instagram: Flamengo"]);
  });

  for (const pw of BELOW_PASSWORDS) {
    test(`“${pw}” na linha de baixo (direto, depois de linha em branco e no bloco) → senha`, () => {
      checkCase(`Senha do Instagram:\n${pw}`, [["Instagram", "", pw]], ["Senha do Instagram:", pw]);
      checkCase(`Senha do Instagram:\n\n${pw}`, [["Instagram", "", pw]], ["Senha do Instagram:", pw]);
      checkCase(`Acesso ao Instagram::\n@zzf7\n${pw}`, [["Instagram", "@zzf7", pw]], ["Acesso ao Instagram::", "@zzf7", pw]);
    });
  }

  test("depois de linha em branco, preenchimento e senha com espaço também ficam ocultos (nunca em Observações)", () => {
    for (const value of ["Pendente", "N/A", "minha senha 17"]) {
      const o = checkCase(`Senha do Instagram:\n\n${value}`, [], ["Senha do Instagram:", value], [[5, "Senha do Instagram"]]);
      assert.equal(observations(o), "");
    }
  });

  test("“@perfil / Flamengo” na linha de baixo do bloco → a linha inteira fica oculta (nem login nem senha)", () => {
    checkCase("Acesso ao Instagram::\n@zzf7b / Flamengo", [], ["Acesso ao Instagram::", "@zzf7b / Flamengo"], [[4, "Acesso ao Instagram"]]);
  });

  test("“@perfil / Cliente#2026” na linha de baixo do bloco → login e senha", () => {
    checkCase(
      "Acesso ao Instagram::\n@zzf7c / Cliente#2026",
      [["Instagram", "@zzf7c", "Cliente#2026"]],
      ["Acesso ao Instagram::", "@zzf7c / Cliente#2026"]
    );
  });
});

describe("extractCredentials — ciclo 1", () => {
  test("“Senha:” vazia + token na linha de baixo → senha (não vai em claro para Observações)", () => {
    const o = checkCase(
      "Referente ao Facebook:\nLogin: zzc1\nSenha:\nPASS-C1",
      [["Facebook", "zzc1", "PASS-C1"]],
      ["Referente ao Facebook:", "Login: zzc1", "Senha:", "PASS-C1"]
    );
    assert.equal(observations(o), "");
  });

  test("valor na mesma linha com observação entre parênteses; login por telefone", () => {
    checkCase(
      "Referente ao Facebook:\nLogin: (00) 90000-0000\nSenha: PASS-C2 (trocar em março)",
      [["Facebook", "(00) 90000-0000", "PASS-C2"]],
      ["Referente ao Facebook:", "Login: (00) 90000-0000", "Senha: PASS-C2 (trocar em março)"]
    );
  });

  test("link do perfil no lugar do @perfil: a senha de baixo não escapa para o texto", () => {
    const o = checkCase(
      "Acesso ao Instagram::\nhttps://www.instagram.com/zzc3/\nPASS-C3",
      [["Instagram", "https://www.instagram.com/zzc3/", "PASS-C3"]],
      ["Acesso ao Instagram::", "https://www.instagram.com/zzc3/", "PASS-C3"]
    );
    assert.equal(observations(o), "");
  });

  test("frase depois de “Senha:” na mesma linha não é senha: sai do texto só para “não importado”, sem o valor", () => {
    const line = "Senha do wifi: peça na recepção";
    const o = checkCase(line, [], [line], [[3, "Senha do wifi"]]);
    assert.equal(o.r.credentialDetected, true);
  });

  test("rótulo de login com frase: não é credencial e aparece em “não importado” sem o valor", () => {
    const o = checkCase("Login: pedir para a cliente", [], []);
    assert.deepEqual(o.p.unmapped, [{ line: 3, label: "Login", value: "", duplicate: false, credential: true }]);
  });

  test("a redatora logo antes do 1º post nunca é valor de credencial", () => {
    const text = [
      "Acesso ao Instagram::",
      "@zzc5",
      "PAMELA",
      "01 - TÍTULO: Post (03/11)",
      "Legenda comum do post.",
    ].join("\n");
    const o = runCase(text);
    assert.deepEqual(o.creds, [["Instagram", "@zzc5", ""]]);
    assert.equal(o.d.posts[0].writerName, "PAMELA");
  });

  test("legenda: “Senha: peça na recepção” e “Acesso ao Instagram liberado!” ficam; “Facebook: senha: x” sai, fora do briefing", () => {
    const text = [
      "GESTÃO NÍVEL 1 ZZQA",
      "Nome da Unidade: ZZ QA F11 Legenda",
      "",
      "PAMELA",
      "01 - TÍTULO: Wi-fi (03/11)",
      "Venha nos visitar, temos acesso ao nosso site e wi-fi.",
      "Senha: peça na recepção",
      "Acesso ao Instagram liberado!",
      "Facebook: senha: PASS-C6",
      "Dica: troque a senha a cada 3 meses.",
      "#zzqaf11 #zzqavar",
    ].join("\n");
    const o = runCase(text);
    assert.deepEqual(
      o.r.credentials.map((c) => [c.network, c.login, c.password, c.inBriefing]),
      [["Facebook", "", "PASS-C6", false]]
    );
    assert.deepEqual(droppedLines(text, o.r.text), ["Facebook: senha: PASS-C6"]);
    const caption = o.d.posts[0].caption;
    for (const kept of ["Senha: peça na recepção", "Acesso ao Instagram liberado!", "acesso ao nosso site", "troque a senha a cada 3 meses"]) {
      assert.ok(caption.includes(kept), kept);
    }
    assert.ok(!caption.includes("PASS-C6"));
  });

  test("“Acesso a todos os materiais…” (sem rede) não é credencial; senha sem rede → “Geral”", () => {
    const text = ["Acesso a todos os materiais na pasta do cliente", `Senha: ${PASSWORD}`].join("\n");
    const r = extractCredentials(text);
    assert.ok(r.text.startsWith("Acesso a todos os materiais"));
    assert.deepEqual(r.credentials.map((c) => [c.network, c.password]), [["Geral", PASSWORD]]);
  });

  test("formato S06 (“Acesso ao Instagram::” + linhas de valor) → Instagram, login e senha", () => {
    const r = extractCredentials(S06);
    assert.deepEqual(
      r.credentials.map((c) => [c.network, c.login, c.password]),
      [["Instagram", "@clienteexemplo", PASSWORD]]
    );
    assert.deepEqual(droppedLines(S06, r.text), ["Acesso ao Instagram::", "@clienteexemplo", PASSWORD]);
    assert.deepEqual(stripCredentials(S06), { text: r.text, credentialDetected: true });
  });

  test("mesma linha, rede no rótulo, rede do contexto e “Login: x / Senha: y”", () => {
    const text = [
      "Nome da empresa (fantasia):: Loja Teste",
      `Acesso ao Instagram:: @lojateste / ${PASSWORD}`,
      `Senha do Facebook:: ${PASSWORD}-FB`,
      "LinkedIn:",
      `Usuário: zzqa.linkedin@example.com / Senha: ${PASSWORD}-LI`,
      "Cidade - Estado:: Cidade - EX",
      "",
      "01 - TÍTULO: Teste (05/09)",
      "LEGENDA:",
      "Garanta o acesso ao nosso site pelo link da bio.",
    ].join("\n");
    const r = extractCredentials(text);
    assert.deepEqual(
      r.credentials.map((c) => [c.network, c.login, c.password]),
      [
        ["Instagram", "@lojateste", PASSWORD],
        ["Facebook", "", `${PASSWORD}-FB`],
        ["LinkedIn", "zzqa.linkedin@example.com", `${PASSWORD}-LI`],
      ]
    );
    assert.ok(!r.text.includes(PASSWORD));
    assert.ok(r.text.includes("Cidade - Estado:: Cidade - EX"));
    assert.ok(r.text.includes("Garanta o acesso ao nosso site pelo link da bio."));
  });
});

describe("formato S06 — o que antes se perdia", () => {
  const s06 = parseMonthlyDoc(S06, { refMonth: "2026-09" });
  test("rótulos com “:” num documento com “::” completam o briefing (sem mexer no principal)", () => {
    assert.match(s06.looseBriefing.briefing.designNotes ?? "", /^CAMINHO: .*Procedimentos\nCAMINHO: .*Consultório\nDESIGNER: /);
    assert.match(s06.looseBriefing.briefing.designNotes ?? "", /Referência de Reels: https:\/\/www\.instagram\.com\/reel\/exemplo/);
    assert.deepEqual(s06.looseBriefing.unmapped, []);
  });

  test("notas soltas → Observações; linha do plano → Plano", () => {
    const p = proposeBriefing(s06);
    assert.match(p.fields.observations?.value ?? "", /^Evitar fotos com o rosto de clientes\.\n/);
    assert.match(p.fields.observations?.value ?? "", /A cliente quer que os posts sejam postados às 9h/);
    assert.match(p.fields.plan?.value ?? "", /^GESTÃO COM ARTES ESTÁTICAS/);
    assert.ok(!JSON.stringify(p).includes(PASSWORD));
  });
});

// ------------------------------------------------------------ prévia e commit (banco falso)

type Row = Record<string, unknown>;
const state = {
  client: null as Row | null,
  users: [] as Row[],
  posts: [] as Row[],
  schedules: [] as Row[],
  pending: [] as Row[],
};

function reset(credentialsEnc: string | null = null) {
  state.client = {
    id: CLIENT_ID,
    name: "ZZ QA F11 Cliente",
    plan: "sem_aprovacao",
    agencyPublishes: true,
    responsibleUserId: null,
    briefing: null,
    tradeName: null,
    facebookUrl: null,
    instagramUrl: null,
    website: null,
    city: null,
    phone: null,
    whatsapp: null,
    toneOfVoice: null,
    credentialsEnc,
    socialAccounts: [],
  };
  state.users = [{ id: "u-pamela", name: "Pamela" }];
  state.posts = [];
  state.schedules = [];
  state.pending = [];
}

type Range = { gte?: Date; lt?: Date };
const inRange = (d: Date, r?: Range) => !r || ((!r.gte || d >= r.gte) && (!r.lt || d < r.lt));

const tx = {
  $executeRaw: async () => 0,
  client: {
    findUnique: async ({ where }: { where: { id: string } }) => (state.client?.id === where.id ? state.client : null),
    update: async ({ data }: { data: Row }) => Object.assign(state.client as Row, data),
  },
  user: { findMany: async () => state.users },
  post: {
    findMany: async ({ where }: { where: { clientId: string; scheduledAt?: Range } }) =>
      state.posts.filter((p) => p.clientId === where.clientId && inRange(p.scheduledAt as Date, where.scheduledAt)),
    createMany: async ({ data }: { data: Row[] }) => {
      state.posts.push(...data);
      return { count: data.length };
    },
  },
  pendingItem: {
    findMany: async () => [],
    createMany: async ({ data }: { data: Row[] }) => {
      state.pending.push(...data);
      return { count: data.length };
    },
  },
  schedule: {
    findFirst: async ({ where }: { where: { clientId: string; monthRef: Date } }) =>
      state.schedules.find(
        (s) => s.clientId === where.clientId && (s.monthRef as Date).getTime() === where.monthRef.getTime()
      ) ?? null,
    create: async ({ data }: { data: Row }) => {
      const row: Row = { id: `sch-${state.schedules.length + 1}`, ...data };
      state.schedules.push(row);
      return { id: row.id, status: row.status };
    },
  },
};
const fakePrisma = { ...tx, $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };

const FAKE_MODULES: Record<string, string> = {
  "@/lib/prisma": "export const prisma = globalThis.__f11.prisma;",
  "@/generated/prisma/client": "export const Prisma = {};",
};
type ResolveHook = (
  specifier: string,
  context: unknown,
  nextResolve: (specifier: string, context: unknown) => unknown
) => unknown;
const { registerHooks } = nodeModule as unknown as { registerHooks: (hooks: { resolve: ResolveHook }) => void };

(globalThis as unknown as { __f11: unknown }).__f11 = { prisma: fakePrisma };
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

const { analyzeImport, commitImport, BRIEFING_FIELDS } = await import("../../src/lib/doc-import-commit.ts");
const { decryptCredentials, encryptCredentials } = await import("../../src/lib/client-credentials.ts");

const input = (options?: Record<string, unknown>, text = docxText) => ({ text, refMonth: "2026-11", options });

describe("prévia e commit com credenciais (banco falso, cifra real)", () => {
  beforeEach(() => {
    process.env.TOKEN_ENC_KEY = TEST_KEY;
    reset();
  });

  test("prévia: rede, login e “tem senha”; a resposta nunca contém a senha", async () => {
    const a = await analyzeImport(CLIENT_ID, input());
    const json = JSON.stringify({ mode: "preview", ...a });
    assert.ok(!json.includes(PASSWORD), "a senha não pode estar na prévia");
    assert.ok(!json.includes("credentialsEnc"));
    assert.deepEqual(a.credentials, [
      { network: "Instagram", line: 7, login: LOGIN, hasPassword: true, replaces: false, inBriefing: true, suggested: true },
    ]);
    assert.equal(a.credentialsBlocked, null);
    assert.ok(a.warnings.some((w) => w.code === "credencial" && !/descartad/.test(w.message)));
    assert.equal(a.counts.toCreate.posts, 6);
    assert.ok(a.items.every((i) => i.caption.length > 0));
    assert.deepEqual(
      a.briefing.map((b) => b.field),
      ["tradeName", "instagramUrl", "website", "phone", "whatsapp", "hashtags", "plan"]
    );
    assert.deepEqual(
      a.notImported.map((n) => [n.kind, n.value]),
      [["email", "contato.f11@example.com"]]
    );
  });

  test("prévia: “Geral” e credencial fora do briefing vêm desmarcadas; frase de senha só como “não importado”, sem o valor", async () => {
    const text = docxText
      .replace(
        "E-mail para divulgação nas artes da loja: contato.f11@example.com",
        "E-mail para divulgação nas artes da loja: contato.f11@example.com\nLogin: @zzgeral\nSenha do wifi: peça na recepção"
      )
      .replace("Vem provar!", "Vem provar!\nFacebook: senha: PASS-FB-LEGENDA");
    const a = await analyzeImport(CLIENT_ID, input(undefined, text));
    assert.deepEqual(
      a.credentials.map((c) => [c.network, c.inBriefing, c.suggested]),
      [
        ["Instagram", true, true],
        ["Geral", true, false],
        ["Facebook", false, false],
      ]
    );
    const wifi = a.notImported.find((n) => n.kind === "credencial");
    assert.equal(wifi?.label, "Senha do wifi");
    assert.equal(wifi?.line, 12);
    const json = JSON.stringify(a);
    for (const secret of [PASSWORD, "PASS-FB-LEGENDA", "peça na recepção"]) assert.ok(!json.includes(secret), secret);
    // a legenda não perde nada além da linha da senha
    assert.ok(a.items.some((i) => i.caption.includes("Vem provar!")));
  });

  test("commit: grava credentialsEnc cifrado e decifrável; briefing novo; nada em claro", async () => {
    const result = await commitImport(
      CLIENT_ID,
      input({ credentials: ["Instagram"], briefingFields: [...BRIEFING_FIELDS] })
    );
    assert.deepEqual(result.credentialsSaved, ["Instagram"]);
    assert.equal(result.created.posts, 6);
    const enc = state.client?.credentialsEnc as string;
    assert.equal(typeof enc, "string");
    assert.ok(!enc.includes(PASSWORD));
    assert.deepEqual(decryptCredentials(enc), [{ network: "Instagram", login: LOGIN, password: PASSWORD }]);
    assert.equal(state.client?.whatsapp, "(00) 90000-0000");
    assert.match(String((state.client?.briefing as Row).plan), /^GESTÃO NÍVEL 2 ZZQA/);
    assert.ok(!JSON.stringify(result).includes(PASSWORD));
    assert.ok(!JSON.stringify({ posts: state.posts, pending: state.pending, schedules: state.schedules }).includes(PASSWORD));
  });

  test("commit: “Acesso ao Instagram e Facebook::” grava as duas redes", async () => {
    const text = docxText.replace(
      `Referente ao Instagram:\nLogin: ${LOGIN}\nSenha: ${PASSWORD}`,
      `Acesso ao Instagram e Facebook::\n${LOGIN}\n${PASSWORD}`
    );
    const a = await analyzeImport(CLIENT_ID, input(undefined, text));
    assert.deepEqual(
      a.credentials.map((c) => [c.network, c.login, c.hasPassword, c.suggested]),
      [
        ["Instagram", LOGIN, true, true],
        ["Facebook", LOGIN, true, true],
      ]
    );
    const r = await commitImport(CLIENT_ID, input({ credentials: ["Instagram", "Facebook"] }, text));
    assert.deepEqual(r.credentialsSaved, ["Instagram", "Facebook"]);
    assert.deepEqual(decryptCredentials(state.client?.credentialsEnc as string), [
      { network: "Instagram", login: LOGIN, password: PASSWORD },
      { network: "Facebook", login: LOGIN, password: PASSWORD },
    ]);
  });

  test("substitui só a rede do documento: Facebook (e a nota do Instagram) ficam", async () => {
    reset(
      encryptCredentials([
        { network: "insta", login: "antigo@example.com", password: "ANTIGA-FALSA", note: "conta principal" },
        { network: "Facebook", login: "fb@example.com", password: "FB-FALSA" },
      ])
    );
    const a = await analyzeImport(CLIENT_ID, input());
    assert.equal(a.credentials[0].replaces, true);
    assert.equal(a.credentials[0].suggested, false); // já existe uma salva: vem desmarcada
    assert.ok(!JSON.stringify(a).includes("ANTIGA-FALSA") && !JSON.stringify(a).includes("FB-FALSA"));
    await commitImport(CLIENT_ID, input({ credentials: ["Instagram"] })); // a pessoa marcou
    assert.deepEqual(decryptCredentials(state.client?.credentialsEnc as string), [
      { network: "insta", login: LOGIN, password: PASSWORD, note: "conta principal" },
      { network: "Facebook", login: "fb@example.com", password: "FB-FALSA" },
    ]);
  });

  test("V14 na prévia: a senha atual do Instagram não é substituída por uma frase", async () => {
    reset(encryptCredentials([{ network: "Instagram", login: "antigo@example.com", password: "ANTIGA-FALSA" }]));
    const text = docxText.replace(
      `Referente ao Instagram:\nLogin: ${LOGIN}\nSenha: ${PASSWORD}`,
      `Acesso ao Instagram::\n@zzv14\nSenha:\n${PHRASE}`
    );
    const a = await analyzeImport(CLIENT_ID, input(undefined, text));
    assert.deepEqual(
      a.credentials.map((c) => [c.network, c.login, c.hasPassword, c.replaces]),
      [["Instagram", "@zzv14", false, true]]
    );
    await commitImport(CLIENT_ID, input({ credentials: ["Instagram"] }, text));
    // senha vazia no documento mantém a atual
    assert.deepEqual(decryptCredentials(state.client?.credentialsEnc as string), [
      { network: "Instagram", login: "@zzv14", password: "ANTIGA-FALSA" },
    ]);
  });

  test("credencial que substituiria uma salva vem DESMARCADA: sem marcar não toca (overwritten: false); marcando substitui", async () => {
    const saved = [{ network: "Instagram", login: "antigo@example.com", password: "ANTIGA-FALSA" }];
    reset(encryptCredentials(saved));
    const a = await analyzeImport(CLIENT_ID, input());
    assert.deepEqual(
      a.credentials.map((c) => [c.network, c.hasPassword, c.replaces, c.suggested]),
      [["Instagram", true, true, false]]
    );
    // seleção padrão da tela: só as `suggested` (nenhuma)
    const defaults = a.credentials.filter((c) => c.suggested).map((c) => c.network);
    assert.deepEqual(defaults, []);
    const r = await commitImport(CLIENT_ID, input({ credentials: defaults, briefingFields: [...BRIEFING_FIELDS] }));
    assert.deepEqual(r.credentialsSaved, []);
    assert.deepEqual(decryptCredentials(state.client?.credentialsEnc as string), saved);
    // a pessoa marca: substitui
    const again = await commitImport(CLIENT_ID, input({ credentials: ["Instagram"] }));
    assert.deepEqual(again.credentialsSaved, ["Instagram"]);
    assert.deepEqual(decryptCredentials(state.client?.credentialsEnc as string), [
      { network: "Instagram", login: LOGIN, password: PASSWORD },
    ]);
  });

  test("credencial nova (sem salva da rede) continua vindo marcada", async () => {
    reset(encryptCredentials([{ network: "Facebook", login: "fb@example.com", password: "FB-FALSA" }]));
    const a = await analyzeImport(CLIENT_ID, input());
    assert.deepEqual(
      a.credentials.map((c) => [c.network, c.replaces, c.suggested]),
      [["Instagram", false, true]]
    );
  });

  for (const [name, block] of [
    ["F-6 “Senha: Pendente” na mesma linha", "Acesso ao Instagram::\n@zzf6\nSenha: Pendente"],
    ["F-6 “Senha:” vazia + “-” na linha de baixo", "Acesso ao Instagram::\n@zzf6\nSenha:\n-"],
    ["F-6 “N/A” na linha da senha do bloco", "Acesso ao Instagram::\n@zzf6\nN/A"],
    ["F-7 “Importante” na linha da senha do bloco", "Acesso ao Instagram::\n@zzf6\nImportante"],
    ["F-7 “Senha:” vazia + branco + “OBSERVAÇÕES”", "Acesso ao Instagram::\n@zzf6\nSenha:\n\nOBSERVAÇÕES"],
  ] as const) {
    test(`ponta a ponta (${name}): senha já salva → mesmo MARCANDO, a senha atual fica`, async () => {
      reset(encryptCredentials([{ network: "Instagram", login: "antigo@example.com", password: "ANTIGA-FALSA" }]));
      const text = docxText.replace(`Referente ao Instagram:\nLogin: ${LOGIN}\nSenha: ${PASSWORD}`, block);
      const a = await analyzeImport(CLIENT_ID, input(undefined, text));
      assert.deepEqual(
        a.credentials.map((c) => [c.network, c.login, c.hasPassword, c.replaces, c.suggested]),
        [["Instagram", "@zzf6", false, true, false]]
      );
      const hidden = a.notImported.filter((n) => n.kind === "credencial");
      assert.equal(hidden.length, 1);
      assert.equal(hidden[0].value, "Texto oculto por segurança.");
      assert.ok(!a.briefing.some((b) => /Pendente|N\/A|^-$|Importante|OBSERVAÇÕES/.test(b.proposed)), "nada do lugar da senha no briefing");
      // pior caso: a pessoa marca a credencial
      await commitImport(CLIENT_ID, input({ credentials: ["Instagram"], briefingFields: [...BRIEFING_FIELDS] }, text));
      const saved = decryptCredentials(state.client?.credentialsEnc as string);
      assert.deepEqual(saved, [{ network: "Instagram", login: "@zzf6", password: "ANTIGA-FALSA" }]); // overwritten: false
      assert.ok(!/Pendente|Importante|OBSERVAÇÕES/.test(JSON.stringify(state.client?.briefing ?? {})));
    });
  }

  test("F-7 ponta a ponta: “Senha do Instagram:” + palavra comum, sem login → nenhuma credencial, senha salva intacta", async () => {
    const saved = [{ network: "Instagram", login: "antigo@example.com", password: "ANTIGA-FALSA" }];
    reset(encryptCredentials(saved));
    const text = docxText.replace(`Referente ao Instagram:\nLogin: ${LOGIN}\nSenha: ${PASSWORD}`, "Senha do Instagram:\nImportante");
    const a = await analyzeImport(CLIENT_ID, input(undefined, text));
    assert.deepEqual(a.credentials, []);
    assert.deepEqual(a.notImported.filter((n) => n.kind === "credencial").map((n) => [n.label, n.line]), [["Senha do Instagram", 7]]);
    await commitImport(CLIENT_ID, input({ credentials: ["Instagram"], briefingFields: [...BRIEFING_FIELDS] }, text));
    assert.deepEqual(decryptCredentials(state.client?.credentialsEnc as string), saved);
  });

  test("O-1 ponta a ponta: senha com espaço no lugar da senha não vai para o briefing em claro", async () => {
    const text = docxText.replace(`Referente ao Instagram:\nLogin: ${LOGIN}\nSenha: ${PASSWORD}`, "Acesso ao Instagram::\n@zzo1\nminha senha 19");
    const a = await analyzeImport(CLIENT_ID, input(undefined, text));
    assert.ok(!JSON.stringify(a).includes("minha senha 19"));
    assert.deepEqual(
      a.notImported.filter((n) => n.kind === "credencial").map((n) => [n.label, n.line]),
      [["Acesso ao Instagram", 8]]
    );
    await commitImport(CLIENT_ID, input({ credentials: ["Instagram"], briefingFields: [...BRIEFING_FIELDS] }, text));
    assert.ok(!JSON.stringify(state.client?.briefing ?? {}).includes("minha senha 19"));
  });

  test("rede desmarcada (options.credentials vazio) não grava; reimportar cria 0 posts", async () => {
    await commitImport(CLIENT_ID, input({ credentials: [] }));
    assert.equal(state.client?.credentialsEnc, null);
    const again = await commitImport(CLIENT_ID, input({ credentials: [] }));
    assert.equal(again.created.posts, 0);
  });

  test("sem TOKEN_ENC_KEY: prévia avisa, commit não grava credencial e não falha", async () => {
    delete process.env.TOKEN_ENC_KEY;
    const a = await analyzeImport(CLIENT_ID, input());
    assert.match(a.credentialsBlocked ?? "", /proteção de credenciais não está configurada/);
    const r = await commitImport(CLIENT_ID, input({ credentials: ["Instagram"] }));
    assert.deepEqual(r.credentialsSaved, []);
    assert.equal(r.created.posts, 6);
    assert.equal(state.client?.credentialsEnc, null);
  });

  test("credenciais atuais ilegíveis: não sobrescreve (não perde as outras redes)", async () => {
    reset(UNREADABLE);
    const a = await analyzeImport(CLIENT_ID, input());
    assert.match(a.credentialsBlocked ?? "", /Não conseguimos ler as credenciais já salvas/);
    await commitImport(CLIENT_ID, input({ credentials: ["Instagram"] }));
    assert.equal(state.client?.credentialsEnc, UNREADABLE);
  });
});
