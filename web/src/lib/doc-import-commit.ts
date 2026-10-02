/**
 * Importação do documento mensal da redação (S18): prévia e gravação.
 *
 * - `analyzeImport` lê o texto (credenciais descartadas de novo aqui, por
 *   defesa em profundidade), cruza com o banco e devolve o que SERIA gravado.
 *   Não escreve nada.
 * - `commitImport` refaz a análise dentro de UMA transação e grava:
 *   cronogramas por mês civil, posts SEMPRE `draft`, pendências (stand-by e
 *   aguardando material) e o merge do briefing nos campos marcados.
 *   Conflitos (post do cliente no mesmo dia SP e mesmo formato; stand-by com
 *   o mesmo título) são ignorados: reimportar o mesmo texto cria 0.
 *
 * O texto bruto nunca é gravado nem logado.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_TIMES,
  DEFAULT_WRITER_NAMES,
  firstNameKey,
  parseMonthlyDoc,
  stripCredentials,
  type BriefingClientField,
  type BriefingKey,
  type DocStatus,
  type ParsedPost,
  type TimeSource,
} from "@/lib/doc-import";
import { formatMonthLabel, spLocalInputFromISO, spLocalInputToISO } from "@/lib/format-date";
import type { PostFormat } from "@/lib/formats";

type Db = Prisma.TransactionClient;

/** Limite do texto enviado à rota (bytes UTF-8). */
export const IMPORT_TEXT_MAX_BYTES = 500 * 1024;

export const IMPORT_SCHEDULE_STATUSES = ["rascunho", "aprovado_cliente"] as const;
export type ImportScheduleStatus = (typeof IMPORT_SCHEDULE_STATUSES)[number];

export const POST_TARGETS = ["instagram", "facebook", "linkedin"] as const;
export type PostTarget = (typeof POST_TARGETS)[number];

const CLIENT_FIELDS = ["tradeName", "facebookUrl", "instagramUrl", "website", "city", "phone"] as const;
const BRIEFING_KEYS = [
  "partnerships",
  "products",
  "themes",
  "hashtags",
  "observations",
  "restrictions",
  "audience",
  "competitors",
  "differential",
  "references",
  "anniversary",
  "linkedinUrl",
  "linkedinRepost",
  "positioning",
] as const;

/** Campos que a prévia pode propor e o commit pode gravar (merge). */
export const BRIEFING_FIELDS = [...CLIENT_FIELDS, ...BRIEFING_KEYS] as const;
export type BriefingField = BriefingClientField | BriefingKey;

const BRIEFING_FIELD_LABEL: Record<BriefingField, string> = {
  tradeName: "Nome fantasia",
  facebookUrl: "Facebook (URL)",
  instagramUrl: "Instagram (URL)",
  website: "Site",
  city: "Cidade / UF",
  phone: "Telefone fixo",
  partnerships: "Parcerias / convênios",
  products: "Produtos / serviços",
  themes: "Principais temas a abordar",
  hashtags: "Hashtags",
  observations: "Observações",
  restrictions: "Restrições (datas, religião, etc.)",
  audience: "Público-alvo",
  competitors: "Principais concorrentes",
  differential: "Principal diferencial",
  references: "Páginas de referência",
  anniversary: "Aniversário da empresa",
  linkedinUrl: "Company Page do LinkedIn",
  linkedinRepost: "Repostar no LinkedIn",
  positioning: "Posicionamento da marca",
};

const isClientField = (f: BriefingField): f is BriefingClientField =>
  (CLIENT_FIELDS as readonly string[]).includes(f);

/** Mesmo limite do PATCH de posts (`api/posts/[id]`): até 20 telas. */
const MAX_SLIDES = 20;

// ------------------------------------------------------------ tipos públicos

export type ImportOptions = {
  /** horário padrão por formato ("HH:mm"); vale só para posts sem "*Postar HHh" */
  defaultTimes?: Partial<Record<PostFormat, string>>;
  /** status dos cronogramas CRIADOS (os existentes ficam como estão) */
  scheduleStatus?: ImportScheduleStatus;
  /** `line` dos itens que o usuário desmarcou na prévia */
  exclude?: number[];
  /** campos do briefing a gravar (merge); os demais ficam intactos */
  briefingFields?: BriefingField[];
  /** redes dos posts criados; padrão = redes das contas do cliente, ou IG + FB */
  targets?: PostTarget[];
};

export type ImportInput = { text: string; refMonth: string; options?: ImportOptions };

export type ImportItemKind = "post" | "avulso" | "stand_by";
export type ImportAction = "create" | "conflict" | "excluded" | "invalid";

export type ImportConflict =
  | { type: "post"; id: string; theme: string | null; scheduledAt: string; status: string }
  | { type: "pending"; id: string; title: string; resolved: boolean };

export type ImportItem = {
  /** linha do cabeçalho do bloco no texto: identifica o item entre prévia e commit */
  line: number;
  kind: ImportItemKind;
  seq: number | null;
  date: string | null;
  time: string;
  timeSource: TimeSource;
  /** instante UTC (ISO) do horário SP; null no stand-by e em post sem data */
  scheduledAt: string | null;
  /** "AAAA-MM" do cronograma de destino (mês civil) */
  monthKey: string | null;
  format: PostFormat;
  kindLabel: string;
  title: string;
  slides: { text: string }[];
  caption: string;
  docStatus: DocStatus | null;
  internalNote: string | null;
  writerName: string | null;
  writer: { id: string; name: string } | null;
  /** "aprovado" só para plano aprovacao_cliente + APROVADO no documento */
  clientApproval: "aprovado" | null;
  /** pendência criada junto (stand-by, ou aguardando material vinculada ao post) */
  pendingKind: "stand_by" | "aguardando_material" | null;
  action: ImportAction;
  conflictWith: ImportConflict | null;
};

export type ImportWarningCode =
  | "documento"
  | "credencial"
  | "redatora"
  | "conflito"
  | "cronograma"
  | "encerrar_gestao";

export type ImportWarning = { code: ImportWarningCode; line: number | null; message: string };

export type ImportSchedulePlan = {
  month: string;
  label: string;
  existing: { id: string; status: string } | null;
  /** status com que será criado (se `existing` for null) */
  statusIfCreated: ImportScheduleStatus;
  /** posts a criar neste mês */
  posts: number;
};

export type ImportWriter = {
  name: string;
  status: "matched" | "not_found" | "ambiguous";
  user: { id: string; name: string } | null;
  posts: number;
};

export type BriefingDiffEntry = {
  field: BriefingField;
  target: "client" | "briefing";
  label: string;
  current: string | null;
  proposed: string;
  /** valor atual difere do proposto */
  changed: boolean;
  /** sugestão de marcar: o campo atual está vazio */
  suggested: boolean;
};

export type ImportAnalysis = {
  refMonth: string;
  header: string | null;
  credentialDetected: boolean;
  endOfContract: boolean;
  emailSuggestion: string | null;
  hashtagsBlock: string | null;
  ignoredTemplates: number;
  client: { id: string; name: string; plan: string; agencyPublishes: boolean };
  defaultTimes: Record<PostFormat, string>;
  targets: PostTarget[];
  items: ImportItem[];
  counts: {
    posts: number;
    avulsos: number;
    standBy: number;
    toCreate: { posts: number; standBy: number; awaitingMaterial: number };
    conflicts: number;
    excluded: number;
    invalid: number;
  };
  schedules: ImportSchedulePlan[];
  writers: ImportWriter[];
  briefing: BriefingDiffEntry[];
  warnings: ImportWarning[];
};

export type ImportCommitResult = {
  created: { posts: number; schedules: number; pendingItems: number; standBy: number; awaitingMaterial: number };
  skipped: { conflicts: number; excluded: number; invalid: number };
  schedules: { month: string; label: string; id: string; status: string; created: boolean }[];
  posts: { line: number; id: string; scheduledAt: string; format: PostFormat; theme: string }[];
  pendingItems: { id: string; kind: "stand_by" | "aguardando_material"; title: string; postId: string | null }[];
  briefingUpdated: BriefingField[];
  credentialDetected: boolean;
  endOfContract: boolean;
  warnings: ImportWarning[];
};

/** Cliente não existe (a rota responde 404). */
export class ImportClientNotFoundError extends Error {
  constructor() {
    super("Cliente não encontrado");
  }
}

// ------------------------------------------------------------ utilidades de mês / dia

/** monthRef (@db.Date) do mês "AAAA-MM", no mesmo padrão de calendar/commit e basic-plan. */
export function monthRefOf(monthKey: string): Date {
  return new Date(`${monthKey}-01T00:00:00-03:00`);
}

/** "AAAA-MM" de um monthRef lido do banco (meia-noite UTC; N-03). */
export function monthKeyOfRef(monthRef: Date): string {
  return monthRef.toISOString().slice(0, 7);
}

/** "AAAA-MM-DD" do dia em SP. */
function spDayKey(d: Date): string {
  return spLocalInputFromISO(d).slice(0, 10);
}

/**
 * Legenda importada por rede alvo do post ({instagram, facebook, …}), no mesmo
 * formato que o editor e a IA gravam: telas e publicador leem
 * `captions[rede] ?? caption`. Sem legenda → null (a coluna fica vazia).
 */
function captionsForTargets(
  caption: string | null | undefined,
  targets: readonly string[]
): Partial<Record<PostTarget, string>> | null {
  if (!caption) return null;
  const out: Partial<Record<PostTarget, string>> = {};
  for (const t of targets) if ((POST_TARGETS as readonly string[]).includes(t)) out[t as PostTarget] = caption;
  return Object.keys(out).length > 0 ? out : null;
}

/** Redes padrão: as das contas do cliente; sem contas, IG + FB (fase 1). */
export function defaultTargetsFor(platforms: readonly string[]): PostTarget[] {
  const found = [...new Set(platforms)].filter((p): p is PostTarget =>
    (POST_TARGETS as readonly string[]).includes(p)
  );
  return found.length > 0 ? found : ["instagram", "facebook"];
}

/**
 * Cronograma do cliente no mês civil: o existente (o mais antigo) ou um novo
 * com o status pedido. Usado pelo commit da importação e pelo convert.
 */
export async function findOrCreateMonthSchedule(
  db: Db,
  clientId: string,
  monthKey: string,
  statusIfCreated: ImportScheduleStatus
): Promise<{ id: string; status: string; created: boolean }> {
  const monthRef = monthRefOf(monthKey);
  const existing = await db.schedule.findFirst({
    where: { clientId, monthRef },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true },
  });
  if (existing) return { ...existing, created: false };
  const created = await db.schedule.create({
    data: {
      clientId,
      monthRef,
      status: statusIfCreated,
      ...(statusIfCreated === "aprovado_cliente" ? { approvedAt: new Date() } : {}),
    },
    select: { id: true, status: true },
  });
  return { ...created, created: true };
}

/** Forma de uma pendência nas respostas de `api/pending-items/**` (S32). */
export const pendingItemInclude = {
  client: { select: { id: true, name: true } },
  responsible: { select: { id: true, name: true } },
  post: { select: { id: true, theme: true, scheduledAt: true, status: true, format: true } },
} satisfies Prisma.PendingItemInclude;

const normTitle = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Título gravado na pendência (e usado na deduplicação do stand-by). */
const pendingTitleOf = (p: { title: string; kindLabel: string }) =>
  (p.title || p.kindLabel || "Stand-by").slice(0, 200);

const asText = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

// ------------------------------------------------------------ análise (sem escrita)

const clientSelect = {
  id: true,
  name: true,
  plan: true,
  agencyPublishes: true,
  responsibleUserId: true,
  briefing: true,
  tradeName: true,
  facebookUrl: true,
  instagramUrl: true,
  website: true,
  city: true,
  phone: true,
  socialAccounts: { select: { platform: true } },
} satisfies Prisma.ClientSelect;

type ClientRow = Prisma.ClientGetPayload<{ select: typeof clientSelect }>;

type Analysis = ImportAnalysis & { clientRow: ClientRow; proposedBriefing: Map<BriefingField, string> };

async function analyze(db: Db, clientId: string, input: ImportInput): Promise<Analysis> {
  const opts = input.options ?? {};
  const clientRow = await db.client.findUnique({ where: { id: clientId }, select: clientSelect });
  if (!clientRow) throw new ImportClientNotFoundError();

  const users = await db.user.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } });

  // defesa em profundidade: o navegador já removeu; o servidor remove de novo
  const stripped = stripCredentials(input.text);
  const writerNames = [
    ...DEFAULT_WRITER_NAMES,
    ...users.map((u) => u.name.trim().split(/\s+/)[0] ?? "").filter((n) => n.length >= 2),
  ];
  const parsed = parseMonthlyDoc(stripped.text, {
    refMonth: input.refMonth,
    writerNames,
    defaultTimes: opts.defaultTimes,
  });
  const credentialDetected = stripped.credentialDetected || parsed.credentialDetected;
  const warnings: ImportWarning[] = [];

  if (credentialDetected) {
    warnings.push({
      code: "credencial",
      line: null,
      message:
        "O documento tinha senha ou dados de acesso. Eles foram descartados e não serão gravados. " +
        "Se precisar, cadastre o acesso em Credenciais do cliente.",
    });
  }
  for (const w of parsed.warnings) warnings.push({ code: "documento", line: w.line, message: w.message });
  if (parsed.endOfContract) {
    warnings.push({
      code: "encerrar_gestao",
      line: null,
      message:
        "O documento diz \"ENCERRAR GESTÃO\". A importação não muda o status do cliente: " +
        "se for o caso, marque-o como encerrado na edição do cliente.",
    });
  }

  // ---- redatoras: primeiro nome sem acento; mais de um usuário com o mesmo nome = ambíguo
  const usersByKey = new Map<string, { id: string; name: string }[]>();
  for (const u of users) {
    const k = firstNameKey(u.name);
    if (!k) continue;
    usersByKey.set(k, [...(usersByKey.get(k) ?? []), u]);
  }
  const all: { post: ParsedPost; kind: ImportItemKind }[] = [
    ...parsed.posts.map((post) => ({ post, kind: "post" as const })),
    ...parsed.avulsos.map((post) => ({ post, kind: "avulso" as const })),
    ...parsed.standBy.map((post) => ({ post, kind: "stand_by" as const })),
  ].sort((a, b) => a.post.line - b.post.line);

  const writerMap = new Map<string, ImportWriter>();
  for (const { post } of all) {
    if (!post.writerName) continue;
    const key = firstNameKey(post.writerName);
    const known = writerMap.get(key);
    if (known) {
      known.posts += 1;
      continue;
    }
    const matches = usersByKey.get(key) ?? [];
    const w: ImportWriter = {
      name: post.writerName,
      status: matches.length === 1 ? "matched" : matches.length === 0 ? "not_found" : "ambiguous",
      user: matches.length === 1 ? matches[0] : null,
      posts: 1,
    };
    writerMap.set(key, w);
    if (w.status === "not_found") {
      warnings.push({
        code: "redatora",
        line: post.line,
        message: `Redatora "${post.writerName}" não encontrada entre os usuários: os posts dela ficam sem redatora.`,
      });
    } else if (w.status === "ambiguous") {
      warnings.push({
        code: "redatora",
        line: post.line,
        message: `Há mais de um usuário com o nome "${post.writerName}": os posts dela ficam sem redatora.`,
      });
    }
  }
  const writers = [...writerMap.values()];

  // ---- conflitos: posts do cliente no mesmo dia SP e formato; stand-by com o mesmo título
  const dated = all.filter((x) => x.kind !== "stand_by" && x.post.date);
  const days = dated.map((x) => x.post.date as string).sort();
  const existingPosts =
    days.length > 0
      ? await db.post.findMany({
          where: {
            clientId,
            // folga de 1 dia nas pontas: o filtro fino é o dia em SP
            scheduledAt: {
              gte: new Date(Date.parse(`${days[0]}T00:00:00-03:00`) - 86_400_000),
              lt: new Date(Date.parse(`${days[days.length - 1]}T00:00:00-03:00`) + 2 * 86_400_000),
            },
          },
          select: { id: true, theme: true, scheduledAt: true, format: true, status: true },
          orderBy: { scheduledAt: "asc" },
        })
      : [];
  const postByDayFormat = new Map<string, (typeof existingPosts)[number]>();
  for (const p of existingPosts) {
    const k = `${spDayKey(p.scheduledAt)}|${p.format}`;
    if (!postByDayFormat.has(k)) postByDayFormat.set(k, p);
  }
  const existingStandBy =
    parsed.standBy.length > 0
      ? await db.pendingItem.findMany({
          where: { clientId, kind: "stand_by" },
          select: { id: true, title: true, resolvedAt: true },
        })
      : [];
  const standByByTitle = new Map(existingStandBy.map((p) => [normTitle(p.title), p]));

  const excluded = new Set(opts.exclude ?? []);
  const approvalPlan = clientRow.plan === "aprovacao_cliente";

  const items: ImportItem[] = all.map(({ post, kind }) => {
    const wKey = post.writerName ? firstNameKey(post.writerName) : null;
    const writer = wKey ? (writerMap.get(wKey)?.user ?? null) : null;
    const scheduledAt =
      kind !== "stand_by" && post.date ? spLocalInputToISO(`${post.date}T${post.time}`) : null;
    let slides = post.slides;
    if (slides.length > MAX_SLIDES) {
      warnings.push({
        code: "documento",
        line: post.line,
        message: `O post tem ${slides.length} telas; só as ${MAX_SLIDES} primeiras serão gravadas.`,
      });
      slides = slides.slice(0, MAX_SLIDES);
    }

    let action: ImportAction = "create";
    let conflictWith: ImportConflict | null = null;
    if (excluded.has(post.line)) action = "excluded";
    else if (kind === "stand_by") {
      const dup = standByByTitle.get(normTitle(pendingTitleOf(post)));
      if (dup) {
        action = "conflict";
        conflictWith = { type: "pending", id: dup.id, title: dup.title, resolved: dup.resolvedAt !== null };
      }
    } else if (!post.date || !scheduledAt) action = "invalid";
    else {
      const dup = postByDayFormat.get(`${post.date}|${post.format}`);
      if (dup) {
        action = "conflict";
        conflictWith = {
          type: "post",
          id: dup.id,
          theme: dup.theme,
          scheduledAt: dup.scheduledAt.toISOString(),
          status: dup.status,
        };
      }
    }

    return {
      line: post.line,
      kind,
      seq: post.seq,
      date: post.date,
      time: post.time,
      timeSource: post.timeSource,
      scheduledAt,
      monthKey: kind !== "stand_by" && post.date ? post.date.slice(0, 7) : null,
      format: post.format,
      kindLabel: post.kindLabel,
      title: post.title,
      slides,
      caption: post.caption,
      docStatus: post.docStatus,
      internalNote: post.internalNote,
      writerName: post.writerName,
      writer,
      clientApproval: kind !== "stand_by" && approvalPlan && post.docStatus === "aprovado" ? "aprovado" : null,
      pendingKind:
        kind === "stand_by" ? "stand_by" : post.docStatus === "aguardando_fotos" ? "aguardando_material" : null,
      action,
      conflictWith,
    };
  });

  for (const it of items) {
    if (it.action !== "conflict" || !it.conflictWith) continue;
    warnings.push({
      code: "conflito",
      line: it.line,
      message:
        it.conflictWith.type === "post"
          ? `Já existe um post ${it.format} do cliente em ${it.date}: este não será importado.`
          : `Já existe uma pendência de stand-by "${it.conflictWith.title}": esta não será importada.`,
    });
  }

  // ---- cronogramas de destino (mês civil)
  const scheduleStatus = opts.scheduleStatus ?? "rascunho";
  const perMonth = new Map<string, number>();
  for (const it of items) {
    if (it.action === "create" && it.monthKey) perMonth.set(it.monthKey, (perMonth.get(it.monthKey) ?? 0) + 1);
  }
  const schedules: ImportSchedulePlan[] = [];
  for (const [month, count] of [...perMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const existing = await db.schedule.findFirst({
      where: { clientId, monthRef: monthRefOf(month) },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true },
    });
    const label = formatMonthLabel(month);
    schedules.push({ month, label, existing, statusIfCreated: scheduleStatus, posts: count });
    if (existing && existing.status !== "rascunho" && existing.status !== "em_revisao") {
      warnings.push({
        code: "cronograma",
        line: null,
        message: `O cronograma de ${label} já existe com status "${existing.status}": os posts importados entram nele como rascunho.`,
      });
    }
  }

  // ---- briefing: proposta × atual (só campos que o documento traz)
  const proposed = new Map<BriefingField, string>();
  for (const [k, v] of Object.entries(parsed.briefing.client)) if (v?.trim()) proposed.set(k as BriefingField, v.trim());
  for (const [k, v] of Object.entries(parsed.briefing.briefing)) if (v?.trim()) proposed.set(k as BriefingField, v.trim());
  // o campo "Hashtags::" costuma vir vazio, com o bloco fixo logo abaixo
  if (!proposed.has("hashtags") && parsed.hashtagsBlock) proposed.set("hashtags", parsed.hashtagsBlock.trim());

  const currentBriefing = (clientRow.briefing ?? {}) as Record<string, unknown>;
  const briefing: BriefingDiffEntry[] = BRIEFING_FIELDS.filter((f) => proposed.has(f)).map((field) => {
    const current = isClientField(field) ? asText(clientRow[field]) : asText(currentBriefing[field]);
    const value = proposed.get(field) as string;
    return {
      field,
      target: isClientField(field) ? "client" : "briefing",
      label: BRIEFING_FIELD_LABEL[field],
      current,
      proposed: value,
      changed: current !== value,
      suggested: current === null,
    };
  });

  const creating = items.filter((i) => i.action === "create");
  warnings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));

  return {
    refMonth: parsed.refMonth,
    header: parsed.header,
    credentialDetected,
    endOfContract: parsed.endOfContract,
    emailSuggestion: parsed.briefing.emailSuggestion,
    hashtagsBlock: parsed.hashtagsBlock,
    ignoredTemplates: parsed.ignoredTemplates,
    client: {
      id: clientRow.id,
      name: clientRow.name,
      plan: clientRow.plan,
      agencyPublishes: clientRow.agencyPublishes,
    },
    defaultTimes: { ...DEFAULT_TIMES, ...opts.defaultTimes },
    targets: opts.targets?.length ? opts.targets : defaultTargetsFor(clientRow.socialAccounts.map((a) => a.platform)),
    items,
    counts: {
      posts: parsed.posts.length,
      avulsos: parsed.avulsos.length,
      standBy: parsed.standBy.length,
      toCreate: {
        posts: creating.filter((i) => i.kind !== "stand_by").length,
        standBy: creating.filter((i) => i.kind === "stand_by").length,
        awaitingMaterial: creating.filter((i) => i.pendingKind === "aguardando_material").length,
      },
      conflicts: items.filter((i) => i.action === "conflict").length,
      excluded: items.filter((i) => i.action === "excluded").length,
      invalid: items.filter((i) => i.action === "invalid").length,
    },
    schedules,
    writers,
    briefing,
    warnings,
    clientRow,
    proposedBriefing: proposed,
  };
}

/** Prévia: nada é gravado. */
export async function analyzeImport(clientId: string, input: ImportInput): Promise<ImportAnalysis> {
  const { clientRow: _row, proposedBriefing: _proposed, ...analysis } = await analyze(prisma, clientId, input);
  void _row;
  void _proposed;
  return analysis;
}

// ------------------------------------------------------------ commit (uma transação)

/** Texto da pendência de stand-by: o bloco inteiro, para a redatora retomar depois. */
function standByDetails(it: ImportItem): string {
  const parts = [`${it.kindLabel || "STAND BY"} · horário ${it.time}`];
  if (it.internalNote) parts.push(it.internalNote);
  if (it.slides.length) parts.push(it.slides.map((s, i) => `TELA ${i + 1}: ${s.text}`).join("\n"));
  if (it.caption) parts.push(`LEGENDA:\n${it.caption}`);
  return parts.join("\n\n");
}

export async function commitImport(clientId: string, input: ImportInput): Promise<ImportCommitResult> {
  return prisma.$transaction(
    async (tx) => {
      // importações simultâneas do mesmo cliente esperam a anterior (idempotência sob duplo clique)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`import-doc:${clientId}`}))`;

      const a = await analyze(tx, clientId, input);
      const opts = input.options ?? {};
      const now = new Date();
      const creating = a.items.filter((i) => i.action === "create");

      // cronogramas por mês civil
      const scheduleByMonth = new Map<string, { id: string; status: string; created: boolean }>();
      for (const s of a.schedules) {
        scheduleByMonth.set(s.month, await findOrCreateMonthSchedule(tx, clientId, s.month, s.statusIfCreated));
      }

      // posts: SEMPRE draft (o default da coluna é "scheduled")
      const createdPosts: ImportCommitResult["posts"] = [];
      const postRows: Prisma.PostCreateManyInput[] = [];
      const postIdByLine = new Map<number, string>();
      for (const it of creating) {
        if (it.kind === "stand_by" || !it.scheduledAt || !it.monthKey) continue;
        const id = randomUUID();
        const theme = (it.title || it.kindLabel).slice(0, 200);
        postIdByLine.set(it.line, id);
        createdPosts.push({ line: it.line, id, scheduledAt: it.scheduledAt, format: it.format, theme });
        const captions = captionsForTargets(it.caption, a.targets);
        postRows.push({
          id,
          clientId,
          scheduleId: scheduleByMonth.get(it.monthKey)?.id ?? null,
          theme,
          caption: it.caption || null,
          captions: captions ? (captions as Prisma.InputJsonValue) : undefined,
          slides: it.slides.length ? (it.slides as unknown as Prisma.InputJsonValue) : undefined,
          format: it.format,
          scheduledAt: new Date(it.scheduledAt),
          targets: a.targets,
          status: "draft",
          writerId: it.writer?.id ?? null,
          internalNote: it.internalNote,
          clientApproval: it.clientApproval,
          clientApprovedAt: it.clientApproval ? now : null,
        });
      }
      if (postRows.length) await tx.post.createMany({ data: postRows });

      // pendências: stand-by (sem post) e aguardando material (vinculada ao post)
      const createdPending: ImportCommitResult["pendingItems"] = [];
      const pendingRows: Prisma.PendingItemCreateManyInput[] = [];
      for (const it of creating) {
        if (!it.pendingKind) continue;
        const postId = it.pendingKind === "aguardando_material" ? (postIdByLine.get(it.line) ?? null) : null;
        if (it.pendingKind === "aguardando_material" && !postId) continue;
        const id = randomUUID();
        const title = pendingTitleOf(it);
        createdPending.push({ id, kind: it.pendingKind, title, postId });
        pendingRows.push({
          id,
          clientId,
          postId,
          kind: it.pendingKind,
          title,
          details: it.pendingKind === "stand_by" ? standByDetails(it) : it.internalNote,
          responsibleUserId: it.writer?.id ?? a.clientRow.responsibleUserId ?? null,
        });
      }
      if (pendingRows.length) await tx.pendingItem.createMany({ data: pendingRows });

      // briefing: merge só nos campos marcados, sobre o JSON atual (o PATCH substitui o JSON inteiro)
      const marked = [...new Set(opts.briefingFields ?? [])].filter((f) => a.proposedBriefing.has(f));
      if (marked.length) {
        const clientData: Prisma.ClientUpdateInput = {};
        const briefing = { ...((a.clientRow.briefing ?? {}) as Record<string, unknown>) };
        let briefingTouched = false;
        for (const f of marked) {
          const v = a.proposedBriefing.get(f) as string;
          if (isClientField(f)) clientData[f] = v;
          else {
            briefing[f] = v;
            briefingTouched = true;
          }
        }
        if (briefingTouched) clientData.briefing = briefing as Prisma.InputJsonValue;
        await tx.client.update({ where: { id: clientId }, data: clientData });
      }

      return {
        created: {
          posts: postRows.length,
          schedules: [...scheduleByMonth.values()].filter((s) => s.created).length,
          pendingItems: pendingRows.length,
          standBy: pendingRows.filter((p) => p.kind === "stand_by").length,
          awaitingMaterial: pendingRows.filter((p) => p.kind === "aguardando_material").length,
        },
        skipped: { conflicts: a.counts.conflicts, excluded: a.counts.excluded, invalid: a.counts.invalid },
        schedules: [...scheduleByMonth.entries()].map(([month, s]) => ({
          month,
          label: formatMonthLabel(month),
          ...s,
        })),
        posts: createdPosts,
        pendingItems: createdPending,
        briefingUpdated: marked,
        credentialDetected: a.credentialDetected,
        endOfContract: a.endOfContract,
        warnings: a.warnings,
      };
    },
    { maxWait: 10_000, timeout: 30_000 }
  );
}
