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
 * Antes dos posts: a linha do plano ("GESTÃO …", com ou sem "|"), o briefing
 * ("Rótulo:: valor" ou, se o documento não usa "::", "Rótulo: valor"), o bloco
 * de hashtags e notas soltas (parágrafos sem rótulo). "Molde de posts" é
 * ignorado até o STAND BY. "ENCERRAR GESTÃO" marca o fim do contrato.
 * Bloco sem "LEGENDA:" e sem telas: o texto depois do cabeçalho é a legenda.
 *
 * Credenciais ("Acesso ao Instagram", "Login:", "Senha:"…) saem do texto por
 * `extractCredentials` (também aplicada aqui dentro, por defesa em
 * profundidade): o parser nunca as vê e o resultado dele nunca as contém.
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

export type BriefingClientField =
  | "tradeName"
  | "facebookUrl"
  | "instagramUrl"
  | "website"
  | "city"
  | "phone"
  | "whatsapp"
  | "toneOfVoice";

/** As 18 chaves de Client.briefing (as mesmas do ClientBriefingEditor). */
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
  | "positioning"
  | "plan"
  | "designNotes"
  | "mandatoryArtText"
  | "responsibleTech";

export type ParsedBriefing = {
  /** campos do Client */
  client: Partial<Record<BriefingClientField, string>>;
  /** chaves de Client.briefing */
  briefing: Partial<Record<BriefingKey, string>>;
  /** e-mail do documento: só SUGESTÃO, nunca gravado automaticamente */
  emailSuggestion: string | null;
  /**
   * pares "Rótulo:: valor" sem campo correspondente. `credential`: rótulo de
   * acesso ("Senha:", "Login:") cujo valor não pareceu credencial — o valor fica
   * vazio (nunca sai do parser) e a prévia só aponta a linha.
   */
  unmapped: { line: number; label: string; value: string; credential?: true }[];
  /** de onde veio cada campo (1º rótulo) */
  sources: Partial<Record<BriefingClientField | BriefingKey, { line: number; label: string }>>;
};

export type DocWarning = { line: number; message: string };

export type ParsedMonthlyDoc = {
  refMonth: string;
  /** linha do plano contratado */
  header: string | null;
  briefing: ParsedBriefing;
  /** num documento com "Rótulo:: valor", os pares "Rótulo: valor" (completam o `briefing`) */
  looseBriefing: ParsedBriefing;
  /** bloco fixo de hashtags do cliente */
  hashtagsBlock: string | null;
  /** linha de hashtags que se repete no fim das legendas (≥ 2 posts e ≥ metade das legendas com hashtags) */
  captionHashtags: string | null;
  /** parágrafos soltos antes dos posts (sem rótulo nem campo): notas para a equipe */
  notes: { line: number; text: string }[];
  posts: ParsedPost[];
  /** POST AVULSO: post comum com a nota "Post avulso" */
  avulsos: ParsedPost[];
  /** STAND BY: sem data (date = null) */
  standBy: ParsedPost[];
  /** "ENCERRAR GESTÃO" presente */
  endOfContract: boolean;
  /** havia credencial no texto (saiu do texto antes da leitura; ver `extractCredentials`) */
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

/** "Rótulo: valor" / "Rótulo:: valor" (não confunde com URL). Rótulos do briefing chegam a ~70 letras. */
function isLabelLike(t: string): boolean {
  return /^[^:]{2,120}:{1,2}(\s|$)/.test(t) && !/^https?:/i.test(t);
}

/** "-----", "_____", "=====": só separa seções. */
function isSeparatorLine(t: string): boolean {
  return /^[\s\-_=*~.•·–—]{3,}$/.test(t) && /[\-_=*~–—]{3,}/.test(t.replace(/\s+/g, ""));
}

/** Texto só com letras MAIÚSCULAS (ao menos 3 letras). */
function isUpperText(t: string): boolean {
  const letters = t.replace(/[^\p{L}]/gu, "");
  return letters.length >= 3 && letters === letters.toUpperCase();
}

/** Linha do plano contratado: "GESTÃO …", com "|" ou toda em MAIÚSCULAS. */
function isPlanHeaderLine(t: string): boolean {
  if (t.includes("|") && !t.includes("::")) return true;
  if (/^GEST[AÃ]O\b/i.test(t)) return true;
  const letters = t.replace(/[^\p{L}]/gu, "");
  return letters.length >= 12 && letters === letters.toUpperCase() && t.trim().split(/\s+/).length >= 4;
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

const SEP = /^[\s:|\-–—]+/;

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
  // "BANNER ANIMADO | TÍTULO: …": o 2º tipo, depois de "|", é só rótulo (vale o 1º)
  const pipe = base ? /^\s*\|\s*/.exec(rest) : null;
  if (pipe) {
    const after = rest.slice(pipe[0].length);
    for (const b of BASE_KINDS) {
      const r = matchPrefix(b.re, after);
      if (r !== null) {
        rest = r;
        break;
      }
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

/**
 * Credencial lida do documento. Só existe no servidor, entre a leitura e a
 * gravação cifrada (Client.credentialsEnc): nunca vai para a prévia, para o
 * resultado do parser nem para o log.
 */
export type DocCredential = {
  /** rede ("Instagram", "Facebook"…), o assunto do rótulo ("Painel") ou "Geral" */
  network: string;
  login: string;
  password: string;
  /** 1ª linha do bloco no texto */
  line: number;
  /** veio do briefing (antes do 1º post); a de fora (ex.: numa legenda) a prévia não marca */
  inBriefing: boolean;
};

/** Rede citada num rótulo/linha → nome canônico. Testado sobre o texto normalizado (minúsculo, sem acento). */
const NETWORKS: readonly { re: RegExp; name: string }[] = [
  { re: /\b(instagram|insta|ig)\b/, name: "Instagram" },
  { re: /\b(facebook|face|fb|fanpage|meta business|business suite|gerenciador de negocios)\b/, name: "Facebook" },
  { re: /\blinked ?in\b/, name: "LinkedIn" },
  { re: /\btik ?tok\b/, name: "TikTok" },
  { re: /\byou ?tube\b/, name: "YouTube" },
  { re: /\bpinterest\b/, name: "Pinterest" },
  { re: /\btwitter\b/, name: "Twitter" },
  { re: /\b(google|gmail|meu negocio)\b/, name: "Google" },
  { re: /\b(site|wordpress|wix|hospedagem|dominio)\b/, name: "Site" },
  { re: /\be-?mail\b/, name: "E-mail" },
];

const lowerNorm = (s: string) => norm(s).toLowerCase();

/** "Acesso ao Insta" → "Instagram"; null se nenhuma rede conhecida for citada. */
export function canonicalNetwork(text: string, opts: { allowEmail?: boolean } = {}): string | null {
  const l = lowerNorm(text);
  for (const n of NETWORKS) {
    if (n.name === "E-mail" && opts.allowEmail === false) continue;
    if (n.re.test(l)) return n.name;
  }
  return null;
}

/** Chave para casar a mesma rede escrita de jeitos diferentes ("insta", "Instagram "). */
export function networkKey(network: string): string {
  return (canonicalNetwork(network) ?? lowerNorm(network)).toLowerCase();
}

/** Palavras que não mudam as redes de um rótulo ("Acesso ao Instagram e Facebook (mesma conta)"). */
const NETWORK_FILLER = /\b(mesm[ao]s?|ambos|ambas|contas?|perfis|perfil|paginas?|comerciais|comercial|oficial)\b/g;

/**
 * Redes citadas num texto normalizado (minúsculo, sem acento). Duas ou mais
 * só valem juntas quando o texto é só a lista delas ("instagram e facebook");
 * senão vale a 1ª rede conhecida, como em `canonicalNetwork`. [] = nenhuma.
 */
function networksIn(subject: string, allowEmail: boolean): string[] {
  const found: { name: string; at: number }[] = [];
  let rest = subject;
  for (const n of NETWORKS) {
    if (n.name === "E-mail" && !allowEmail) continue;
    const re = new RegExp(n.re.source, "g");
    const m = re.exec(subject);
    if (!m) continue;
    found.push({ name: n.name, at: m.index });
    rest = rest.replace(re, " ");
  }
  if (found.length === 0) return [];
  const onlyNetworks = !rest
    .replace(NETWORK_FILLER, " ")
    .replace(/\b(e|ou|ao|a|as|aos|do|da|de|dos|das|no|na|o)\b/g, " ")
    .replace(/[():\-–—/|*.,;&+]+/g, " ")
    .trim();
  if (found.length > 1 && onlyNetworks) return found.sort((a, b) => a.at - b.at).map((f) => f.name);
  return [found[0].name];
}

type CredKind = "password" | "login" | "block";

/** Rótulos que, no briefing, nunca viram campo (são credenciais). */
const CREDENTIAL_LABEL = /senha|password|acesso ao|login/i;
/** Fora do briefing, só estas linhas são credencial (não pega "acesso ao nosso site" de legenda). */
const CREDENTIAL_ANYWHERE =
  /\b(senha|password)\b\s*:{1,2}|^\s*acesso ao (instagram|insta|facebook|face)\b|^\s*login\s*:{1,2}\s*\S/i;
/** Linha sem ":" que começa por palavra de credencial ("Senha abc", "Acesso ao Instagram"). */
const CREDENTIAL_HEAD = /^(acesso\s+(?:ao|à|a|do|da)\s+\S+|senha|password|login|usu[aá]rio)(?=[\s:\-–—]|$)[\s:\-–—]*(.*)$/i;

function labelOf(t: string): string | null {
  const dbl = t.indexOf("::");
  if (dbl > 0) return t.slice(0, dbl);
  const m = /^([^:]{1,120}):/.exec(t);
  return m ? m[1] : null;
}

/** O que vem depois de "Rótulo:" / "Rótulo::". */
const valueAfter = (t: string, label: string) => t.slice(label.length).replace(/^:{1,2}/, "").trim();

function credentialKindOf(label: string): CredKind | null {
  const l = lowerNorm(label);
  if (/\b(senhas?|password|passw|pass)\b/.test(l)) return "password";
  if (/^(login|usuario|user|username)\b|\blogin\b|\be-?mail (de|para) (acesso|login|entrar)\b/.test(l)) return "login";
  if (/\bacesso (ao|a|as|aos|do|da|de|no|na)\b|\bdados de acesso\b|^acessos?\b|^credenciais?\b/.test(l)) return "block";
  return null;
}

/**
 * Redes do próprio rótulo: "Senha do Facebook" → [Facebook]; "Acesso ao
 * Instagram e Facebook" → as duas; "Senha do Mlabs" → [Mlabs]; [] = não diz.
 */
function networksOfLabel(label: string, kind: CredKind): string[] {
  const subject = lowerNorm(label)
    .replace(/\be-?mail (de|para) (acesso|login|entrar)\b/g, " ")
    .replace(/\b(senhas?|password|passw|pass|login|usuarios?|user|username|acessos?|dados|credenciais?|referente)\b/g, " ")
    .replace(/\b(ao|a|as|aos|do|da|de|dos|das|no|na|para|e|o)\b/g, " ")
    .replace(/[():\-–—/|*.,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!subject) return [];
  const known = networksIn(subject, kind !== "login");
  if (known.length) return known;
  // assunto livre só quando o rótulo começa pela palavra de credencial ("Senha do Mlabs")
  const startsWithCredential = /^(senhas?|password|login|usuario|user|acessos?|dados de acesso|credenciais?)\b/.test(lowerNorm(label));
  if (kind === "login" || !startsWithCredential || subject.length > 40 || !/\p{L}/u.test(subject)) return [];
  return [subject.charAt(0).toUpperCase() + subject.slice(1)];
}

/**
 * "@loja / 123", "login: x senha: y", "x | senha y" → partes; {} se não der para separar.
 * "senha" só separa quando é palavra solta seguida de ":" ou espaço ("SENHA-123" é a própria senha).
 */
function splitLoginPassword(v: string): { login?: string; password?: string } {
  const inline =
    /^(?:(?:login|usu[aá]rio|user|e-?mail)\s*:{0,2}\s*)?(.*?)(?:^|\s*[/|,;]\s*|\s+)(?:senha|password)(?:\s*:{1,2}\s*|\s+)(\S.*)$/i.exec(v);
  if (inline) return { login: inline[1].trim() || undefined, password: inline[2].trim() };
  const parts = v.split(/\s+[/|]\s+/);
  if (parts.length === 2 && parts[0].trim() && parts[1].trim()) return { login: parts[0].trim(), password: parts[1].trim() };
  return {};
}

/**
 * Palavra ou símbolo de preenchimento ("Pendente", "N/A", "Não", "-", "a definir",
 * "pedir_para_cliente"…): nunca é login nem senha. Comparado sem maiúsculas nem
 * acentos e sem a pontuação das pontas ("pendente." = "pendente").
 */
const PLACEHOLDER_WORDS = [
  "x+", "[nsx]", "ok", "okay", "sim", "nao", "yes", "no", "na", "n/?a", "n\\.a", "n/d", "nd", "s/n",
  "tbd", "tba", "todo", "pending", "none", "null", "nil", "nenhum", "nenhuma", "nada", "sem", "vazio", "vazia",
  "branco", "em branco", "pendente", "pendentes", "pendencia", "pendencias", "aguardando", "aguarda", "aguardar",
  "depois", "em breve", "mesma", "mesmo", "igual", "idem", "senha", "login", "usuario", "password", "e-?mail",
  "(?:a )?(?:definir|confirmar|combinar|enviar|solicitar|pedir|verificar|perguntar|consultar)",
  "solicitad[ao]", "pedid[ao]", "enviad[ao]", "ver",
];
const PLACEHOLDER = new RegExp(`^(?:${PLACEHOLDER_WORDS.join("|")})$`);

/** ...ou que começa por uma palavra de pendência ("aguardando cliente", "ver com a cliente", "sem senha"). */
const PLACEHOLDER_HEAD =
  /^(?:pendente|pendencia|aguardando|aguardar|a definir|a confirmar|a combinar|a enviar|definir|confirmar|combinar|solicitar|pedir|perguntar|consultar|verificar|ver com|sem|nenhum|nenhuma|nao tem|nao possui|nao sei|com a cliente|com o cliente)(?: |$)/;

function isPlaceholder(raw: string): boolean {
  const n = lowerNorm(raw.replace(/_+/g, " "))
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
  if (!n) return true; // só pontuação/símbolos: "-", "—", "***", "?"
  if (PLACEHOLDER.test(n)) return true;
  const words = n.replace(/[-./]+/g, " ").replace(/\s+/g, " ");
  return PLACEHOLDER.test(words) || PLACEHOLDER_HEAD.test(words);
}

/** "12/10", "12/10/2026", "2026-10-12", "12.10.26". */
function isDateLike(v: string): boolean {
  return /^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?$/.test(v) || /^\d{4}[/.-]\d{1,2}[/.-]\d{1,2}$/.test(v);
}

/**
 * Formato de "token": sem espaços, até 64 caracteres, com letra ou número, que
 * não é endereço de site, hashtag nem termina como frase. Frase ("Atendimento de
 * segunda a sexta…", "pedir para a cliente") nunca vira credencial.
 */
function looksLikeSecret(v: string): boolean {
  return (
    v.length > 0 &&
    v.length <= 64 &&
    !/\s/.test(v) &&
    /[\p{L}\p{N}]/u.test(v) &&
    !v.startsWith("#") &&
    !/^(https?:\/\/|www\.)/i.test(v) &&
    !/[:.,;?…]$/.test(v)
  );
}

/**
 * Senha escrita no documento ("SENHA-123" ou "SENHA-123 (trocar em março)" →
 * "SENHA-123"); null se não parecer senha: frase, palavra de preenchimento
 * ("Pendente", "N/A", "-"), data, hashtag ou menos de 4 caracteres.
 */
function passwordOf(raw: string): string | null {
  const v = raw.trim().replace(/\s+\([^()]*\)$/, "");
  return looksLikeSecret(v) && v.length >= 4 && !isPlaceholder(v) && !isDateLike(v) ? v : null;
}

/**
 * Senha escrita na LINHA DE BAIXO de um rótulo (debaixo de "Senha:" vazia, com
 * ou sem linha em branco, ou na linha da senha do bloco "Acesso ao X::"): além
 * de `passwordOf`, precisa ter dígito ou símbolo no meio ("Loja#2025",
 * "senha123", "Ab1!xyz") e não pode ser nome de rede nem de redatora. Palavra
 * só de letras nessa posição ("OBSERVAÇÕES", "*Importante*", "Instagram",
 * "Obrigada", "PAMELA") é título ou texto, não senha. Na MESMA linha do rótulo
 * ("Senha: Flamengo") vale `passwordOf`.
 */
function passwordBelowOf(raw: string): string | null {
  const v = passwordOf(raw);
  if (!v) return null;
  const core = v.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!core || !/\p{N}|[^\p{L}\p{N}]/u.test(core)) return null;
  if (canonicalNetwork(core) !== null) return null;
  if (DEFAULT_WRITER_NAMES.some((n) => norm(n) === norm(core))) return null;
  return v;
}

/** Domínio do link do perfil de cada rede (o link só vale como login da própria rede). */
const NETWORK_DOMAINS: Readonly<Record<string, RegExp>> = {
  Instagram: /(^|\.)(instagram\.com|instagr\.am)$/,
  Facebook: /(^|\.)(facebook\.com|fb\.com|fb\.me|fb\.watch)$/,
  LinkedIn: /(^|\.)linkedin\.com$/,
  TikTok: /(^|\.)tiktok\.com$/,
  YouTube: /(^|\.)(youtube\.com|youtu\.be)$/,
  Pinterest: /(^|\.)pinterest\.[a-z.]+$/,
  Twitter: /(^|\.)(twitter\.com|x\.com)$/,
  Google: /(^|\.)(google\.[a-z.]+|g\.page)$/,
};

function isNetworkUrl(v: string, networks: readonly string[]): boolean {
  if (!/^https?:\/\/\S{4,200}$/i.test(v)) return false;
  try {
    const host = new URL(v).hostname.toLowerCase();
    return networks.some((n) => NETWORK_DOMAINS[n]?.test(host) ?? false);
  } catch {
    return false;
  }
}

/**
 * "@perfil", e-mail, usuário ou telefone ("(00) 90000-0000"); null se não
 * parecer login (frase, preenchimento, data, hashtag). `urlNetworks`: debaixo de
 * "Acesso ao Instagram::", o link do perfil DA PRÓPRIA REDE vale como login.
 */
function loginOf(raw: string, urlNetworks: readonly string[] = []): string | null {
  const v = raw.trim().replace(/\s+\([^()]*\)$/, "");
  if (!v || isPlaceholder(v) || isDateLike(v)) return null;
  if (/^\+?[\d\s().-]{8,24}$/.test(v) && (v.match(/\d/g) ?? []).length >= 8) return v;
  if (/^https?:\/\//i.test(v)) return isNetworkUrl(v, urlNetworks) ? v : null;
  return looksLikeSecret(v) && v.length >= 2 ? v : null;
}

/** `rejectedPassword`: havia uma senha escrita, mas ela não pareceu senha (nunca vai para o texto em claro). */
type CredentialRead = { login?: string; password?: string; rejectedPassword?: boolean };

/**
 * Login/senha escritos na MESMA linha do rótulo. Depois de "Senha:", o valor
 * inteiro é a senha; nos outros rótulos, "x / y" e "login: x senha: y" separam
 * as partes. `pairOnly` (linha sem ":" como "Acesso ao Instagram …", ou fora do
 * briefing): só vale com login e senha juntos. {} = não parece credencial.
 */
function readInline(kind: CredKind, value: string, pairOnly: boolean): CredentialRead {
  const v = value.trim();
  if (!v) return {};
  if (kind === "password") {
    const password = passwordOf(v);
    return password ? { password } : { rejectedPassword: true };
  }
  const split = splitLoginPassword(v);
  if (split.password !== undefined) {
    const password = passwordOf(split.password);
    const login = split.login !== undefined ? loginOf(split.login) : null;
    if (split.login !== undefined && !login) return { rejectedPassword: true };
    if (!password) return login ? { login, rejectedPassword: true } : { rejectedPassword: true };
    return login ? { login, password } : { password };
  }
  if (pairOnly) return {};
  const login = loginOf(v);
  return login ? { login } : {};
}

/** Rótulo sozinho no briefing ("Acesso ao Instagram::", "Login:", "Senha:"): o que ainda pode vir nas linhas de baixo. */
type CredentialSlot = {
  creds: DocCredential[];
  want: ("login" | "password")[];
  /** rótulo dono das linhas de baixo (aparece em "não importado" se a senha for recusada) */
  label: string;
  networks: string[];
  /** "Senha:" vazia: pode haver UMA linha em branco antes da senha */
  passwordLabel: boolean;
  skippedBlank: boolean;
};

/**
 * Linha de valor debaixo de um rótulo sozinho:
 * - `read`: login e/ou senha (senha só pela regra da linha de baixo, `passwordBelowOf`);
 * - `withhold`: estava no lugar da senha (direto ou depois de uma linha em
 *   branco) e não pareceu senha (frase, palavra só de letras, "Pendente",
 *   data…): sai do texto e só aparece, oculta, em "não importado" — senha nunca
 *   vai em claro para o briefing e a senha atual não muda. Pode vir junto com
 *   `read` ("@perfil / Flamengo": o login vale, a senha fica oculta);
 * - `close`: a linha fica no texto e o bloco fecha (frase depois do login);
 * - {}: a linha fica no texto e o bloco continua (link de outro site; "Pendente"
 *   no lugar do login passa a vez para a senha).
 */
function slotStep(slot: CredentialSlot, t: string): { read?: CredentialRead; withhold?: true; close?: true } {
  const field = slot.want[0];
  if (field === "login") {
    // "@: perfil" (modelo do formulário) é o login "@perfil"
    const handle = /^@\s*:{1,2}\s*@?(\S+)$/.exec(t);
    if (handle && !isPlaceholder(handle[1])) {
      slot.want = slot.want.slice(1);
      return { read: { login: `@${handle[1]}` } };
    }
    if (slot.want.length === 2) {
      // "@perfil / SENHA" na linha de baixo do bloco: a parte da senha segue a regra da linha de baixo;
      // se alguma parte for recusada ("@perfil / Flamengo", "minha senha 19"), a linha inteira fica oculta
      const split = splitLoginPassword(t);
      if (split.password !== undefined) {
        const login = split.login !== undefined ? loginOf(split.login, slot.networks) : null;
        const password = passwordBelowOf(split.password);
        slot.want = [];
        return password && (split.login === undefined || login) ? { read: { ...(login ? { login } : {}), password } } : { withhold: true };
      }
    }
    const login = loginOf(t, slot.networks);
    if (login) {
      slot.want = slot.want.slice(1);
      return { read: { login } };
    }
    if (/^https?:\/\//i.test(t)) return {};
    if (isPlaceholder(t) || isDateLike(t)) {
      slot.want = slot.want.slice(1);
      return slot.want.length ? {} : { close: true };
    }
    return { close: true };
  }
  if (field === "password") {
    const password = passwordBelowOf(t);
    if (password) {
      slot.want = slot.want.slice(1);
      return { read: { password } };
    }
    // no lugar da senha (direto ou depois de uma linha em branco) e não é senha: oculta
    return { withhold: true };
  }
  return { close: true };
}

/** "Instagram: login: x senha: y" → a rede do 1º rótulo e o rótulo de credencial de dentro. */
function prefixedCredential(
  t: string,
  label: string
): { networks: string[]; kind: CredKind; label: string; value: string } | null {
  if (credentialKindOf(label) || label.trim().split(/\s+/).length > 4) return null;
  const networks = networksIn(lowerNorm(label), false);
  if (!networks.length) return null;
  const rest = valueAfter(t, label);
  const inner = labelOf(rest);
  const kind = inner !== null ? credentialKindOf(inner) : null;
  if (inner === null || !kind || kind === "block") return null;
  return { networks, kind, label: inner, value: valueAfter(rest, inner) };
}

/** Linha retida: estava no lugar de uma senha e não pareceu senha. Só o rótulo e a linha, nunca o valor. */
export type WithheldCredentialLine = { line: number; label: string };

/**
 * Tira as credenciais do texto ANTES de qualquer leitura ou gravação e as
 * devolve por rede. Só sai do texto o que é credencial; o resto fica:
 * - login/senha na mesma linha do rótulo ("Login: x", "Senha do Facebook: y",
 *   "Acesso ao Instagram:: x / y", "Instagram: login: x senha: y");
 * - no briefing (antes do 1º post), rótulo sozinho ("Acesso ao Instagram::",
 *   "Login:", "Senha:") com os valores nas linhas de baixo: login e depois senha
 *   no bloco, só o login debaixo de "Login:", só a senha debaixo de "Senha:"
 *   (aqui, uma linha em branco antes da senha é tolerada);
 * - o valor só é aceito se PARECER credencial: um "token" sem espaços (ou
 *   telefone no login) que não é frase, palavra de preenchimento ("Pendente",
 *   "N/A", "-"), data nem hashtag; senha com 4+ caracteres; link só o da
 *   própria rede no login. Senha na LINHA DE BAIXO precisa também de dígito ou
 *   símbolo e não pode ser nome de rede/redatora (`passwordBelowOf`). Depois de
 *   "Rótulo: valor" na mesma linha, a linha de baixo nunca é lida como credencial;
 * - o que estava no LUGAR DA SENHA (valor de "Senha:", a linha de baixo — mesmo
 *   depois de uma linha em branco — ou a linha da senha no bloco) e foi
 *   recusado sai do texto e volta em `withheld` (rótulo e linha,
 *   sem o valor): a prévia lista como "não importado", oculto. Nunca vai em
 *   claro para Observações; a senha atual do cliente não é tocada;
 * - o resto que foi recusado (frase depois do login, linha depois do bloco)
 *   fica no texto e vai para o briefing;
 * - um rótulo vazio que cita uma rede ("Referente ao Instagram:") vale como rede
 *   das linhas "Login:"/"Senha:" seguintes (e sai do texto junto);
 * - "Acesso ao Instagram e Facebook::" grava as duas redes;
 * - fora do briefing, só linhas "senha: …", "password: …", "login: …" e
 *   "Acesso ao Instagram…" com valor que pareça credencial; o resto fica na legenda.
 * As linhas removidas viram linhas vazias (a numeração das linhas não muda).
 */
export function extractCredentials(text: string): {
  text: string;
  credentialDetected: boolean;
  credentials: DocCredential[];
  withheld: WithheldCredentialLine[];
} {
  const lines = splitLines(text);
  const firstPost = lines.findIndex((l) => {
    const h = parseHeaderLine(l);
    return h !== null && h !== "unknown";
  });
  const briefingEnd = firstPost === -1 ? lines.length : firstPost;
  // a última linha antes do 1º post é a redatora ("PAMELA"): nunca é valor de credencial
  let writerLine = -1;
  for (let k = firstPost - 1; k >= 0 && writerLine === -1; k--) if (lines[k].trim()) writerLine = k;
  const byNetwork = new Map<string, DocCredential>();
  const withheld: WithheldCredentialLine[] = [];
  let detected = false;
  let context: { networks: string[]; line: number } | null = null;
  let slot: CredentialSlot | null = null;

  const drop = (i: number) => {
    if (lines[i].trim()) detected = true;
    lines[i] = "";
  };
  const withhold = (i: number, label: string) => {
    withheld.push({ line: i + 1, label: label.trim().replace(/:+$/, "") });
    drop(i);
  };
  const take = (network: string, line: number): DocCredential => {
    const key = networkKey(network);
    let c = byNetwork.get(key);
    if (!c) {
      c = { network, login: "", password: "", line, inBriefing: line - 1 < briefingEnd };
      byNetwork.set(key, c);
    }
    return c;
  };
  /** vale o primeiro valor de cada campo */
  const putAll = (creds: DocCredential[], read: CredentialRead) => {
    for (const c of creds) {
      if (read.login && !c.login) c.login = read.login;
      if (read.password && !c.password) c.password = read.password;
    }
  };
  /**
   * Linha "rótulo de credencial [+ valor]": rede do próprio rótulo, do contexto
   * ou "Geral". Sai do texto se der login ou senha, ou (só no briefing) se o
   * rótulo estiver vazio — aí os valores podem vir nas linhas de baixo — ou se
   * a senha escrita for recusada (vai para `withheld`). Devolve se a linha saiu.
   */
  const credentialLine = (
    i: number,
    kind: CredKind,
    label: string,
    value: string,
    opts: { inBriefing: boolean; noColon?: boolean; networks?: string[] }
  ): boolean => {
    const own = opts.networks ?? networksOfLabel(label, kind);
    const ctx = own.length === 0 ? context : null;
    const networks = own.length ? own : ctx ? ctx.networks : ["Geral"];
    if (!value) {
      if (!opts.inBriefing) return false;
      slot = {
        creds: networks.map((n) => take(n, i + 1)),
        want: kind === "password" ? ["password"] : kind === "login" ? ["login"] : ["login", "password"],
        label,
        networks,
        passwordLabel: kind === "password",
        skippedBlank: false,
      };
    } else {
      const read = readInline(kind, value, kind === "block" && (!!opts.noColon || !opts.inBriefing));
      // fora do briefing (legenda), o que não é credencial inteira fica onde está
      if (!opts.inBriefing && read.rejectedPassword) return false;
      if (!read.login && !read.password) {
        if (!opts.inBriefing || !read.rejectedPassword) return false;
        withhold(i, label);
        slot = null;
        return true;
      }
      putAll(networks.map((n) => take(n, i + 1)), read);
      if (read.rejectedPassword) withheld.push({ line: i + 1, label: label.trim().replace(/:+$/, "") });
      slot = null;
    }
    drop(i);
    if (ctx) drop(ctx.line - 1); // o "Referente ao Instagram:" sai junto
    if (own.length) context = { networks: own, line: i + 1 };
    return true;
  };

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const inBriefing = i < briefingEnd;
    if (inBriefing && slot) {
      const open: CredentialSlot = slot;
      if (!t && open.passwordLabel && !open.skippedBlank && open.want[0] === "password") {
        open.skippedBlank = true;
        continue;
      }
      // linha em branco, "Rótulo: valor" (de qualquer tamanho: é outro campo), hashtags, separador ou a
      // redatora: o bloco fecha e a linha segue o caminho normal
      const otherField = /^[^:]{2,}:{1,2}(\s|$)/.test(t) && !/^https?:/i.test(t);
      const step: { read?: CredentialRead; withhold?: true; close?: true } =
        !t || i === writerLine || otherField || isHashtagLine(t) || isSeparatorLine(t) ? { close: true } : slotStep(open, t);
      if (step.read || step.withhold) {
        if (step.read) putAll(open.creds, step.read);
        if (step.withhold) withhold(i, open.label);
        else drop(i);
        if (step.withhold || open.want.length === 0) slot = null;
        continue;
      }
      if (step.close) slot = null;
    }
    if (!t) continue;
    if (inBriefing) {
      const label = labelOf(t);
      const kind = label !== null ? credentialKindOf(label) : null;
      if (label !== null && kind) {
        // lida ou não, não é campo do briefing (a que fica no texto aparece em "não importado")
        credentialLine(i, kind, label, valueAfter(t, label), { inBriefing });
        continue;
      }
      const prefixed = label !== null ? prefixedCredential(t, label) : null;
      if (prefixed && credentialLine(i, prefixed.kind, prefixed.label, prefixed.value, { inBriefing, networks: prefixed.networks })) {
        continue;
      }
      const head = label === null ? CREDENTIAL_HEAD.exec(t) : null;
      // "Acesso a todos os materiais…" não é credencial: "acesso ao/à" só vale citando uma rede
      if (head && !(/^acesso/i.test(head[1]) && !canonicalNetwork(head[1], { allowEmail: false }))) {
        credentialLine(i, credentialKindOf(head[1]) ?? "block", head[1], head[2] ?? "", { inBriefing, noColon: true });
        continue;
      }
      if (label !== null) {
        // rótulo vazio que cita uma rede ("Referente ao Instagram:") vira o contexto
        const nets = valueAfter(t, label) ? [] : networksIn(lowerNorm(label), false);
        context = nets.length ? { networks: nets, line: i + 1 } : null;
      } else if (t.split(/\s+/).length <= 3) {
        const nets = networksIn(lowerNorm(t), false);
        if (nets.length) {
          context = { networks: nets, line: i + 1 };
          continue;
        }
      }
    } else if (i === briefingEnd) {
      context = null;
    }
    if (CREDENTIAL_ANYWHERE.test(t)) {
      const label = labelOf(t);
      const kind = label !== null ? credentialKindOf(label) : null;
      const prefixed = label !== null && !kind ? prefixedCredential(t, label) : null;
      const head = label === null ? CREDENTIAL_HEAD.exec(t) : null;
      if (label !== null && kind) credentialLine(i, kind, label, valueAfter(t, label), { inBriefing });
      else if (prefixed) credentialLine(i, prefixed.kind, prefixed.label, prefixed.value, { inBriefing, networks: prefixed.networks });
      else if (head) credentialLine(i, credentialKindOf(head[1]) ?? "block", head[1], head[2] ?? "", { inBriefing, noColon: true });
      slot = null;
    }
  }
  const credentials = [...byNetwork.values()]
    .filter((c) => c.login || c.password)
    .sort((a, b) => a.line - b.line);
  return { text: lines.join("\n"), credentialDetected: detected, credentials, withheld };
}

/** `extractCredentials` sem os valores: só o texto limpo e se havia credencial. */
export function stripCredentials(text: string): { text: string; credentialDetected: boolean } {
  const { text: clean, credentialDetected } = extractCredentials(text);
  return { text: clean, credentialDetected };
}

// ------------------------------------------------------------ briefing

type BriefingTarget =
  | { to: "client"; key: BriefingClientField }
  | { to: "briefing"; key: BriefingKey }
  | { to: "phones" }
  | { to: "email" };

/** Rótulo do docx (normalizado) → campo. A ordem importa. */
const BRIEFING_DICTIONARY: readonly { test: RegExp; target: BriefingTarget }[] = [
  {
    test: /nome da empresa|nome fantasia|nome da (unidade|marca|loja|clinica|empresa)|nome do (negocio|estabelecimento)/,
    target: { to: "client", key: "tradeName" },
  },
  { test: /pagina do face|facebook|fanpage/, target: { to: "client", key: "facebookUrl" } },
  { test: /pagina do insta|instagram/, target: { to: "client", key: "instagramUrl" } },
  { test: /\bsite\b|website/, target: { to: "client", key: "website" } },
  { test: /cidade/, target: { to: "client", key: "city" } },
  { test: /telefone|whats|celular|\bfone\b/, target: { to: "phones" } },
  { test: /e-?mail/, target: { to: "email" } },
  { test: /tom de voz|tom da marca|linguagem/, target: { to: "client", key: "toneOfVoice" } },
  { test: /aniversario/, target: { to: "briefing", key: "anniversary" } },
  { test: /parceria|convenio/, target: { to: "briefing", key: "partnerships" } },
  { test: /posicionamento/, target: { to: "briefing", key: "positioning" } },
  { test: /repostar/, target: { to: "briefing", key: "linkedinRepost" } },
  { test: /company page|linkedin/, target: { to: "briefing", key: "linkedinUrl" } },
  { test: /publico/, target: { to: "briefing", key: "audience" } },
  { test: /texto obrigatorio|obrigatorio nas artes/, target: { to: "briefing", key: "mandatoryArtText" } },
  { test: /responsavel tecnico/, target: { to: "briefing", key: "responsibleTech" } },
  { test: /^plano\b|^nivel\b|nivel do plano/, target: { to: "briefing", key: "plan" } },
  { test: /temas/, target: { to: "briefing", key: "themes" } },
  { test: /servicos|produtos/, target: { to: "briefing", key: "products" } },
  { test: /hashtag/, target: { to: "briefing", key: "hashtags" } },
  // "Qual o seu principal diferencial dos concorrentes?" é diferencial
  { test: /diferencia/, target: { to: "briefing", key: "differential" } },
  { test: /concorrente/, target: { to: "briefing", key: "competitors" } },
  { test: /referencias? (de|para) (reels|videos?|artes?|posts?|stories)/, target: { to: "briefing", key: "designNotes" } },
  { test: /referencia/, target: { to: "briefing", key: "references" } },
  { test: /observac/, target: { to: "briefing", key: "observations" } },
  { test: /restric/, target: { to: "briefing", key: "restrictions" } },
  {
    test: /^designer?\b|notas? de design|^caminho\b|\bfotos?\b|\bvideos?\b|\bimagens?\b|\bpasta\b/,
    target: { to: "briefing", key: "designNotes" },
  },
];

/** Rótulo com campo no cadastro (ou de credencial): nunca vira nota solta. */
function isBriefingLabel(label: string): boolean {
  const l = norm(label).toLowerCase();
  return CREDENTIAL_LABEL.test(l) || BRIEFING_DICTIONARY.some((d) => d.test.test(l));
}

/** Campos de texto livre: rótulos repetidos se somam (os demais: vale o 1º, o resto fica "não importado"). */
const APPEND_KEYS: Readonly<Record<string, RegExp>> = { observations: /observac/, designNotes: /notas? de design/ };

/** Respostas que significam "não há". */
const EMPTY_ANSWER = /^(nao tenho|nao tem|nao possui|n\/a|-+|—)$/;

/** Celular brasileiro (9 dígitos começando por 9, depois do DDD) = WhatsApp. */
function isMobileNumber(s: string): boolean {
  let d = s.replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length >= 10) d = d.slice(2);
  return d.length === 9 && d.startsWith("9");
}

/**
 * "Telefone … – fixo e whatsapp: (00) 0000-0000 / (00) 90000-0000" → fixo em
 * `phone`, celular em `whatsapp`. Rótulo só de telefone → tudo em `phone`;
 * só de WhatsApp → tudo em `whatsapp`.
 */
function splitPhones(label: string, value: string): { phone?: string; whatsapp?: string } {
  const whats = /whats|zap|wpp/.test(label);
  const phone = /telefone|fone|fixo|celular/.test(label);
  if (!whats) return { phone: value };
  if (!phone) return { whatsapp: value };
  const parts = value
    .split(/\s*(?:\/|\||;|,|\s+e\s+|\s+ou\s+)\s*/)
    .map((s) => s.trim())
    .filter((s) => (s.match(/\d/g) ?? []).length >= 8);
  if (parts.length === 0) return { phone: value };
  const mobiles = parts.filter(isMobileNumber);
  const fixed = parts.filter((s) => !isMobileNumber(s));
  return {
    ...(fixed.length ? { phone: fixed.join(" / ") } : {}),
    ...(mobiles.length ? { whatsapp: mobiles.join(" / ") } : {}),
  };
}

function buildBriefing(pairs: { line: number; label: string; value: string }[]): ParsedBriefing {
  const out: ParsedBriefing = { client: {}, briefing: {}, emailSuggestion: null, unmapped: [], sources: {} };
  const set = (p: (typeof pairs)[number], to: "client" | "briefing", key: string, raw: string) => {
    const bucket: Record<string, string> = to === "client" ? out.client : out.briefing;
    const own = to === "briefing" ? APPEND_KEYS[key] : undefined;
    // em Observações/Notas de design, o rótulo de origem fica junto ("CAMINHO: …")
    const v = own && !own.test(norm(p.label).toLowerCase()) ? `${p.label.trim()}: ${raw}` : raw;
    if (bucket[key] === undefined) {
      bucket[key] = v;
      out.sources[key as BriefingClientField | BriefingKey] = { line: p.line, label: p.label.trim() };
    } else if (own) bucket[key] = `${bucket[key]}\n${v}`;
    else out.unmapped.push({ line: p.line, label: p.label.trim(), value: p.value.trim() });
  };
  for (const p of pairs) {
    // "(neste campo você pode acrescentar…) resposta": a instrução do formulário não é valor
    const value = p.value
      .trim()
      .replace(/^\((?=[^)]*\b(neste campo|voce pode|você pode|exemplo|ex\.)\s)[^)]*\)\s*/i, "")
      .trim();
    if (!value || EMPTY_ANSWER.test(norm(value).toLowerCase())) continue;
    const label = norm(p.label).toLowerCase();
    if (CREDENTIAL_LABEL.test(label)) {
      // rótulo de acesso que ficou no texto (o valor não pareceu login/senha): listado, sem o valor
      out.unmapped.push({ line: p.line, label: p.label.trim(), value: "", credential: true });
      continue;
    }
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
    if (t.to === "phones") {
      const split = splitPhones(label, value);
      if (split.phone) set(p, "client", "phone", split.phone);
      if (split.whatsapp) set(p, "client", "whatsapp", split.whatsapp);
      continue;
    }
    let v = value;
    if (t.to === "client" && (t.key === "facebookUrl" || t.key === "instagramUrl")) {
      v = /https?:\/\/[^\s|]+/.exec(value)?.[0] ?? value;
    }
    set(p, t.to, t.key, v);
  }
  return out;
}

/** O que a prévia propõe gravar num campo do cadastro/briefing. */
export type BriefingProposal = { value: string; hint: string | null };

export type BriefingProposals = {
  fields: Partial<Record<BriefingClientField | BriefingKey, BriefingProposal>>;
  /** e-mail do documento (só sugestão) */
  email: string | null;
  /**
   * pares sem campo, repetidos com outro valor (`duplicate`) ou rótulos de acesso
   * sem login/senha reconhecível (`credential`, valor vazio): a prévia lista como "não importado"
   */
  unmapped: { line: number; label: string; value: string; duplicate: boolean; credential: boolean }[];
};

/** Nota solta que é para a arte/designer (o resto vira Observações). */
const DESIGN_NOTE = /^(designer?|arte|artes|caminho|refer[eê]ncias? (de|para) (reels|v[ií]deos?|artes?|posts?))\b/i;

const LOOSE_HINT = "Rótulo com “:” no documento.";

/**
 * Tudo o que o documento traz e tem campo no cadastro: os pares "Rótulo:: valor"
 * (completados pelos "Rótulo: valor") e, sem rótulo, a linha do plano (→ Plano),
 * o bloco de hashtags ou a linha que se repete nas legendas (→ Hashtags) e as
 * notas soltas (→ Notas de design / Observações, somadas ao valor do rótulo).
 */
export function proposeBriefing(doc: ParsedMonthlyDoc): BriefingProposals {
  const fields: BriefingProposals["fields"] = {};
  const unmapped = [...doc.briefing.unmapped, ...doc.looseBriefing.unmapped];
  for (const [k, v] of [...Object.entries(doc.briefing.client), ...Object.entries(doc.briefing.briefing)]) {
    if (v?.trim()) fields[k as BriefingClientField | BriefingKey] = { value: v.trim(), hint: null };
  }
  const loose = doc.looseBriefing;
  for (const [k, v] of [...Object.entries(loose.client), ...Object.entries(loose.briefing)]) {
    const key = k as BriefingClientField | BriefingKey;
    const value = v?.trim();
    if (!value) continue;
    const cur = fields[key];
    if (!cur) fields[key] = { value, hint: null };
    else if (key in APPEND_KEYS) fields[key] = { value: `${cur.value}\n${value}`, hint: LOOSE_HINT };
    else if (cur.value !== value) {
      const src = loose.sources[key];
      unmapped.push({ line: src?.line ?? 0, label: src?.label ?? key, value });
    }
  }
  // o campo "Hashtags::" costuma vir vazio, com o bloco fixo logo abaixo
  if (!fields.hashtags && doc.hashtagsBlock) fields.hashtags = { value: doc.hashtagsBlock.trim(), hint: null };
  if (!fields.hashtags && doc.captionHashtags) {
    fields.hashtags = { value: doc.captionHashtags.trim(), hint: "Repetidas no fim das legendas do documento." };
  }
  if (!fields.plan && doc.header) fields.plan = { value: doc.header.trim(), hint: "Linha do plano no início do documento." };
  const append = (key: "designNotes" | "observations", texts: string[]) => {
    if (!texts.length) return;
    fields[key] = {
      value: [fields[key]?.value, ...texts].filter(Boolean).join("\n"),
      hint: "Inclui notas soltas do início do documento.",
    };
  };
  append("designNotes", doc.notes.filter((n) => DESIGN_NOTE.test(n.text)).map((n) => n.text));
  append("observations", doc.notes.filter((n) => !DESIGN_NOTE.test(n.text)).map((n) => n.text));
  return {
    fields,
    email: doc.briefing.emailSuggestion ?? loose.emailSuggestion,
    unmapped: unmapped
      .map((u) => {
        const credential = u.credential === true;
        return { line: u.line, label: u.label, value: u.value, duplicate: !credential && isBriefingLabel(u.label), credential };
      })
      .sort((a, b) => a.line - b.line),
  };
}

// ------------------------------------------------------------ parser

type Builder = {
  header: ParsedHeader;
  line: number;
  writer: string | null;
  statuses: Set<DocStatus>;
  time: string | null;
  /** notas internas na ordem do documento; `free` = texto sem marcador (pode ser a legenda) */
  notes: { text: string; free: boolean }[];
  /** texto sem marcador logo depois do cabeçalho, com as linhas em branco (legenda sem "LEGENDA:") */
  free: string[];
  slides: { text: string }[];
  caption: string[];
  sawLegenda: boolean;
  sub: "head" | "slide" | "caption";
};

const newBuilder = (header: ParsedHeader, line: number, writer: string | null): Builder => ({
  header,
  line,
  writer,
  statuses: new Set(),
  time: null,
  notes: [],
  free: [],
  slides: [],
  caption: [],
  sawLegenda: false,
  sub: "head",
});

const joinParagraphs = (lines: string[]) => lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

/** A linha de hashtags que fecha a maioria das legendas (≥ 2) — o bloco fixo do cliente. */
function commonCaptionHashtags(captions: string[]): string | null {
  const counts = new Map<string, number>();
  let withHashtags = 0;
  for (const c of captions) {
    const last = c
      .split("\n")
      .map((l) => l.trim().replace(/\s+/g, " "))
      .filter((l) => isHashtagLine(l))
      .pop();
    if (!last) continue;
    withHashtags += 1;
    counts.set(last, (counts.get(last) ?? 0) + 1);
  }
  let best: [string, number] | null = null;
  for (const e of counts) if (!best || e[1] > best[1]) best = e;
  return best && best[1] >= 2 && best[1] * 2 >= withHashtags ? best[0] : null;
}

/**
 * Lê o documento mensal. Nada é gravado: o resultado alimenta a prévia
 * (S18/S33). Credenciais saem do texto antes de qualquer leitura.
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

  // briefing: "Rótulo:: valor" e "Rótulo: valor". Num documento que usa "::", os
  // pares com um ":" só ficam em `looseBriefing` (completam o principal)
  const firstHeader = headers.findIndex((h) => h !== null && h !== "unknown");
  const doubleColon = lines.slice(0, firstHeader === -1 ? lines.length : firstHeader).some((l) => /^[^:]+::/.test(l.trim()));
  const pairOf = (t: string): { label: string; value: string; loose: boolean } | null => {
    const dbl = /^(.+?)::\s*(.*)$/.exec(t);
    if (dbl) return { label: dbl[1], value: dbl[2].replace(/^[:\s]+/, ""), loose: false };
    // ":" seguido de espaço ou fim (não confunde com "https://"); "Rótulo: : valor" também vale
    const one = /^([^:]{2,120}?)\s*:(?:\s+(.*))?$/.exec(t);
    if (!one || /^https?$/i.test(one[1].trim())) return null;
    return { label: one[1], value: (one[2] ?? "").replace(/^[:\s]+/, ""), loose: doubleColon };
  };

  const result: ParsedMonthlyDoc = {
    refMonth: opts.refMonth,
    header: null,
    briefing: { client: {}, briefing: {}, emailSuggestion: null, unmapped: [], sources: {} },
    looseBriefing: { client: {}, briefing: {}, emailSuggestion: null, unmapped: [], sources: {} },
    hashtagsBlock: null,
    captionHashtags: null,
    notes: [],
    posts: [],
    avulsos: [],
    standBy: [],
    endOfContract: false,
    credentialDetected: stripped.credentialDetected,
    ignoredTemplates: 0,
    warnings: [],
  };
  const warn = (line: number, message: string) => result.warnings.push({ line, message });

  const pairs: { line: number; label: string; value: string; loose: boolean }[] = [];
  let lastPair: (typeof pairs)[number] | null = null;
  let note: { line: number; lines: string[] } | null = null;
  let seenPreambleContent = false;
  /** a linha do plano pode continuar na linha de baixo (quebra de linha no Word) */
  let headerOpen = false;
  const closeNote = () => {
    if (note) result.notes.push({ line: note.line, text: note.lines.join("\n") });
    note = null;
  };

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
    let caption = joinParagraphs(b.caption);
    // sem "LEGENDA:" e sem telas, o texto depois do cabeçalho é a legenda (ex.: TÍTULO no formato de rótulos simples)
    const freeIsCaption = !b.sawLegenda && caption === "" && b.slides.length === 0 && b.free.length > 0;
    if (freeIsCaption) caption = joinParagraphs(b.free);
    const notes = [
      h.kind === "avulso" ? "Post avulso" : null,
      h.kindNote,
      ...b.notes.filter((n) => !(freeIsCaption && n.free)).map((n) => n.text),
    ].filter((n): n is string => !!n);
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
      caption,
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
        cur = newBuilder(h, lineNo, writer);
      } else if (h !== null) {
        result.ignoredTemplates += 1;
      }
      continue;
    }

    if (isEndOfContract(t)) {
      finish();
      closeNote();
      result.endOfContract = true;
      inPosts = true;
      skipping = false;
      continue;
    }
    if (isMoldeLine(t)) {
      finish();
      closeNote();
      inMolde = true;
      inPosts = true;
      skipping = false;
      continue;
    }
    if (h === "unknown") {
      finish();
      closeNote();
      warn(lineNo, `Bloco não reconhecido: "${t}"`);
      inPosts = true;
      skipping = true;
      continue;
    }
    if (h !== null) {
      finish();
      closeNote();
      inPosts = true;
      skipping = false;
      cur = newBuilder(h, lineNo, writer);
      continue;
    }
    if (t && isWriterLine(i, t)) {
      finish();
      closeNote();
      inPosts = true;
      skipping = false;
      writer = t;
      continue;
    }

    // ---- antes dos posts: plano, briefing, hashtags e notas soltas
    if (!inPosts) {
      if (!t || isSeparatorLine(t)) {
        lastPair = null;
        headerOpen = false;
        closeNote();
        continue;
      }
      const pair = pairOf(t);
      if (!seenPreambleContent && !pair && isPlanHeaderLine(t)) {
        result.header = t;
        seenPreambleContent = true;
        headerOpen = true;
        continue;
      }
      if (headerOpen && result.header !== null && !pair && isUpperText(t)) {
        result.header = `${result.header} ${t}`;
        continue;
      }
      headerOpen = false;
      seenPreambleContent = true;
      if (pair) {
        closeNote();
        lastPair = { line: lineNo, ...pair };
        pairs.push(lastPair);
        continue;
      }
      if (lastPair && !isLabelLike(t) && !isHashtagLine(t)) {
        lastPair.value = lastPair.value ? `${lastPair.value}\n${t}` : t;
        continue;
      }
      lastPair = null;
      if (isHashtagLine(t)) {
        closeNote();
        if (result.hashtagsBlock === null) result.hashtagsBlock = t;
        else result.notes.push({ line: lineNo, text: t });
        continue;
      }
      // parágrafo sem rótulo (ex.: "DESIGNER: …" num documento com "::", "A cliente quer…")
      if (note) note.lines.push(t);
      else note = { line: lineNo, lines: [t] };
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
      else if (b.sub === "head" && b.free.length > 0) b.free.push("");
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
      b.notes.push({ text: t, free: false });
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
        b.sawLegenda = true;
        if (leg) b.caption.push(leg);
        continue;
      }
    }
    if (b.sub === "caption") b.caption.push(t);
    else if (b.sub === "slide") {
      const last = b.slides[b.slides.length - 1];
      last.text = last.text ? `${last.text}\n${t}` : t;
    } else {
      b.notes.push({ text: t, free: true });
      b.free.push(t);
    }
  }
  finish();
  closeNote();

  // rótulo vazio sem campo e sem continuação ("ATENÇÃO AOS HORÁRIOS:") é título de nota, não se perde
  for (const p of pairs) {
    if (p.value.trim() || isBriefingLabel(p.label)) continue;
    result.notes.push({ line: p.line, text: `${p.label.trim()}:` });
  }
  result.notes.sort((a, b) => a.line - b.line);
  result.briefing = buildBriefing(pairs.filter((p) => !p.loose));
  result.looseBriefing = buildBriefing(pairs.filter((p) => p.loose));
  if (result.hashtagsBlock === null) {
    result.captionHashtags = commonCaptionHashtags(
      [...result.posts, ...result.avulsos, ...result.standBy].map((p) => p.caption).filter(Boolean)
    );
  }
  result.warnings.sort((a, b) => a.line - b.line);
  return result;
}
