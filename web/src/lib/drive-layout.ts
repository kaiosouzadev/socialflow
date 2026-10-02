/**
 * Convenção de pastas do Google Drive (puro: sem rede, sem banco, sem env).
 *
 *   Raiz/Cliente/AAAA/<mês>/{N.jpg, Nstory.jpg, Nstory2.jpg…, N/ (carrossel)}
 *
 * A pasta do mês é aceita, sem diferenciar caixa nem acento, como:
 *   "outubro", "OUTUBRO", "Outubro", "Marco" (sem cedilha), "10", "010",
 *   "10 - Outubro", "10-outubro", "10_outubro", "10.outubro", "10 outubro".
 * Em nomes com número e nome ("04 - SETEMBRO") o NOME do mês prevalece: a
 * numeração das pastas antigas da equipe é sequencial, não é o número do mês.
 *
 * Compatibilidade: sem a pasta do ano (ou com o ano sem o mês), vale a
 * estrutura antiga Cliente/<mês> ("legado").
 *
 * Pastas criadas pelo sistema usam os nomes canônicos "2026" e "10 - Outubro"
 * (o prefixo numérico ordena cronologicamente no Drive).
 */

export type DriveLayout = "ano/mes" | "legado";

export type DriveFolder = { id: string; name: string };

/** Lista as SUBPASTAS diretas de uma pasta (injetada: Drive real ou árvore falsa). */
export type ListChildren = (parentId: string) => Promise<DriveFolder[]>;

/** Como o nome da pasta casou com o mês, em ordem de precedência. */
export type MonthMatchKind = "nome" | "numero-nome" | "numero";

const MONTH_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

const RANK: Record<MonthMatchKind, number> = { nome: 3, "numero-nome": 2, numero: 1 };

const pad2 = (n: number) => String(n).padStart(2, "0");

function assertMonth(month: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`mês inválido: ${month}`);
  }
}

/** trim + minúsculas + sem acento + espaços internos colapsados. */
export function normalizeFolderName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const NORMALIZED_MONTHS = MONTH_LABELS.map((m) => normalizeFolderName(m));

/** "2026-10" → { year: 2026, month: 10 }. Lança erro se o formato for inválido. */
export function parseMonthKey(monthKey: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey.trim());
  if (!m) throw new Error(`monthKey inválido (esperado AAAA-MM): ${monthKey}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  assertMonth(month);
  return { year, month };
}

/** Nome do mês com inicial maiúscula: 3 → "Março". */
export function monthName(month: number): string {
  assertMonth(month);
  return MONTH_LABELS[month - 1];
}

/** Nome canônico da pasta do mês criada pelo sistema: 10 → "10 - Outubro". */
export function canonicalMonthFolderName(month: number): string {
  return `${pad2(month)} - ${monthName(month)}`;
}

/** Nome da pasta do mês na estrutura antiga (Cliente/<mês>): 10 → "outubro". */
export function legacyMonthFolderName(month: number): string {
  return monthName(month).toLowerCase();
}

/**
 * Interpreta o nome de uma pasta de mês. Devolve o mês (1-12) e o tipo de
 * casamento, ou null se o nome não for de mês ("31", "Outubro 2025", "out").
 */
export function parseMonthFolderName(name: string): { month: number; kind: MonthMatchKind } | null {
  const n = normalizeFolderName(name);
  const byName = NORMALIZED_MONTHS.indexOf(n);
  if (byName >= 0) return { month: byName + 1, kind: "nome" };

  // "NN - Nome" (separadores " - ", "-", "_", "." ou espaço): o nome prevalece
  const numbered = /^0*\d{1,2}(?:\s*[-_.]\s*|\s+)([a-z]+)$/.exec(n);
  if (numbered) {
    const idx = NORMALIZED_MONTHS.indexOf(numbered[1]);
    return idx >= 0 ? { month: idx + 1, kind: "numero-nome" } : null;
  }

  const onlyNumber = /^0*(\d{1,2})$/.exec(n);
  if (onlyNumber) {
    const month = Number(onlyNumber[1]);
    return month >= 1 && month <= 12 ? { month, kind: "numero" } : null;
  }
  return null;
}

/** O nome da pasta corresponde ao mês? Devolve o tipo de casamento ou null. */
export function matchMonthFolder(name: string, month: number): MonthMatchKind | null {
  assertMonth(month);
  const parsed = parseMonthFolderName(name);
  return parsed && parsed.month === month ? parsed.kind : null;
}

/** O nome da pasta é o ano ("2026", com espaços nas pontas tolerados)? */
export function matchYearFolder(name: string, year: number): boolean {
  const n = normalizeFolderName(name);
  return /^\d{4}$/.test(n) && Number(n) === year;
}

/** Ordem total e estável entre pastas candidatas (desempate determinístico). */
function compareFolders(a: DriveFolder, b: DriveFolder): number {
  const na = normalizeFolderName(a.name);
  const nb = normalizeFolderName(b.name);
  if (na !== nb) return na < nb ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Escolhe a pasta do mês entre as subpastas de um pai. Precedência:
 * nome exato do mês > "NN - Nome" > só número; empate → ordem alfabética.
 * `ambiguous` lista os nomes de TODAS as candidatas quando há mais de uma.
 */
export function pickMonthFolder(
  folders: readonly DriveFolder[],
  month: number
): { folder: DriveFolder | null; ambiguous: string[] } {
  const candidates = folders
    .map((f) => ({ f, kind: matchMonthFolder(f.name, month) }))
    .filter((c): c is { f: DriveFolder; kind: MonthMatchKind } => c.kind !== null)
    .sort((a, b) => RANK[b.kind] - RANK[a.kind] || compareFolders(a.f, b.f));
  if (candidates.length === 0) return { folder: null, ambiguous: [] };
  return {
    folder: candidates[0].f,
    ambiguous: candidates.length > 1 ? candidates.map((c) => c.f.name) : [],
  };
}

/** Escolhe a pasta do ano entre as subpastas da pasta do cliente. */
export function pickYearFolder(
  folders: readonly DriveFolder[],
  year: number
): { folder: DriveFolder | null; ambiguous: string[] } {
  const candidates = folders.filter((f) => matchYearFolder(f.name, year)).sort(compareFolders);
  if (candidates.length === 0) return { folder: null, ambiguous: [] };
  return {
    folder: candidates[0],
    ambiguous: candidates.length > 1 ? candidates.map((f) => f.name) : [],
  };
}

/** Nome do arquivo sem a extensão ("3 - Título.jpg" → "3 - Título"). */
function stemOfName(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).trim();
}

/** Prefixo "story" de um nome, depois do índice: o que vem em seguida não pode ser letra ("storyboard" não é story). */
const STORY_PREFIX = /^[\s._-]*story(?!\p{L})/u;

/**
 * Story: nome que, depois do índice opcional, começa por "story" seguido de
 * algo que não é letra — "3story.jpg", "3 story.png", "03_STORY.jpg",
 * "3 - story", "story.jpg" e, com a ordem do story, "3story2.jpg",
 * "4 story 2.jpg", "04_STORY_2.png", "story2.jpg". Um arquivo assim nunca é
 * feed nem slide de carrossel. Quem lê o N e a ordem é `parseArtStem`.
 */
export function isStoryName(name: string): boolean {
  const stem = stemOfName(name).toLowerCase();
  return STORY_PREFIX.test(stem.replace(/^0*\d+/, ""));
}

/** O que o nome de uma arte no Drive diz: o N do post e, se for story, a ordem dele. */
export type ArtName =
  /** arte principal (feed, reels, pasta do carrossel): "3", "03 - Título", "3_final" */
  | { kind: "post"; index: number }
  /**
   * story: "3story" (ordinal 1), "3story2" (2), "3story3" (3)…; "3story1" também
   * é o 1º. Sem número ("story", "story2") o N vem da subpasta `N/`: index null.
   */
  | { kind: "story"; index: number | null; ordinal: number };

/**
 * Lê o nome de uma arte SEM a extensão, sem diferenciar caixa. Devolve null se
 * o nome não serve para nenhum post. Regras (docs/08-DRIVE-ESTRUTURA.md):
 * - N com zeros à esquerda: "03" = 3; depois do N só vale nada ou um separador
 *   (espaço, ".", "_", "-", "(") — "31" nunca é o post 3;
 * - story: separadores opcionais + "story" + ordem opcional (separadores
 *   opcionais + número ≥ 1): "4story2", "4 story 2", "4-story-2", "04_STORY_2";
 *   sem ordem é o 1º story. Depois, de novo, só nada ou um separador.
 */
export function parseArtStem(stem: string): ArtName | null {
  const s = stem.trim().toLowerCase();
  const num = /^0*(\d+)\s*/.exec(s);
  const index = num ? Number(num[1]) : null;
  const rest = num ? s.slice(num[0].length) : s;
  const validTail = (tail: string) => tail === "" || /^[\s._()-]/.test(tail);

  const story = STORY_PREFIX.exec(rest);
  if (story) {
    const after = rest.slice(story[0].length);
    const ord = /^[\s._-]*(\d+)/.exec(after);
    const ordinal = ord ? Number(ord[1]) : 1;
    const tail = ord ? after.slice(ord[0].length) : after;
    return ordinal >= 1 && validTail(tail) ? { kind: "story", index, ordinal } : null;
  }
  if (index === null || !validTail(rest)) return null;
  return { kind: "post", index };
}

/** Nome (sem extensão) do story de ordem `ordinal` do post N: 1 → "4story", 2 → "4story2", 3 → "4story3". */
export function storyFileStem(index: number, ordinal: number): string {
  return ordinal <= 1 ? `${index}story` : `${index}story${ordinal}`;
}

/**
 * Numeração dos posts do mês para casar com os nomes dos arquivos no Drive
 * (cópia fiel da regra de `drive-sync.ts`):
 * - só posts PRINCIPAIS (não-story) contam: 1, 2, 3… na ordem recebida;
 * - um story herda o índice do post principal anterior mais próximo (o story
 *   sai junto do post, 15 min depois) → arquivo "Nstory.*" ("Nstory2.*" para
 *   o 2º story com o mesmo N…: ver `buildMonthFileNames`);
 * - story sem principal anterior no mês recebe 1.
 * O chamador passa TODOS os posts do cliente no mês, de qualquer status,
 * ordenados por scheduledAt crescente.
 */
export function buildMonthIndex(
  monthPosts: readonly { id: string; format: string }[]
): Map<string, number> {
  const byId = new Map<string, number>();
  let mainIdx = 0;
  let lastMainIdx = 0;
  for (const p of monthPosts) {
    if (p.format === "story") {
      byId.set(p.id, lastMainIdx > 0 ? lastMainIdx : 1);
    } else {
      mainIdx += 1;
      lastMainIdx = mainIdx;
      byId.set(p.id, mainIdx);
    }
  }
  return byId;
}

/** Nome da arte de um post no Drive (resultado de `buildMonthFileNames`). */
export type MonthFileName = {
  /** N do post no mês: o mesmo valor de `buildMonthIndex` */
  index: number;
  /** null = post principal (feed, carrossel, reels); 1, 2, 3… = 1º, 2º, 3º story com esse N */
  storyOrdinal: number | null;
  /** nome do arquivo sem a extensão: "4" (principal), "4story" (1º story), "4story2" (2º story)… */
  fileStem: string;
};

/**
 * Nome da arte de cada post do mês no Drive. O N é o de `buildMonthIndex`
 * (mesma entrada: TODOS os posts do cliente no mês, de qualquer status, em
 * ordem de scheduledAt; empate: createdAt, depois id). Vários stories podem
 * herdar o mesmo N (o story que sai junto do post N e os stories avulsos
 * seguintes, ou os stories antes do 1º post, que herdam 1): na ordem
 * recebida, o 1º usa "Nstory", o 2º "Nstory2", o 3º "Nstory3"…
 * Ex.: reels nº4, story junto, story avulso → "4", "4story", "4story2".
 */
export function buildMonthFileNames(
  monthPosts: readonly { id: string; format: string }[]
): Map<string, MonthFileName> {
  const indexById = buildMonthIndex(monthPosts);
  const storiesByIndex = new Map<number, number>();
  const byId = new Map<string, MonthFileName>();
  for (const p of monthPosts) {
    const index = indexById.get(p.id);
    if (index === undefined) continue;
    if (p.format === "story") {
      const ordinal = (storiesByIndex.get(index) ?? 0) + 1;
      storiesByIndex.set(index, ordinal);
      byId.set(p.id, { index, storyOrdinal: ordinal, fileStem: storyFileStem(index, ordinal) });
    } else {
      byId.set(p.id, { index, storyOrdinal: null, fileStem: String(index) });
    }
  }
  return byId;
}

/** Nomes reais das pastas encontradas (quando conhecidos) para os rótulos. */
export type FolderNames = { yearFolderName?: string | null; monthFolderName?: string | null };

/**
 * Caminho legível para mensagens ao usuário:
 * - "ano/mes" ou null (esperado/novo): "Cliente/2026/10 - Outubro/3.jpg";
 * - "legado": "Cliente/outubro/3.jpg (estrutura antiga)".
 * `file` vazio → caminho da pasta. Nomes reais (de `resolveMonthFolder`)
 * substituem os canônicos quando informados.
 */
export function drivePathLabel(
  client: string,
  year: number,
  month: number,
  file: string,
  layout: DriveLayout | null,
  names?: FolderNames
): string {
  const parts = [client.trim()];
  if (layout === "legado") {
    parts.push(names?.monthFolderName?.trim() || legacyMonthFolderName(month));
  } else {
    parts.push(names?.yearFolderName?.trim() || String(year));
    parts.push(names?.monthFolderName?.trim() || canonicalMonthFolderName(month));
  }
  if (file) parts.push(file);
  const path = parts.filter(Boolean).join("/");
  return layout === "legado" ? `${path} (estrutura antiga)` : path;
}

export type MonthFolderResolution = {
  /** pasta do mês encontrada, ou null */
  folderId: string | null;
  /** onde foi encontrada; null = não encontrada */
  layout: DriveLayout | null;
  /** caminho da pasta encontrada; se não encontrada, o caminho esperado (ano/mês canônico) */
  path: string;
  /** nomes das candidatas quando houve mais de uma (ano e/ou mês), relativos à pasta do cliente */
  ambiguous: string[];
  yearFolderName: string | null;
  monthFolderName: string | null;
};

/**
 * Resolve a pasta do mês de um cliente: tenta Cliente/AAAA/<mês>; sem a pasta
 * do ano, ou com o ano sem o mês, cai na estrutura antiga Cliente/<mês>.
 * Faz no máximo 2 listagens (pasta do cliente e pasta do ano).
 * `clientName` só entra no `path` (para mensagens).
 */
export async function resolveMonthFolder(
  listChildren: ListChildren,
  clientFolderId: string,
  year: number,
  month: number,
  clientName?: string
): Promise<MonthFolderResolution> {
  assertMonth(month);
  const prefix = clientName?.trim() ? `${clientName.trim()}/` : "";
  const ambiguous: string[] = [];

  const clientChildren = await listChildren(clientFolderId);
  const yearPick = pickYearFolder(clientChildren, year);
  ambiguous.push(...yearPick.ambiguous);

  if (yearPick.folder) {
    const yearName = yearPick.folder.name.trim();
    const monthPick = pickMonthFolder(await listChildren(yearPick.folder.id), month);
    if (monthPick.folder) {
      ambiguous.push(...monthPick.ambiguous.map((n) => `${yearName}/${n}`));
      const monthName = monthPick.folder.name.trim();
      return {
        folderId: monthPick.folder.id,
        layout: "ano/mes",
        path: `${prefix}${yearName}/${monthName}`,
        ambiguous,
        yearFolderName: yearName,
        monthFolderName: monthName,
      };
    }
  }

  const legacyPick = pickMonthFolder(clientChildren, month);
  if (legacyPick.folder) {
    ambiguous.push(...legacyPick.ambiguous);
    const monthName = legacyPick.folder.name.trim();
    return {
      folderId: legacyPick.folder.id,
      layout: "legado",
      path: `${prefix}${monthName}`,
      ambiguous,
      yearFolderName: null,
      monthFolderName: monthName,
    };
  }

  const yearName = yearPick.folder?.name.trim() || String(year);
  return {
    folderId: null,
    layout: null,
    path: `${prefix}${yearName}/${canonicalMonthFolderName(month)}`,
    ambiguous,
    yearFolderName: yearPick.folder ? yearName : null,
    monthFolderName: null,
  };
}
