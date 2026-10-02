/**
 * Parser do documento mensal da redação (puro: só texto → estrutura).
 *
 * Entrada: o texto do .docx, um parágrafo por linha. Gramática de um bloco:
 *
 *   PAMELA                                  ← redatora (vale para os blocos seguintes)
 *   NN - TIPO[: título] (dd/mm)             ← TÍTULO | CARROSSEL | REELS | REELS - Gravação | BANNER ANIMADO
 *   POST AVULSO[ - TIPO][: título] (dd/mm)  ← post fora da grade (vira post comum com nota)
 *   STAND BY[ - TIPO][: título] (/)         ← sem data (vira pendência)
 *   *Postar 20h                             ← horário do post (senão, o padrão do formato)
 *   CAMINHO: …  /  NÃO FAZER CAPA           ← nota interna
 *   APROVADO | AGUARDANDO APROVAÇÃO | AGUARDANDO FOTOS
 *   ARTE n: …  /  TELA n: …                 ← slides
 *   LEGENDA:                                ← legenda até o próximo bloco
 *
 * Antes dos posts: a linha do plano (com "|"), o briefing ("Rótulo:: valor")
 * e o bloco de hashtags. "Molde de posts" é ignorado até o STAND BY.
 * "ENCERRAR GESTÃO" marca o fim do contrato.
 *
 * Credenciais ("Acesso ao Instagram", "senha"…) são descartadas por
 * `stripCredentials` — também aplicada aqui dentro, por defesa em profundidade.
 */
import type { PostFormat } from "./formats.ts";

export type DocStatus = "aprovado" | "aguardando_aprovacao" | "aguardando_fotos";

/** "documento" = veio de "*Postar HHh"; "padrao" = horário padrão do formato. */
export type TimeSource = "documento" | "padrao";

export type ParsedPost = {
  /** linha do cabeçalho do bloco (1 = primeira linha do texto) */
  line: number;
  seq: number | null;
  /** "AAAA-MM-DD" (mês civil resolvido pelo refMonth); null = sem data válida / stand-by */
  date: string | null;
  /** "HH:mm" no fuso SP */
  time: string;
  timeSource: TimeSource;
  format: PostFormat;
  /** tipo como escrito no documento, ex.: "BANNER ANIMADO", "POST AVULSO - CARROSSEL" */
  kindLabel: string;
  title: string;
  slides: { text: string }[];
  caption: string;
  docStatus: DocStatus | null;
  writerName: string | null;
  internalNote: string | null;
  avulso: boolean;
};

export type BriefingClientField = "tradeName" | "facebookUrl" | "instagramUrl" | "website" | "city" | "phone";

export type BriefingKey =
  | "partnerships"
  | "products"
  | "themes"
  | "hashtags"
  | "observations"
  | "restrictions"
  | "audience"
  | "competitors"
  | "differential"
  | "references"
  | "anniversary"
  | "linkedinUrl"
  | "linkedinRepost"
  | "positioning";

export type ParsedBriefing = {
  /** campos do Client */
  client: Partial<Record<BriefingClientField, string>>;
  /** chaves de Client.briefing */
  briefing: Partial<Record<BriefingKey, string>>;
  /** e-mail do documento: só SUGESTÃO, nunca gravado automaticamente */
  emailSuggestion: string | null;
  /** pares "Rótulo:: valor" sem campo correspondente */
  unmapped: { line: number; label: string; value: string }[];
};

export type DocWarning = { line: number; message: string };

export type ParsedMonthlyDoc = {
  refMonth: string;
  /** linha do plano contratado */
  header: string | null;
  briefing: ParsedBriefing;
  /** bloco fixo de hashtags do cliente */
  hashtagsBlock: string | null;
  posts: ParsedPost[];
  /** POST AVULSO: post comum com a nota "Post avulso" */
  avulsos: ParsedPost[];
  /** STAND BY: sem data (date = null) */
  standBy: ParsedPost[];
  /** "ENCERRAR GESTÃO" presente */
  endOfContract: boolean;
  /** havia credencial no texto (foi descartada) */
  credentialDetected: boolean;
  /** blocos da seção "Molde de posts" ignorados */
  ignoredTemplates: number;
  warnings: DocWarning[];
};

export type ParseOptions = {
  /** "AAAA-MM": mês de referência do documento (resolve dd/mm e a virada de ano) */
  refMonth: string;
  /** nomes aceitos como redatora mesmo fora de MAIÚSCULAS (ex.: primeiros nomes dos usuários) */
  writerNames?: readonly string[];
  /** horário padrão por formato (A12) */
  defaultTimes?: Partial<Record<PostFormat, string>>;
};

export const DEFAULT_WRITER_NAMES: readonly string[] = ["PAMELA", "STELLA"];

/** A12: 09:00 para feed e carrossel, 20:00 para reels. */
export const DEFAULT_TIMES: Readonly<Record<PostFormat, string>> = {
  feed: "09:00",
  story: "09:00",
  carrossel: "09:00",
  reels: "20:00",
};

// ------------------------------------------------------------ utilidades

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** MAIÚSCULAS, sem acento, espaços colapsados. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Chave para casar redatora com usuário: primeiro nome, minúsculas, sem acento. */
export function firstNameKey(name: string): string {
  return norm(name).split(" ")[0]?.toLowerCase() ?? "";
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function isHashtagLine(t: string): boolean {
  const tokens = t.trim().split(/\s+/).filter(Boolean);
  return tokens.length >= 2 && tokens.every((x) => x.startsWith("#"));
}

/** "Rótulo: valor" / "Rótulo:: valor" (não confunde com URL). */
function isLabelLike(t: string): boolean {
  return /^[^:]{2,60}:{1,2}(\s|$)/.test(t) && !/^https?:/i.test(t);
}

// ------------------------------------------------------------ cabeçalho de bloco

type HeaderKind = "post" | "avulso" | "stand_by";

type ParsedHeader = {
  kind: HeaderKind;
  seq: number | null;
  format: PostFormat;
  kindLabel: string;
  kindNote: string | null;
  title: string;
  dateRaw: string | null;
};

const BASE_KINDS: readonly { re: RegExp; format: PostFormat; label: string; note: string | null }[] = [
  { re: /^banner\s+animado/i, format: "feed", label: "BANNER ANIMADO", note: "Banner animado" },
  { re: /^reels\s*[-–—]\s*grava[cçCÇ][aãAÃ]o/i, format: "reels", label: "REELS - Gravação", note: "Reels - Gravação" },
  { re: /^reels/i, format: "reels", label: "REELS", note: null },
  { re: /^carrossel/i, format: "carrossel", label: "CARROSSEL", note: null },
  { re: /^t[iíIÍ]tulo/i, format: "feed", label: "TÍTULO", note: null },
];

const WRAPPERS: readonly { re: RegExp; kind: HeaderKind; label: string }[] = [
  { re: /^post\s+avulso/i, kind: "avulso", label: "POST AVULSO" },
  { re: /^stand[\s-]*by/i, kind: "stand_by", label: "STAND BY" },
];

const SEP = /^[\s:\-–—]+/;

/** Casa o prefixo só em fronteira de palavra; devolve o resto ou null. */
function matchPrefix(re: RegExp, s: string): string | null {
  const m = re.exec(s);
  if (!m) return null;
  const next = s.charAt(m[0].length);
  return next === "" || /[\s:\-–—]/.test(next) ? s.slice(m[0].length) : null;
}

/**
 * Cabeçalho de bloco reconhecido, "unknown" (parece cabeçalho — "NN - X (dd/mm)" —
 * mas o tipo é desconhecido) ou null (linha comum).
 */
function parseHeaderLine(raw: string): ParsedHeader | "unknown" | null {
  let rest = raw.trim();
  if (!rest) return null;

  let seq: number | null = null;
  const seqM = /^(\d{1,3})\s*[-–—]\s*/.exec(rest);
  if (seqM) {
    seq = Number(seqM[1]);
    rest = rest.slice(seqM[0].length);
  }

  let dateRaw: string | null = null;
  const dm = /\s*\(([^()]*)\)\s*$/.exec(rest);
  if (dm) {
    dateRaw = dm[1].trim();
    rest = rest.slice(0, dm.index);
  }
  // "(dd/mm)", "(d/m)", "(/)" ou "()"
  const dateLike = dateRaw !== null && /^\d{0,2}\s*\/?\s*\d{0,2}$/.test(dateRaw) && !/^\d+$/.test(dateRaw);

  let kind: HeaderKind = "post";
  let wrapperLabel = "";
  for (const w of WRAPPERS) {
    const r = matchPrefix(w.re, rest);
    // "POST AVULSO"/"STAND BY" valem com data entre parênteses ou em MAIÚSCULAS
    // (texto de legenda como "Stand by me… (1986)" não abre bloco)
    const written = r === null ? "" : rest.slice(0, rest.length - r.length);
    if (r !== null && (dateLike || written === written.toUpperCase())) {
      kind = w.kind;
      wrapperLabel = w.label;
      rest = r.replace(SEP, "");
      break;
    }
  }

  let base: (typeof BASE_KINDS)[number] | null = null;
  for (const b of BASE_KINDS) {
    const r = matchPrefix(b.re, rest);
    if (r !== null) {
      base = b;
      rest = r;
      break;
    }
  }

  if (kind === "post") {
    // post da grade exige "NN - " e a data entre parênteses (evita confundir texto de legenda)
    if (seq === null || dateRaw === null) return null;
    if (!base) return dateLike ? "unknown" : null;
  }

  const kindLabel = [wrapperLabel, base?.label ?? ""].filter(Boolean).join(" - ");
  return {
    kind,
    seq,
    format: base?.format ?? "feed",
    kindLabel,
    kindNote: base?.note ?? null,
    title: rest.replace(SEP, "").trim(),
    dateRaw,
  };
}

/** dd/mm → "AAAA-MM-DD" no ano mais próximo do refMonth (virada de ano). */
function resolveDate(dateRaw: string | null, refYear: number, refMonth: number): string | null {
  const m = dateRaw ? /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(dateRaw) : null;
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || day < 1) return null;
  const ref = refYear * 12 + refMonth;
  // empate (±6 meses) fica no ano do refMonth
  const year = [refYear - 1, refYear + 1].reduce(
    (best, y) => (Math.abs(y * 12 + month - ref) < Math.abs(best * 12 + month - ref) ? y : best),
    refYear
  );
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// ------------------------------------------------------------ linhas dentro do bloco

function statusOf(t: string): DocStatus | null {
  const n = norm(t).replace(/^\*+\s*/, "").replace(/[.:!]+$/, "").trim();
  if (n === "APROVADO" || n === "APROVADA") return "aprovado";
  if (/^AGUARDANDO APROVACAO\b/.test(n)) return "aguardando_aprovacao";
  if (/^AGUARDANDO\b.*\b(FOTOS?|VIDEOS?|MATERIAL|MATERIAIS)\b/.test(n)) return "aguardando_fotos";
  return null;
}

const STATUS_RANK: Record<DocStatus, number> = { aguardando_fotos: 3, aguardando_aprovacao: 2, aprovado: 1 };

/** "*Postar 20h" / "*Postar às 20h30" / "*Postar 9:15" → "HH:mm"; "invalid" se fora do relógio. */
function postTimeOf(t: string, requireStar: boolean): string | "invalid" | null {
  const n = norm(t).toLowerCase();
  const m = /^(\*?)\s*postar\s+(?:as\s+)?(\d{1,2})\s*(?:h|:)\s*(\d{2})?/.exec(n);
  if (!m || (requireStar && m[1] !== "*")) return null;
  const hh = Number(m[2]);
  const mm = m[3] ? Number(m[3]) : 0;
  if (hh > 23 || mm > 59) return "invalid";
  return `${pad2(hh)}:${pad2(mm)}`;
}

function isInternalNoteLine(t: string): boolean {
  return /^caminho\s*:/i.test(t) || norm(t).startsWith("NAO FAZER CAPA");
}

function slideOf(t: string): { text: string } | null {
  const m = /^(arte|tela)\s*(\d{1,2})\s*(?:[:.)\-–—]\s*(.*))?$/i.exec(t);
  return m ? { text: (m[3] ?? "").trim() } : null;
}

function legendaOf(t: string): string | null {
  const m = /^legenda\s*(?::\s*(.*))?$/i.exec(t);
  return m ? (m[1] ?? "").trim() : null;
}

const isMoldeLine = (t: string) => /^MOLDES? DE POSTS?\b/.test(norm(t));
const isEndOfContract = (t: string) => norm(t).includes("ENCERRAR GESTAO");

// ------------------------------------------------------------ credenciais

const CREDENTIAL_LABEL = /senha|password|acesso ao|login/i;
const CREDENTIAL_HEAD = /^(acesso ao|senha|password|login)\b/i;
const CREDENTIAL_ANYWHERE = /\b(senha|password)\b\s*:{1,2}|^\s*acesso ao (instagram|insta|facebook|face)\b/i;

function labelOf(t: string): string | null {
  const dbl = t.indexOf("::");
  if (dbl > 0) return t.slice(0, dbl);
  const m = /^([^:]{1,60}):/.exec(t);
  return m ? m[1] : null;
}

/**
 * Remove credenciais do texto ANTES de qualquer envio ou gravação:
 * - na seção de briefing (antes do 1º post): linhas cujo rótulo casa
 *   /senha|password|acesso ao|login/ — e as linhas de valor logo abaixo,
 *   até a próxima linha em branco ou o próximo rótulo;
 * - no resto do texto: linhas "senha: …", "password: …", "Acesso ao Instagram…".
 * As linhas removidas viram linhas vazias (a numeração das linhas não muda).
 */
export function stripCredentials(text: string): { text: string; credentialDetected: boolean } {
  const lines = splitLines(text);
  const firstPost = lines.findIndex((l) => {
    const h = parseHeaderLine(l);
    return h !== null && h !== "unknown";
  });
  const briefingEnd = firstPost === -1 ? lines.length : firstPost;
  let detected = false;
  let continuing = false;

  const drop = (i: number) => {
    if (lines[i].trim()) detected = true;
    lines[i] = "";
  };

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (i < briefingEnd) {
      if (continuing) {
        if (!t || t.includes("::") || isLabelLike(t) || isHashtagLine(t)) {
          continuing = false;
        } else {
          drop(i);
          continue;
        }
      }
      const label = labelOf(t);
      if ((label !== null && CREDENTIAL_LABEL.test(label)) || CREDENTIAL_HEAD.test(t)) {
        drop(i);
        continuing = true;
        continue;
      }
    }
    if (CREDENTIAL_ANYWHERE.test(t)) drop(i);
  }
  return { text: lines.join("\n"), credentialDetected: detected };
}

// ------------------------------------------------------------ briefing

type BriefingTarget =
  | { to: "client"; key: BriefingClientField }
  | { to: "briefing"; key: BriefingKey }
  | { to: "email" };

/** Rótulo do docx (normalizado) → campo. A ordem importa. */
const BRIEFING_DICTIONARY: readonly { test: RegExp; target: BriefingTarget }[] = [
  { test: /nome da empresa|nome fantasia/, target: { to: "client", key: "tradeName" } },
  { test: /pagina do face|facebook/, target: { to: "client", key: "facebookUrl" } },
  { test: /pagina do insta|instagram/, target: { to: "client", key: "instagramUrl" } },
  { test: /\bsite\b|website/, target: { to: "client", key: "website" } },
  { test: /cidade/, target: { to: "client", key: "city" } },
  { test: /telefone|whats/, target: { to: "client", key: "phone" } },
  { test: /e-?mail/, target: { to: "email" } },
  { test: /aniversario/, target: { to: "briefing", key: "anniversary" } },
  { test: /parceria|convenio/, target: { to: "briefing", key: "partnerships" } },
  { test: /posicionamento/, target: { to: "briefing", key: "positioning" } },
  { test: /repostar/, target: { to: "briefing", key: "linkedinRepost" } },
  { test: /company page|linkedin/, target: { to: "briefing", key: "linkedinUrl" } },
  { test: /publico/, target: { to: "briefing", key: "audience" } },
  { test: /temas/, target: { to: "briefing", key: "themes" } },
  { test: /servicos|produtos/, target: { to: "briefing", key: "products" } },
  { test: /hashtag/, target: { to: "briefing", key: "hashtags" } },
  { test: /concorrente/, target: { to: "briefing", key: "competitors" } },
  { test: /diferencia/, target: { to: "briefing", key: "differential" } },
  { test: /referencia/, target: { to: "briefing", key: "references" } },
  { test: /observac/, target: { to: "briefing", key: "observations" } },
  { test: /restric/, target: { to: "briefing", key: "restrictions" } },
];

/** Respostas que significam "não há". */
const EMPTY_ANSWER = /^(nao tenho|nao tem|nao possui|n\/a|-+|—)$/;

function buildBriefing(pairs: { line: number; label: string; value: string }[]): ParsedBriefing {
  const out: ParsedBriefing = { client: {}, briefing: {}, emailSuggestion: null, unmapped: [] };
  for (const p of pairs) {
    const value = p.value.trim();
    if (!value || EMPTY_ANSWER.test(norm(value).toLowerCase())) continue;
    const label = norm(p.label).toLowerCase();
    if (CREDENTIAL_LABEL.test(label)) continue;
    const entry = BRIEFING_DICTIONARY.find((d) => d.test.test(label));
    if (!entry) {
      out.unmapped.push({ line: p.line, label: p.label.trim(), value });
      continue;
    }
    const t = entry.target;
    if (t.to === "email") {
      if (out.emailSuggestion === null) out.emailSuggestion = value.split(/[\s,;]+/)[0].toLowerCase();
      continue;
    }
    let v = value;
    if (t.to === "client" && (t.key === "facebookUrl" || t.key === "instagramUrl")) {
      v = /https?:\/\/[^\s|]+/.exec(value)?.[0] ?? value;
    }
    const bucket: Record<string, string> = t.to === "client" ? out.client : out.briefing;
    if (bucket[t.key] === undefined) bucket[t.key] = v;
    else out.unmapped.push({ line: p.line, label: p.label.trim(), value });
  }
  return out;
}

// ------------------------------------------------------------ parser

type Builder = {
  header: ParsedHeader;
  line: number;
  writer: string | null;
  statuses: Set<DocStatus>;
  time: string | null;
  notes: string[];
  slides: { text: string }[];
  caption: string[];
  sub: "head" | "slide" | "caption";
};

/**
 * Lê o documento mensal. Nada é gravado: o resultado alimenta a prévia
 * (S18/S33). Credenciais são descartadas antes de qualquer leitura.
 */
export function parseMonthlyDoc(text: string, opts: ParseOptions): ParsedMonthlyDoc {
  const ref = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(opts.refMonth);
  if (!ref) throw new Error("refMonth inválido (esperado AAAA-MM)");
  const refYear = Number(ref[1]);
  const refMonthNum = Number(ref[2]);
  const times: Record<PostFormat, string> = { ...DEFAULT_TIMES, ...opts.defaultTimes };
  const knownWriters = new Set((opts.writerNames ?? DEFAULT_WRITER_NAMES).map((n) => norm(n)));

  const stripped = stripCredentials(text);
  const lines = splitLines(stripped.text);

  // próxima linha não vazia (para reconhecer a redatora antes de um cabeçalho)
  const nextNonEmpty: number[] = new Array(lines.length).fill(-1);
  for (let i = lines.length - 2; i >= 0; i--) {
    nextNonEmpty[i] = lines[i + 1].trim() ? i + 1 : nextNonEmpty[i + 1];
  }
  const headers = lines.map((l) => parseHeaderLine(l));

  const result: ParsedMonthlyDoc = {
    refMonth: opts.refMonth,
    header: null,
    briefing: { client: {}, briefing: {}, emailSuggestion: null, unmapped: [] },
    hashtagsBlock: null,
    posts: [],
    avulsos: [],
    standBy: [],
    endOfContract: false,
    credentialDetected: stripped.credentialDetected,
    ignoredTemplates: 0,
    warnings: [],
  };
  const warn = (line: number, message: string) => result.warnings.push({ line, message });

  const pairs: { line: number; label: string; value: string }[] = [];
  let lastPair: (typeof pairs)[number] | null = null;
  let seenPreambleContent = false;

  let inPosts = false;
  let inMolde = false;
  let skipping = false;
  let writer: string | null = null;
  let cur: Builder | null = null;

  const isWriterLine = (i: number, t: string): boolean => {
    const next = nextNonEmpty[i];
    const h = next >= 0 ? headers[next] : null;
    if (h === null || h === "unknown") return false;
    if (statusOf(t) !== null) return false;
    if (knownWriters.has(norm(t))) return true;
    return /^[A-ZÀ-Ý]{2,20}(?: [A-ZÀ-Ý]{2,20})?$/.test(t);
  };

  const finish = () => {
    if (!cur) return;
    const b = cur;
    cur = null;
    const h = b.header;
    let docStatus: DocStatus | null = null;
    for (const s of b.statuses) if (!docStatus || STATUS_RANK[s] > STATUS_RANK[docStatus]) docStatus = s;
    const notes = [h.kind === "avulso" ? "Post avulso" : null, h.kindNote, ...b.notes].filter(
      (n): n is string => !!n
    );
    const date = h.kind === "stand_by" ? null : resolveDate(h.dateRaw, refYear, refMonthNum);
    if (h.kind !== "stand_by" && date === null) {
      warn(b.line, `Post sem data válida (dd/mm): "${lines[b.line - 1].trim()}"`);
    }
    const post: ParsedPost = {
      line: b.line,
      seq: h.seq,
      date,
      time: b.time ?? times[h.format],
      timeSource: b.time ? "documento" : "padrao",
      format: h.format,
      kindLabel: h.kindLabel,
      title: h.title,
      slides: b.slides.map((s) => ({ text: s.text.trim() })).filter((s) => s.text !== ""),
      caption: b.caption.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
      docStatus,
      writerName: b.writer,
      internalNote: notes.length ? notes.join("\n") : null,
      avulso: h.kind === "avulso",
    };
    if (h.kind === "stand_by") result.standBy.push(post);
    else if (h.kind === "avulso") result.avulsos.push(post);
    else result.posts.push(post);
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const t = lines[i].trim();
    const h = headers[i];

    if (inMolde) {
      if (isEndOfContract(t)) {
        result.endOfContract = true;
      } else if (h !== null && h !== "unknown" && h.kind === "stand_by") {
        inMolde = false;
        cur = { header: h, line: lineNo, writer, statuses: new Set(), time: null, notes: [], slides: [], caption: [], sub: "head" };
      } else if (h !== null) {
        result.ignoredTemplates += 1;
      }
      continue;
    }

    if (isEndOfContract(t)) {
      finish();
      result.endOfContract = true;
      inPosts = true;
      skipping = false;
      continue;
    }
    if (isMoldeLine(t)) {
      finish();
      inMolde = true;
      inPosts = true;
      skipping = false;
      continue;
    }
    if (h === "unknown") {
      finish();
      warn(lineNo, `Bloco não reconhecido: "${t}"`);
      inPosts = true;
      skipping = true;
      continue;
    }
    if (h !== null) {
      finish();
      inPosts = true;
      skipping = false;
      cur = { header: h, line: lineNo, writer, statuses: new Set(), time: null, notes: [], slides: [], caption: [], sub: "head" };
      continue;
    }
    if (t && isWriterLine(i, t)) {
      finish();
      inPosts = true;
      skipping = false;
      writer = t;
      continue;
    }

    // ---- antes dos posts: plano, briefing e hashtags
    if (!inPosts) {
      if (!t) {
        lastPair = null;
        continue;
      }
      if (!seenPreambleContent && t.includes("|") && !t.includes("::")) {
        result.header = t;
        seenPreambleContent = true;
        continue;
      }
      seenPreambleContent = true;
      const pair = /^(.+?)::\s*(.*)$/.exec(t);
      if (pair) {
        lastPair = { line: lineNo, label: pair[1], value: pair[2] };
        pairs.push(lastPair);
        continue;
      }
      if (lastPair && !isLabelLike(t) && !isHashtagLine(t)) {
        lastPair.value = lastPair.value ? `${lastPair.value}\n${t}` : t;
        continue;
      }
      lastPair = null;
      if (isHashtagLine(t) && result.hashtagsBlock === null) result.hashtagsBlock = t;
      continue;
    }

    // ---- seção de posts
    if (skipping) continue;
    if (!cur) {
      if (t) warn(lineNo, `Linha fora de um bloco de post: "${t}"`);
      continue;
    }
    const b: Builder = cur;
    if (!t) {
      if (b.sub === "caption") b.caption.push("");
      continue;
    }
    const status = statusOf(t);
    if (status) {
      b.statuses.add(status);
      continue;
    }
    const time = postTimeOf(t, b.sub === "caption");
    if (time === "invalid") {
      warn(lineNo, `Horário inválido: "${t}"`);
      continue;
    }
    if (time) {
      b.time = time;
      continue;
    }
    if (isInternalNoteLine(t)) {
      b.notes.push(t);
      continue;
    }
    if (b.sub !== "caption") {
      const slide = slideOf(t);
      if (slide) {
        b.slides.push(slide);
        b.sub = "slide";
        continue;
      }
      const leg = legendaOf(t);
      if (leg !== null) {
        b.sub = "caption";
        if (leg) b.caption.push(leg);
        continue;
      }
    }
    if (b.sub === "caption") b.caption.push(t);
    else if (b.sub === "slide") {
      const last = b.slides[b.slides.length - 1];
      last.text = last.text ? `${last.text}\n${t}` : t;
    } else b.notes.push(t);
  }
  finish();

  result.briefing = buildBriefing(pairs);
  result.warnings.sort((a, b) => a.line - b.line);
  return result;
}
