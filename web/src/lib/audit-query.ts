import { prisma } from "@/lib/prisma";
import { addDaysToKey, spDateFromKey } from "@/lib/deadlines";
import { formatMonthLabel } from "@/lib/format-date";
import { uuidString } from "@/lib/validators";

/**
 * Consulta e texto da tela "Registro de ações" (Administração → /auditoria) e de GET /api/audit.
 * Só leitura da tabela audit_log (lib/audit grava). Os textos são pt-BR e nunca mostram segredo
 * (o registro não guarda nenhum).
 */

/** Rótulo de cada ação conhecida (ordem = ordem do filtro). Ação desconhecida aparece crua. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "credential.reveal": "Revelou senhas de cliente",
  "credential.reveal_blocked": "Barrada no limite de revelações",
  "credential.update": "Alterou senhas de cliente",
  "client.delete": "Excluiu cliente",
  "client.account_change": "Alterou conta de publicação",
  "client.meta_link": "Vinculou Página do Meta",
  "posts.bulk_delete": "Excluiu posts em massa",
  "post.delete": "Excluiu post publicado",
  "schedule.approve_internal": "Aprovou cronograma sem o cliente",
  "user.create": "Criou usuário",
  "user.role_change": "Trocou papel de usuário",
  "user.password_change": "Trocou senha de usuário",
  "user.delete": "Excluiu usuário",
  "settings.ai_model": "Trocou o modelo de IA",
  "settings.openai_key": "Alterou a chave da OpenAI",
};

export const auditActionLabel = (action: string): string => AUDIT_ACTION_LABELS[action] ?? action;

/** Padrão e máximo por página: as últimas 200 ações. */
export const AUDIT_PAGE_SIZE = 200;

export type AuditFilters = {
  action?: string;
  actorId?: string;
  clientId?: string;
  /** "YYYY-MM-DD" (dia civil em São Paulo), inclusivo */
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
};

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const ACTION = /^[a-z_]+\.[a-z_]+$/;

const validDateKey = (v: string) => DATE_KEY.test(v) && !Number.isNaN(spDateFromKey(v).getTime());

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/**
 * Filtros da URL (?acao=&pessoa=&cliente=&de=&ate=&pagina=&limite=). Valores inválidos voltam em
 * `invalid` (a API responde 400; a tela só os ignora). Período invertido é trocado.
 */
export function parseAuditFilters(params: Params): { filters: AuditFilters; invalid: string[] } {
  const invalid: string[] = [];
  const filters: AuditFilters = { page: 1, pageSize: AUDIT_PAGE_SIZE };

  const action = one(params.acao);
  if (action) {
    if (ACTION.test(action)) filters.action = action;
    else invalid.push("acao");
  }
  for (const [key, field] of [["pessoa", "actorId"], ["cliente", "clientId"]] as const) {
    const v = one(params[key]);
    if (!v) continue;
    if (uuidString.safeParse(v).success) filters[field] = v.toLowerCase();
    else invalid.push(key);
  }
  for (const [key, field] of [["de", "from"], ["ate", "to"]] as const) {
    const v = one(params[key]);
    if (!v) continue;
    if (validDateKey(v)) filters[field] = v;
    else invalid.push(key);
  }
  if (filters.from && filters.to && filters.from > filters.to) [filters.from, filters.to] = [filters.to, filters.from];

  const page = one(params.pagina);
  if (page) {
    const n = Number(page);
    if (Number.isInteger(n) && n >= 1 && n <= 100_000) filters.page = n;
    else invalid.push("pagina");
  }
  const limit = one(params.limite);
  if (limit) {
    const n = Number(limit);
    if (Number.isInteger(n) && n >= 1 && n <= AUDIT_PAGE_SIZE) filters.pageSize = n;
    else invalid.push("limite");
  }
  return { filters, invalid };
}

/** `where` do Prisma para os filtros (exportado para teste). */
export function auditWhere(f: AuditFilters) {
  const at: { gte?: Date; lt?: Date } = {};
  if (f.from) at.gte = spDateFromKey(f.from);
  if (f.to) at.lt = spDateFromKey(addDaysToKey(f.to, 1));
  return {
    ...(f.action ? { action: f.action } : {}),
    ...(f.actorId ? { actorId: f.actorId } : {}),
    ...(f.clientId ? { clientId: f.clientId } : {}),
    ...(at.gte || at.lt ? { at } : {}),
  };
}

export type AuditItem = {
  id: string;
  at: string;
  action: string;
  actionLabel: string;
  actorId: string | null;
  /** nome atual da pessoa; se ela foi excluída, o e-mail gravado no registro */
  actorName: string | null;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  clientId: string | null;
  /** nome atual do cliente; se ele foi excluído, o nome gravado no registro */
  clientName: string | null;
  clientDeleted: boolean;
  summary: string;
  meta: Record<string, unknown> | null;
  ip: string | null;
};

export type AuditPage = { items: AuditItem[]; total: number; page: number; pageSize: number; totalPages: number };

/** Página de eventos, do mais recente ao mais antigo. */
export async function listAuditEvents(f: AuditFilters): Promise<AuditPage> {
  const where = auditWhere(f);
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: [{ at: "desc" }, { id: "desc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      select: {
        id: true,
        at: true,
        action: true,
        actorId: true,
        actorEmail: true,
        targetType: true,
        targetId: true,
        clientId: true,
        meta: true,
        ip: true,
        actor: { select: { name: true } },
      },
    }),
  ]);
  const clientIds = [...new Set(rows.map((r) => r.clientId).filter((v): v is string => !!v))];
  const clients = clientIds.length
    ? await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } })
    : [];
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  const items = rows.map((r): AuditItem => {
    const meta = r.meta && typeof r.meta === "object" && !Array.isArray(r.meta) ? (r.meta as Record<string, unknown>) : null;
    const current = r.clientId ? clientName.get(r.clientId) : undefined;
    const recorded = typeof meta?.clientName === "string" ? meta.clientName : null;
    return {
      id: r.id,
      at: r.at.toISOString(),
      action: r.action,
      actionLabel: auditActionLabel(r.action),
      actorId: r.actorId,
      actorName: r.actor?.name ?? null,
      actorEmail: r.actorEmail,
      targetType: r.targetType,
      targetId: r.targetId,
      clientId: r.clientId,
      clientName: current ?? recorded,
      clientDeleted: !!r.clientId && current === undefined,
      summary: describeAuditEvent(r.action, meta),
      meta,
      ip: r.ip,
    };
  });
  return { items, total, page: f.page, pageSize: f.pageSize, totalPages: Math.max(1, Math.ceil(total / f.pageSize)) };
}

// ------------------------------------------------------------ texto dos detalhes

const PLATFORM: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn" };
const STATUS_WORD: Record<string, [string, string]> = {
  draft: ["rascunho", "rascunhos"],
  scheduled: ["agendado", "agendados"],
  published: ["publicado", "publicados"],
  failed: ["com falha", "com falha"],
};
const ROLE: Record<string, string> = { admin: "Administrador", staff: "Equipe" };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const platform = (v: unknown) => PLATFORM[str(v) ?? ""] ?? str(v) ?? "rede";
const role = (v: unknown) => ROLE[str(v) ?? ""] ?? str(v) ?? "?";

function modelText(v: unknown): string {
  if (!v || typeof v !== "object") return "Padrão do sistema";
  const m = v as { provider?: unknown; model?: unknown };
  const model = str(m.model);
  if (!model) return "Padrão do sistema";
  return `${str(m.provider) === "openai" ? "ChatGPT" : "Gemini"} ${model}`;
}

function accountChange(meta: Record<string, unknown>): string {
  const p = platform(meta.platform);
  const ext = str(meta.externalId);
  switch (meta.op) {
    case "create":
      return `Conta ${p} adicionada${ext ? ` (${ext})` : ""}`;
    case "reconnect":
      return `Conta ${p} reconectada${ext ? ` (${ext})` : ""}`;
    case "delete":
      return `Conta ${p} excluída${ext ? ` (${ext})` : ""}`;
    case "update": {
      const c = (meta.changes && typeof meta.changes === "object" ? meta.changes : {}) as Record<string, unknown>;
      const parts: string[] = [];
      const fromTo = (k: string, label: string, map: (v: unknown) => string = (v) => String(v)) => {
        const x = c[k] as { from?: unknown; to?: unknown } | undefined;
        if (x && typeof x === "object") parts.push(`${label} ${map(x.from)} → ${map(x.to)}`);
      };
      if (c.tokenReplaced) parts.push("token trocado");
      fromTo("externalId", "ID");
      fromTo("status", "status", (v) => (v === "active" ? "ativa" : v === "inactive" ? "inativa" : String(v)));
      fromTo("dailyPostLimit", "limite diário");
      if (c.tokenExpiresAtChanged) parts.push("validade do token alterada");
      return `Conta ${p}${ext ? ` (${ext})` : ""}: ${parts.length ? parts.join(", ") : "salva sem mudanças"}`;
    }
    default:
      return `Conta ${p}`;
  }
}

/** Uma linha pt-BR com o que aconteceu (contagens, redes, de → para). Nunca segredo. */
export function describeAuditEvent(action: string, meta: Record<string, unknown> | null): string {
  const m = meta ?? {};
  switch (action) {
    case "credential.reveal": {
      const nets = list(m.networks);
      return nets.length ? `Redes: ${nets.join(", ")}` : "Nenhuma credencial salva";
    }
    case "credential.reveal_blocked":
      return `Chegou ao limite de ${num(m.limit) ?? "?"} revelações por hora`;
    case "credential.update": {
      if (m.previousUnreadable) return `Redes gravadas: ${list(m.networks).join(", ") || "nenhuma"}`;
      const parts = [
        list(m.added).length ? `incluídas: ${list(m.added).join(", ")}` : "",
        list(m.changed).length ? `alteradas: ${list(m.changed).join(", ")}` : "",
        list(m.removed).length ? `removidas: ${list(m.removed).join(", ")}` : "",
      ].filter(Boolean);
      const text = parts.join(" · ") || "nenhuma rede mudou";
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
    case "client.delete": {
      const posts = num(m.posts) ?? 0;
      const published = num(m.publishedPosts) ?? 0;
      return [
        `${plural(posts, "post", "posts")}${published ? ` (${plural(published, "publicado", "publicados")})` : ""}`,
        plural(num(m.schedules) ?? 0, "cronograma", "cronogramas"),
        plural(num(m.accounts) ?? 0, "conta", "contas"),
      ].join(", ");
    }
    case "client.account_change":
      return accountChange(m);
    case "client.meta_link": {
      const nets = list(m.connected).map(platform);
      return `Página “${str(m.pageName) ?? str(m.pageId) ?? "?"}”${nets.length ? ` → ${nets.join(" + ")}` : ""}`;
    }
    case "posts.bulk_delete": {
      const deleted = num(m.deleted) ?? 0;
      const by = (m.byStatus && typeof m.byStatus === "object" ? m.byStatus : {}) as Record<string, unknown>;
      const parts = Object.entries(by)
        .filter(([, n]) => typeof n === "number" && n > 0)
        .map(([s, n]) => `${n} ${STATUS_WORD[s]?.[(n as number) === 1 ? 0 : 1] ?? s}`);
      return `${plural(deleted, "post excluído", "posts excluídos")}${parts.length ? `: ${parts.join(", ")}` : ""}`;
    }
    case "post.delete":
      return `Post publicado${str(m.theme) ? ` “${str(m.theme)}”` : ""}`;
    case "schedule.approve_internal": {
      const month = str(m.monthRef);
      const queued = num(m.queued) ?? 0;
      return `${month ? `Cronograma de ${formatMonthLabel(month)}` : "Cronograma"} · ${
        m.noPublish ? "cliente só produção (nada entra na fila)" : `${plural(queued, "post", "posts")} na fila`
      }`;
    }
    case "settings.ai_model":
      return `De ${modelText(m.from)} para ${modelText(m.to)}`;
    case "settings.openai_key":
      return m.op === "removed"
        ? `Chave removida${m.modelReset ? "; o modelo voltou ao padrão do sistema" : ""}`
        : m.op === "replaced"
          ? "Chave substituída"
          : "Chave salva";
    default: {
      // ações de usuários (e futuras): pessoa-alvo e papel, quando houver
      const parts: string[] = [];
      const who = str(m.name) ?? str(m.targetName) ?? str(m.email) ?? str(m.targetEmail);
      if (who) parts.push(who);
      const from = m.from ?? m.oldRole ?? m.fromRole;
      const to = m.to ?? m.newRole ?? m.toRole ?? m.role;
      if (from !== undefined && to !== undefined) parts.push(`papel ${role(from)} → ${role(to)}`);
      else if (to !== undefined && action === "user.create") parts.push(`papel ${role(to)}`);
      return parts.join(" · ");
    }
  }
}
