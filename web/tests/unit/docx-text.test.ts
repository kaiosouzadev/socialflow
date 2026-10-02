/**
 * S33: leitura de .docx no navegador (lib/docx-text.ts), sem dependência nova.
 * Os ZIPs são montados aqui mesmo (CompressionStream "deflate-raw" do Node),
 * com as variações que o leitor precisa aguentar: stored/deflate, data
 * descriptor, nomes UTF-8, ZIP64, entrada criptografada, arquivo truncado.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DOCX_ERROR_MESSAGE,
  DOCX_MAX_BYTES,
  DocxReadError,
  checkDocxFile,
  crc32,
  documentXmlToText,
  docxToText,
  listZipEntries,
  readDocxFile,
  refMonthFromFileName,
  type DocxErrorCode,
} from "../../src/lib/docx-text.ts";
import { parseMonthlyDoc, stripCredentials } from "../../src/lib/doc-import.ts";

const FIXTURE = readFileSync(new URL("../fixtures/doc-mensal-sintetico.txt", import.meta.url), "utf8").replace(
  /\r\n?/g,
  "\n"
);
const PASSWORD = "SENHA-FALSA-123";
const enc = new TextEncoder();

// ------------------------------------------------------------ montagem de ZIP para os testes

async function deflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
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

function le(bytes: number, value: number): Uint8Array {
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  if (bytes === 2) view.setUint16(0, value, true);
  else view.setUint32(0, value >>> 0, true);
  return out;
}

type Entry = {
  name: string;
  data: string | Uint8Array<ArrayBuffer>;
  method?: number; // 0 stored, 8 deflate (padrão), outro = método não suportado
  utf8?: boolean;
  descriptor?: boolean; // bit 3: tamanhos e CRC só depois dos dados
  encrypted?: boolean;
  corruptCrc?: boolean;
};

async function makeZip(entries: Entry[], opts: { zip64?: boolean } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    const method = e.method ?? 8;
    const body = method === 8 ? await deflateRaw(raw) : raw;
    const crc = e.corruptCrc ? (crc32(raw) ^ 1) >>> 0 : crc32(raw);
    const name = enc.encode(e.name);
    const flags = (e.utf8 ? 0x800 : 0) | (e.descriptor ? 0x8 : 0) | (e.encrypted ? 0x1 : 0);
    const local = concat([
      le(4, 0x04034b50), le(2, 20), le(2, flags), le(2, method), le(2, 0), le(2, 0),
      le(4, e.descriptor ? 0 : crc), le(4, e.descriptor ? 0 : body.byteLength), le(4, e.descriptor ? 0 : raw.byteLength),
      le(2, name.byteLength), le(2, 0), name, body,
      ...(e.descriptor ? [le(4, 0x08074b50), le(4, crc), le(4, body.byteLength), le(4, raw.byteLength)] : []),
    ]);
    centrals.push(
      concat([
        le(4, 0x02014b50), le(2, 20), le(2, 20), le(2, flags), le(2, method), le(2, 0), le(2, 0),
        le(4, crc), le(4, body.byteLength), le(4, raw.byteLength),
        le(2, name.byteLength), le(2, 0), le(2, 0), le(2, 0), le(2, 0), le(4, 0), le(4, offset), name,
      ])
    );
    locals.push(local);
    offset += local.byteLength;
  }
  const cd = concat(centrals);
  const eocd = concat([
    le(4, 0x06054b50), le(2, 0), le(2, 0),
    le(2, opts.zip64 ? 0xffff : entries.length), le(2, opts.zip64 ? 0xffff : entries.length),
    le(4, opts.zip64 ? 0xffffffff : cd.byteLength), le(4, opts.zip64 ? 0xffffffff : offset), le(2, 0),
  ]);
  return concat([...locals, cd, eocd]);
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Um parágrafo por linha; rótulos em negrito num run separado (como no Word). */
function documentXml(lines: string[]): string {
  const paragraphs = lines.map((line) => {
    if (!line) return "<w:p/>";
    const m = /^([^:]{2,40}::?)(.*)$/.exec(line);
    const runs = m
      ? `<w:r><w:rPr><w:b/></w:rPr><w:t>${xmlEscape(m[1])}</w:t></w:r><w:r><w:t xml:space="preserve">${xmlEscape(m[2])}</w:t></w:r>`
      : `<w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r>`;
    return `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>${runs}</w:p>`;
  });
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paragraphs.join("") +
    "<w:sectPr/></w:body></w:document>"
  );
}

const CONTENT_TYPES = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';

async function docxOf(xml: string, entry: Partial<Entry> = {}): Promise<Uint8Array<ArrayBuffer>> {
  return makeZip([
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "word/document.xml", data: xml, ...entry },
  ]);
}

async function rejectsWith(p: Promise<unknown>, code: DocxErrorCode) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof DocxReadError, `esperava DocxReadError, veio ${String(e)}`);
    assert.equal(e.code, code);
    assert.equal(e.message, DOCX_ERROR_MESSAGE[code]);
    return true;
  });
}

// ------------------------------------------------------------ testes

describe("checkDocxFile — extensão e 10 MB antes de ler", () => {
  test("só .docx (sem diferenciar caixa)", () => {
    assert.equal(checkDocxFile({ name: "Cliente_09 - 2026.docx", size: 1000 }), null);
    assert.equal(checkDocxFile({ name: "CLIENTE.DOCX", size: 1000 }), null);
    assert.equal(checkDocxFile({ name: "cliente.doc", size: 1000 }), "not_docx");
    assert.equal(checkDocxFile({ name: "cliente.pdf", size: 1000 }), "not_docx");
    assert.equal(checkDocxFile({ name: "cliente.docx.zip", size: 1000 }), "not_docx");
  });

  test("limite de 10 MB", () => {
    assert.equal(checkDocxFile({ name: "a.docx", size: DOCX_MAX_BYTES }), null);
    assert.equal(checkDocxFile({ name: "a.docx", size: DOCX_MAX_BYTES + 1 }), "too_large");
  });

  test("mensagens em pt-BR", () => {
    assert.equal(DOCX_ERROR_MESSAGE.not_docx, "Esse arquivo não é um .docx.");
    assert.equal(DOCX_ERROR_MESSAGE.too_large, "O arquivo passa de 10 MB.");
    assert.equal(DOCX_ERROR_MESSAGE.corrupt, "Não foi possível ler o arquivo. Ele pode estar corrompido.");
  });
});

describe("refMonthFromFileName — padrão <Cliente>_<MM> - <AAAA>.docx", () => {
  test("detecta o mês e devolve o trecho do nome", () => {
    assert.deepEqual(refMonthFromFileName("Cliente Exemplo_09 - 2026.docx"), { refMonth: "2026-09", label: "_09 - 2026" });
    assert.deepEqual(refMonthFromFileName("Cliente_9-2026.docx"), { refMonth: "2026-09", label: "_09 - 2026" });
    assert.deepEqual(refMonthFromFileName("Cliente_10 - 2026 (1).docx"), { refMonth: "2026-10", label: "_10 - 2026" });
    assert.deepEqual(refMonthFromFileName("Clínica_A_12 – 2026.docx"), { refMonth: "2026-12", label: "_12 - 2026" });
  });

  test("vale a última ocorrência; mês inválido ou ausente → null", () => {
    assert.equal(refMonthFromFileName("Velho_01 - 2025_10 - 2026.docx")?.refMonth, "2026-10");
    assert.equal(refMonthFromFileName("Cliente_13 - 2026.docx"), null);
    assert.equal(refMonthFromFileName("Cliente_00 - 2026.docx"), null);
    assert.equal(refMonthFromFileName("Cliente setembro.docx"), null);
    assert.equal(refMonthFromFileName("Cliente_09 - 20261.docx"), null);
  });
});

describe("crc32", () => {
  test("vetor conhecido", () => {
    assert.equal(crc32(enc.encode("123456789")), 0xcbf43926);
    assert.equal(crc32(new Uint8Array(0)), 0);
  });
});

describe("documentXmlToText — WordprocessingML → texto", () => {
  const W = (body: string) =>
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

  test("um parágrafo por linha; parágrafo vazio vira linha vazia; runs são concatenados", () => {
    const xml = W(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>01 - TÍTULO:</w:t></w:r><w:r><w:t xml:space="preserve"> Dia (07/09)</w:t></w:r></w:p>' +
        "<w:p/><w:p><w:pPr/></w:p><w:p><w:r><w:t>APROVADO</w:t></w:r></w:p>"
    );
    assert.equal(documentXmlToText(xml), "01 - TÍTULO: Dia (07/09)\n\n\nAPROVADO");
  });

  test("w:tab no run vira tab; w:tab das paradas de tabulação (pPr) é ignorado", () => {
    const xml = W(
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r></w:p>'
    );
    assert.equal(documentXmlToText(xml), "A\tB");
  });

  test("w:br e w:cr viram quebra de linha", () => {
    const xml = W("<w:p><w:r><w:t>Agende sua avaliação.</w:t><w:br/><w:t>📱 (00) 0000-0000</w:t><w:cr/><w:t>.</w:t></w:r></w:p>");
    assert.equal(documentXmlToText(xml), "Agende sua avaliação.\n📱 (00) 0000-0000\n.");
  });

  test("entidades XML (nomeadas, decimais e hexadecimais)", () => {
    const xml = W("<w:p><w:r><w:t>P&amp;G &lt;b&gt; &quot;x&quot; &apos;y&apos; caf&#233; a&#xE7;&#xE3;o &#x1F4F1;</w:t></w:r></w:p>");
    assert.equal(documentXmlToText(xml), "P&G <b> \"x\" 'y' café ação 📱");
  });

  test("ignora texto excluído, código de campo, mc:Fallback, comentários e atributos com '>'", () => {
    const xml = W(
      "<!-- comentário <w:t>não</w:t> -->" +
        '<w:p><w:r><w:t>Antes</w:t></w:r><w:del w:id="1"><w:r><w:delText>APAGADO</w:delText></w:r></w:del>' +
        '<w:r><w:instrText xml:space="preserve"> HYPERLINK "https://x.test" </w:instrText></w:r>' +
        '<w:r><w:t xml:space="preserve"> depois</w:t></w:r></w:p>' +
        '<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:t>caixa</w:t></mc:Choice>' +
        "<mc:Fallback><w:t>caixa</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>" +
        '<w:p w14:paraId="a>b"><w:r><w:t>atributo</w:t></w:r></w:p>'
    );
    assert.equal(documentXmlToText(xml), "Antes depois\ncaixa\natributo");
  });

  test("parágrafo dentro de parágrafo (caixa de texto) não quebra o texto de fora", () => {
    const xml = W(
      "<w:p><w:r><w:t>fora 1 </w:t></w:r><w:r><w:txbxContent><w:p><w:r><w:t>dentro</w:t></w:r></w:p></w:txbxContent></w:r>" +
        "<w:r><w:t>fora 2</w:t></w:r></w:p>"
    );
    assert.equal(documentXmlToText(xml), "dentro\nfora 1 fora 2");
  });
});

describe("docxToText — ZIP do .docx", () => {
  const xml = documentXml(["Linha 1", "", "Linha 3: valor"]);
  const expected = "Linha 1\n\nLinha 3: valor";

  test("deflate (método 8)", async () => {
    assert.equal(await docxToText(await docxOf(xml)), expected);
  });

  test("stored (método 0)", async () => {
    assert.equal(await docxToText(await docxOf(xml, { method: 0 })), expected);
  });

  test("com data descriptor (tamanhos e CRC depois dos dados)", async () => {
    const zip = await makeZip([
      { name: "[Content_Types].xml", data: CONTENT_TYPES, descriptor: true },
      { name: "word/document.xml", data: xml, descriptor: true },
    ]);
    assert.equal(await docxToText(zip), expected);
  });

  test("nomes UTF-8 (flag 11) nas outras entradas", async () => {
    const zip = await makeZip([
      { name: "word/mídia/ação ✓.png", data: new Uint8Array([1, 2, 3]), utf8: true, method: 0 },
      { name: "word/document.xml", data: xml, utf8: true },
    ]);
    assert.deepEqual(
      listZipEntries(zip).map((e) => e.name),
      ["word/mídia/ação ✓.png", "word/document.xml"]
    );
    assert.equal(await docxToText(zip), expected);
  });

  test("aceita ArrayBuffer e Uint8Array com deslocamento", async () => {
    const zip = await docxOf(xml);
    assert.equal(await docxToText(zip.buffer), expected);
    const padded = concat([new Uint8Array([9, 9, 9]), zip]);
    assert.equal(await docxToText(padded.subarray(3)), expected);
  });

  test("não é ZIP → not_docx; contêiner OLE (.doc ou protegido por senha) → protected", async () => {
    await rejectsWith(docxToText(enc.encode("isto não é um zip, é texto puro")), "not_docx");
    await rejectsWith(docxToText(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])), "protected");
  });

  test("ZIP sem word/document.xml → not_docx", async () => {
    await rejectsWith(docxToText(await makeZip([{ name: "planilha.html", data: "<html/>" }])), "not_docx");
  });

  test("ZIP64 → unsupported; entrada criptografada → protected; método desconhecido → unsupported", async () => {
    await rejectsWith(docxToText(await makeZip([{ name: "word/document.xml", data: xml }], { zip64: true })), "unsupported");
    await rejectsWith(docxToText(await docxOf(xml, { encrypted: true })), "protected");
    await rejectsWith(docxToText(await docxOf(xml, { method: 12, data: xml })), "unsupported");
  });

  test("arquivo truncado, deflate inválido ou CRC errado → corrupt", async () => {
    const zip = await docxOf(xml);
    await rejectsWith(docxToText(zip.slice(0, Math.floor(zip.byteLength / 2))), "corrupt");

    const broken = zip.slice();
    const entry = listZipEntries(broken).find((e) => e.name === "word/document.xml");
    assert.ok(entry);
    const start = entry.localHeaderOffset + 30 + "word/document.xml".length;
    for (let i = start; i < start + entry.compressedSize; i++) broken[i] = 0xff; // lixo no lugar do deflate
    await rejectsWith(docxToText(broken), "corrupt");

    await rejectsWith(docxToText(await docxOf(xml, { corruptCrc: true })), "corrupt");
  });

  test("documento sem texto → empty", async () => {
    await rejectsWith(docxToText(await docxOf(documentXml(["", "", ""]))), "empty");
  });
});

describe("readDocxFile — arquivo escolhido no navegador", () => {
  test("extensão e tamanho são checados sem ler os bytes", async () => {
    const neverRead = (name: string, size: number) => ({
      name,
      size,
      arrayBuffer: async (): Promise<ArrayBuffer> => {
        throw new Error("não devia ler o arquivo");
      },
    });
    await rejectsWith(readDocxFile(neverRead("doc.pdf", 10)), "not_docx");
    await rejectsWith(readDocxFile(neverRead("grande.docx", DOCX_MAX_BYTES + 1)), "too_large");
  });

  test("falha ao ler o arquivo → corrupt", async () => {
    await rejectsWith(
      readDocxFile({ name: "a.docx", size: 10, arrayBuffer: () => Promise.reject(new Error("NotReadableError")) }),
      "corrupt"
    );
  });

  test("fixture sintética em .docx → mesmo texto → 12 posts + 1 avulso + 1 stand-by; a senha some no stripCredentials", async () => {
    const lines = FIXTURE.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    const file = new File([await docxOf(documentXml(lines), { descriptor: true })], "Cliente Exemplo_09 - 2026.docx");
    const text = await readDocxFile(file);
    assert.equal(text, lines.join("\n"));

    assert.ok(text.includes(PASSWORD), "a fixture tem a senha falsa");
    const stripped = stripCredentials(text);
    assert.equal(stripped.credentialDetected, true);
    assert.ok(!stripped.text.includes(PASSWORD));
    assert.equal(stripped.text.split("\n").length, lines.length, "as linhas ficam no lugar (avisos com o número certo)");

    const doc = parseMonthlyDoc(stripped.text, { refMonth: refMonthFromFileName(file.name)?.refMonth ?? "" });
    assert.equal(doc.posts.length, 12);
    assert.equal(doc.avulsos.length, 1);
    assert.equal(doc.standBy.length, 1);
    assert.ok(!JSON.stringify(doc).includes(PASSWORD));
  });
});
