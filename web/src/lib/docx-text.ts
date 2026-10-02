/**
 * Texto de um .docx lido NO NAVEGADOR (S33, importador do documento mensal).
 *
 * O .docx nunca é enviado ao servidor (R12/A13): este módulo abre o ZIP em
 * memória, localiza `word/document.xml` pelo diretório central, descompacta
 * com `DecompressionStream("deflate-raw")` (sem dependência nova) e converte o
 * XML em texto, um parágrafo (`w:p`) por linha — a entrada que
 * `lib/doc-import` espera. Puro: sem Buffer/zlib, sem alias "@/"; roda no
 * navegador e no Node ≥ 18 (testes com node:test).
 *
 * ZIP aceito: entradas "stored" (método 0) e "deflate" (8), com ou sem data
 * descriptor (os tamanhos vêm do diretório central), nomes em UTF-8.
 * Recusados com mensagem amigável: ZIP64, entrada criptografada, outros
 * métodos e arquivos do Office protegidos por senha (contêiner OLE).
 */

/** Limite do arquivo escolhido (S33). */
export const DOCX_MAX_BYTES = 10 * 1024 * 1024;

/** Teto do `word/document.xml` descompactado: barra "zip bomb". */
export const DOCUMENT_XML_MAX_BYTES = 64 * 1024 * 1024;

export type DocxErrorCode =
  | "not_docx"
  | "too_large"
  | "corrupt"
  | "protected"
  | "unsupported"
  | "empty"
  | "no_support";

/** Mensagens em pt-BR, do lado do usuário (DESIGN g.2, etapa 1). */
export const DOCX_ERROR_MESSAGE: Record<DocxErrorCode, string> = {
  not_docx: "Esse arquivo não é um .docx.",
  too_large: "O arquivo passa de 10 MB.",
  corrupt: "Não foi possível ler o arquivo. Ele pode estar corrompido.",
  protected:
    "Esse arquivo está protegido por senha ou é um .doc antigo. No Word, salve uma cópia .docx sem senha, ou cole o texto.",
  unsupported:
    "Não conseguimos ler este .docx aqui. No Word, use “Salvar como” .docx e tente de novo, ou cole o texto.",
  empty: "Não encontramos texto neste documento.",
  no_support: "Este navegador não consegue ler .docx. Atualize o navegador ou cole o texto do documento.",
};

export class DocxReadError extends Error {
  readonly code: DocxErrorCode;
  constructor(code: DocxErrorCode) {
    super(DOCX_ERROR_MESSAGE[code]);
    this.name = "DocxReadError";
    this.code = code;
  }
}

// ------------------------------------------------------------ nome e tamanho do arquivo

/** Extensão e tamanho, antes de ler os bytes. null = ok. */
export function checkDocxFile(file: { name: string; size: number }): DocxErrorCode | null {
  if (!/\.docx$/i.test(file.name.trim())) return "not_docx";
  if (file.size > DOCX_MAX_BYTES) return "too_large";
  return null;
}

/**
 * Mês de referência pelo nome do arquivo, no padrão `<Cliente>_<MM> - <AAAA>.docx`
 * [RD §1.2]. Ex.: "Cliente_09 - 2026.docx" → { refMonth: "2026-09", label: "_09 - 2026" }.
 * Vale a última ocorrência; mês fora de 01–12 → null.
 */
export function refMonthFromFileName(name: string): { refMonth: string; label: string } | null {
  const base = name.trim().replace(/\.docx$/i, "");
  const all = [...base.matchAll(/_\s*(\d{1,2})\s*[-–—]\s*(\d{4})(?!\d)/g)];
  const m = all[all.length - 1];
  if (!m) return null;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return null;
  const mm = String(month).padStart(2, "0");
  return { refMonth: `${m[2]}-${mm}`, label: `_${mm} - ${m[2]}` };
}

// ------------------------------------------------------------ ZIP

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const EOCD_MIN = 22;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;

/** "PK\x03\x04": início de um ZIP com ao menos uma entrada. */
export function hasZipSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Contêiner OLE: .doc antigo ou arquivo do Office protegido por senha. */
export function hasOleSignature(bytes: Uint8Array): boolean {
  return bytes.length >= OLE_SIGNATURE.length && OLE_SIGNATURE.every((b, i) => bytes[i] === b);
}

export type ZipEntry = {
  name: string;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
};

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder("utf-8").decode(bytes);
  // sem a flag UTF-8: CP437; para nomes ASCII (os do .docx) é o mesmo byte
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/** Entradas do diretório central (sem descompactar nada). */
export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.byteLength;
  if (len < EOCD_MIN) throw new DocxReadError("corrupt");

  // fim do diretório central: procurado de trás para a frente (o comentário tem até 64 KB)
  let eocd = -1;
  for (let i = len - EOCD_MIN; i >= Math.max(0, len - EOCD_MIN - U16_MAX); i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new DocxReadError("corrupt");

  const disk = view.getUint16(eocd + 4, true);
  const cdDisk = view.getUint16(eocd + 6, true);
  const total = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const zip64 =
    total === U16_MAX ||
    cdSize === U32_MAX ||
    cdOffset === U32_MAX ||
    (eocd >= 20 && view.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR);
  if (zip64 || disk !== 0 || cdDisk !== 0) throw new DocxReadError("unsupported");
  if (cdOffset + cdSize > eocd) throw new DocxReadError("corrupt");

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > eocd || view.getUint32(p, true) !== SIG_CENTRAL) throw new DocxReadError("corrupt");
    const flags = view.getUint16(p + 8, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    if (p + 46 + nameLen > eocd) throw new DocxReadError("corrupt");
    entries.push({
      name: decodeName(bytes.subarray(p + 46, p + 46 + nameLen), (flags & FLAG_UTF8) !== 0),
      method: view.getUint16(p + 10, true),
      flags,
      crc32: view.getUint32(p + 16, true),
      compressedSize: view.getUint32(p + 20, true),
      size: view.getUint32(p + 24, true),
      localHeaderOffset: view.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

let crcTable: Uint32Array | null = null;

/** CRC-32 (IEEE), o mesmo do ZIP. */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = U32_MAX;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ U32_MAX) >>> 0;
}

/** Descompacta "deflate" puro; o resultado tem de ter exatamente `size` bytes. */
async function inflateRaw(data: Uint8Array<ArrayBuffer>, size: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new DocxReadError("no_support");
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const writing = writer.write(data).then(() => writer.close());
  writing.catch(() => {}); // a falha é lida pelo reader abaixo
  const out = new Uint8Array(size);
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > size) {
        await reader.cancel().catch(() => {});
        throw new DocxReadError("corrupt");
      }
      out.set(value, offset);
      offset += value.byteLength;
    }
    await writing;
  } catch (e) {
    if (e instanceof DocxReadError) throw e;
    throw new DocxReadError("corrupt"); // deflate inválido ou truncado
  }
  if (offset !== size) throw new DocxReadError("corrupt");
  return out;
}

/** Bytes de uma entrada do ZIP, ou null se ela não existir. */
export async function readZipEntry(bytes: Uint8Array, name: string): Promise<Uint8Array | null> {
  const entry = listZipEntries(bytes).find((e) => e.name === name);
  if (!entry) return null;
  if (entry.flags & FLAG_ENCRYPTED) throw new DocxReadError("protected");
  if (
    entry.compressedSize === U32_MAX ||
    entry.size === U32_MAX ||
    entry.localHeaderOffset === U32_MAX ||
    entry.size > DOCUMENT_XML_MAX_BYTES
  ) {
    throw new DocxReadError("unsupported");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.localHeaderOffset;
  if (at + 30 > bytes.byteLength || view.getUint32(at, true) !== SIG_LOCAL) throw new DocxReadError("corrupt");
  // nome e extra do cabeçalho LOCAL podem diferir dos do diretório central
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.byteLength) throw new DocxReadError("corrupt");
  const raw = bytes.slice(start, end);

  let data: Uint8Array;
  if (entry.method === 0) {
    if (raw.byteLength !== entry.size) throw new DocxReadError("corrupt");
    data = raw;
  } else if (entry.method === 8) {
    data = await inflateRaw(raw, entry.size);
  } else {
    throw new DocxReadError("unsupported");
  }
  if (crc32(data) !== entry.crc32) throw new DocxReadError("corrupt");
  return data;
}

// ------------------------------------------------------------ WordprocessingML → texto

const ENTITY: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, ref: string) => {
    if (ref[0] !== "#") return ENTITY[ref];
    const code = ref[1] === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
  });
}

/** Elementos cujo conteúdo não é texto do documento. */
const SKIP = new Set([
  "w:delText", // texto excluído (controle de alterações)
  "w:instrText", // código de campo (ex.: HYPERLINK "…")
  "mc:Fallback", // cópia alternativa de caixas de texto (duplicaria o texto)
]);

/**
 * `word/document.xml` → texto: um parágrafo por linha; `w:tab` → tab;
 * `w:br`/`w:cr` → quebra de linha; entidades XML decodificadas. Ignora texto
 * excluído, códigos de campo e o conteúdo de `mc:Fallback`.
 */
export function documentXmlToText(xml: string): string {
  const lines: string[] = [];
  const outer: string[] = []; // parágrafo dentro de parágrafo (caixa de texto)
  let cur = "";
  let inParagraph = 0;
  let inRun = 0;
  let inText = 0;
  let skip = 0;

  const re =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([^\s/>]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const [, cdata, closing, tag, , selfClosing, text] = m;
    if (text !== undefined || cdata !== undefined) {
      if (inText > 0 && skip === 0) cur += cdata ?? decodeEntities(text);
      continue;
    }
    if (!tag) continue; // comentário ou instrução de processamento

    if (SKIP.has(tag)) {
      if (!selfClosing) skip += closing ? -1 : 1;
      if (skip < 0) skip = 0;
      continue;
    }
    if (skip > 0) continue;

    switch (tag) {
      case "w:p":
        if (selfClosing) lines.push("");
        else if (!closing) {
          if (inParagraph > 0) outer.push(cur);
          cur = "";
          inParagraph++;
        } else if (inParagraph > 0) {
          lines.push(cur);
          inParagraph--;
          cur = inParagraph > 0 ? (outer.pop() ?? "") : "";
        }
        break;
      case "w:r":
        if (!selfClosing) inRun = Math.max(0, inRun + (closing ? -1 : 1));
        break;
      case "w:t":
        if (!selfClosing) inText = Math.max(0, inText + (closing ? -1 : 1));
        break;
      case "w:tab":
        if (inRun > 0 && !closing) cur += "\t"; // fora de run, w:tab é parada de tabulação (w:tabs)
        break;
      case "w:br":
      case "w:cr":
        if (inRun > 0 && !closing) cur += "\n";
        break;
      case "w:noBreakHyphen":
        if (inRun > 0 && !closing) cur += "-";
        break;
    }
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}

function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return new TextDecoder("utf-8").decode(bytes); // tira o BOM UTF-8, se houver
}

// ------------------------------------------------------------ entrada principal

/** Bytes de um .docx → texto (um parágrafo por linha). Lança `DocxReadError`. */
export async function docxToText(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (hasOleSignature(bytes)) throw new DocxReadError("protected");
  if (!hasZipSignature(bytes)) throw new DocxReadError("not_docx");
  let text: string;
  try {
    const xml = await readZipEntry(bytes, "word/document.xml");
    if (!xml) throw new DocxReadError("not_docx"); // ZIP, mas não é documento do Word
    text = documentXmlToText(decodeXml(xml));
  } catch (e) {
    // qualquer outra falha (ex.: leitura fora dos limites) = arquivo corrompido
    throw e instanceof DocxReadError ? e : new DocxReadError("corrupt");
  }
  if (!text.trim()) throw new DocxReadError("empty");
  return text;
}

/** Arquivo escolhido pelo usuário → texto: extensão, 10 MB, assinatura e leitura. */
export async function readDocxFile(file: {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}): Promise<string> {
  const invalid = checkDocxFile(file);
  if (invalid) throw new DocxReadError(invalid);
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new DocxReadError("corrupt");
  }
  return docxToText(buffer);
}
