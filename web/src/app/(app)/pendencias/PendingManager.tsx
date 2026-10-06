"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { DateTimePicker } from "@/components/DatePickers";
import { ConfirmDialog, Dialog } from "@/components/Dialog";
import { Field, Input, Select, Textarea } from "@/components/Field";
import { FormatPicker } from "@/components/FormatPicker";
import { Icon } from "@/components/Icons";
import { Popover } from "@/components/Popover";
import { Toast, type ToastState } from "@/components/Toast";
import { SegmentedControl } from "@/components/Toggle";
import { EmptyState, PageHeader, StatusBadge, ToneBadge } from "@/components/ui";
import { addDaysKey, spDateKey } from "@/lib/date-range";
import { spLocalInputToISO, TZ } from "@/lib/format-date";
import { isPostFormat, type PostFormat } from "@/lib/formats";
import { PENDING_KIND, PENDING_KINDS, type PendingKind } from "@/lib/status-meta";
import { toUserMessage } from "@/lib/user-facing-error";

/*
 * Pendências & Stand-by (S32, DESIGN g.3) [RD §2.2.5, §6 tela 5]: o que no
 * documento mensal ficava no fim e era esquecido (STAND BY sem data, AGUARDANDO
 * FOTOS, POST AVULSO). Filtros na URL; ações pela API do S18 e depois
 * `router.refresh()`. Feedback de canal único: erro de ação feita num diálogo
 * aparece dentro dele; Resolver/Reabrir (sem diálogo) é otimista e usa Toast.
 */

/* ------------------------------------------------------------------ *
 * Tipos (o servidor monta as linhas; datas já calculadas no fuso SP)
 * ------------------------------------------------------------------ */

/** Filtros já validados pelo servidor ("" = sem filtro). */
export type PendingFilterValues = {
  /** id do cliente (`?cliente=`) */
  cliente: string;
  tipo: "" | PendingKind;
  /** id do usuário responsável */
  responsavel: string;
  situacao: "abertas" | "resolvidas";
};

export type PendingRow = {
  id: string;
  kind: string;
  title: string;
  details: string | null;
  client: { id: string; name: string };
  responsible: { id: string; name: string } | null;
  /** post vinculado: `label` = "12/10 · Carrossel" */
  post: { id: string; label: string; dateLabel: string } | null;
  resolved: boolean;
  /** "Resolvida em 12/10" */
  resolvedLabel: string | null;
  /** dias civis (SP) desde a criação */
  ageDays: number;
  /** "hoje" · "há 1 dia" · "há N dias" */
  ageLabel: string;
  /** aberta há mais de 30 dias */
  stale: boolean;
};

type Option = { id: string; name: string };

type FormField = "clientId" | "kind" | "title" | "details" | "responsibleUserId";
type FieldErrors = Partial<Record<FormField, string>>;
type Failure = { message: string; fields: FieldErrors };
type SendResult = { ok: true; data: unknown } | { ok: false; failure: Failure };

type DialogState =
  | { type: "create" }
  | { type: "edit"; row: PendingRow }
  | { type: "convert"; row: PendingRow }
  | { type: "delete"; row: PendingRow }
  | null;

/* ------------------------------------------------------------------ *
 * URL, textos e chamadas à API
 * ------------------------------------------------------------------ */

/** Link solto (fora de frase) com alvo ≥ 40 px (DESIGN, A11y "Alvos"). */
const LOOSE_LINK = "inline-flex min-h-11 items-center sm:min-h-10";

const SITUACAO_OPTIONS = [
  { value: "abertas", label: "Abertas" },
  { value: "resolvidas", label: "Resolvidas" },
] as const;

const TARGETS = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
] as const;
type Target = (typeof TARGETS)[number]["id"];

/** Data padrão do rascunho: amanhã às 18:00 (SP), o horário do cronograma (A18). */
function defaultWhen(): string {
  return `${addDaysKey(spDateKey(), 1)}T18:00`;
}

function hrefFor(v: PendingFilterValues): string {
  const params = new URLSearchParams();
  if (v.cliente) params.set("cliente", v.cliente);
  if (v.tipo) params.set("tipo", v.tipo);
  if (v.responsavel) params.set("responsavel", v.responsavel);
  if (v.situacao === "resolvidas") params.set("situacao", "resolvidas");
  const qs = params.toString();
  return qs ? `/pendencias?${qs}` : "/pendencias";
}

function cleared(v: PendingFilterValues): PendingFilterValues {
  return { cliente: "", tipo: "", responsavel: "", situacao: v.situacao };
}

/** Quantos filtros (fora a situação) estão em uso. */
function activeCount(v: PendingFilterValues): number {
  return [v.cliente, v.tipo, v.responsavel].filter(Boolean).length;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function isPendingKind(v: string): v is PendingKind {
  return (PENDING_KINDS as readonly string[]).includes(v);
}

/**
 * "Converter em post" é a ação natural (botão visível no lugar de "Resolver", U-16) do Post avulso
 * aberto e ainda sem post. Com post vinculado não há o que converter (a API recusa com 409).
 */
function convertIsPrimary(row: PendingRow): boolean {
  return !row.resolved && !row.post && row.kind === "avulso";
}

function isFormField(v: string): v is FormField {
  return v === "clientId" || v === "kind" || v === "title" || v === "details" || v === "responsibleUserId";
}

/** Termina a frase com ponto (as mensagens da API vêm sem). */
function sentence(s: string): string {
  const t = s.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/** "12/10" no fuso SP. */
const DAY_MONTH = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });

/** Campo apontado pelo zod do S18 → texto pt-BR desta tela (N-14: nunca o texto do zod). */
const FIELD_MESSAGE: Record<FormField, string> = {
  clientId: "Escolha um cliente da lista.",
  kind: "Escolha um tipo da lista.",
  title: "Informe um título com até 200 caracteres.",
  details: "Os detalhes passam do limite de 10.000 caracteres.",
  responsibleUserId: "Escolha um responsável da lista.",
};

/** Erros em texto do S18 que apontam um campo do formulário. */
const STRING_FIELD: Record<string, FormField> = {
  "Cliente não encontrado": "clientId",
  "Responsável não encontrado": "responsibleUserId",
};

const NETWORK_ERROR = "Não foi possível falar com o servidor. Verifique a conexão e tente de novo.";

async function readFailure(res: Response, fallback: string): Promise<Failure> {
  const body: unknown = await res.json().catch(() => null);
  const obj = body && typeof body === "object" ? (body as { error?: unknown; field?: unknown }) : {};
  if (res.status === 401) return { message: "Sua sessão expirou. Entre de novo para continuar.", fields: {} };
  if (typeof obj.error === "string") {
    const message = sentence(toUserMessage(obj.error, fallback));
    const key = typeof obj.field === "string" && isFormField(obj.field) ? obj.field : STRING_FIELD[obj.error];
    return { message, fields: key ? { [key]: message } : {} };
  }
  // 400 do zod: { error: { formErrors, fieldErrors } } em inglês → só os campos, com o texto da tela
  const fieldErrors =
    obj.error && typeof obj.error === "object" ? (obj.error as { fieldErrors?: unknown }).fieldErrors : undefined;
  const fields: FieldErrors = {};
  if (fieldErrors && typeof fieldErrors === "object") {
    for (const key of Object.keys(fieldErrors)) if (isFormField(key)) fields[key] = FIELD_MESSAGE[key];
  }
  return { message: Object.keys(fields).length > 0 ? "Confira os campos destacados." : fallback, fields };
}

async function send(url: string, method: string, body: unknown, fallback: string): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, failure: { message: NETWORK_ERROR, fields: {} } };
  }
  if (!res.ok) return { ok: false, failure: await readFailure(res, fallback) };
  return { ok: true, data: await res.json().catch(() => null) };
}

/* ------------------------------------------------------------------ *
 * Tela
 * ------------------------------------------------------------------ */

export default function PendingManager({
  rows,
  values,
  clients,
  users,
  truncated,
}: {
  rows: PendingRow[];
  values: PendingFilterValues;
  clients: Option[];
  users: Option[];
  /** a lista bateu no teto de 500 itens */
  truncated: boolean;
}) {
  const router = useRouter();
  const [navPending, startNav] = useTransition();
  const [, startRefresh] = useTransition();
  const go = (href: string) => startNav(() => router.push(href, { scroll: false }));
  const refresh = () => startRefresh(() => router.refresh());

  // Resolver/Reabrir otimista: o item sai da lista na hora e volta se a API falhar.
  // Com dados novos do servidor, só ficam escondidos os que ainda estão na lista
  // (pedido em andamento); trocar de filtro zera.
  const filterKey = hrefFor(values);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [seen, setSeen] = useState({ rows, filterKey });
  if (seen.rows !== rows || seen.filterKey !== filterKey) {
    const present = new Set(rows.map((r) => r.id));
    setSeen({ rows, filterKey });
    setHidden(seen.filterKey !== filterKey ? new Set() : new Set([...hidden].filter((id) => present.has(id))));
  }
  const visible = rows.filter((r) => !hidden.has(r.id));

  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuAnchorRef = useRef<HTMLElement | null>(null);
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const menuRow = menuFor ? visible.find((r) => r.id === menuFor) : undefined;
  const menuId = useId();

  const resolvedView = values.situacao === "resolvidas";
  const filtered = activeCount(values) > 0;
  const staleCount = visible.filter((r) => r.stale).length;

  function toggleMenu(id: string, el: HTMLElement) {
    if (menuFor === id) {
      setMenuFor(null);
      return;
    }
    menuAnchorRef.current = el;
    setMenuFor(id);
  }

  /** Fecha o menu e abre o diálogo; o foco volta ao "Mais ações" quando o diálogo fechar. */
  function openFromMenu(next: Exclude<DialogState, null>) {
    setMenuFor(null);
    menuAnchorRef.current?.focus();
    setDialog(next);
  }

  /** Depois de tirar uma linha da lista, o foco vai para a ação da linha vizinha (ou "Nova pendência"). */
  function moveFocusAfterRemoval(id: string) {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !active.closest(`[data-row="${id}"]`)) return;
    const index = visible.findIndex((r) => r.id === id);
    const neighbor = visible[index + 1] ?? visible[index - 1];
    requestAnimationFrame(() => {
      const candidates = neighbor
        ? Array.from(document.querySelectorAll<HTMLElement>(`[data-row-action="${neighbor.id}"]`))
        : [];
      const target = candidates.find((el) => el.getClientRects().length > 0) ?? newButtonRef.current;
      target?.focus();
    });
  }

  async function setResolved(row: PendingRow, resolved: boolean) {
    moveFocusAfterRemoval(row.id);
    setHidden((prev) => new Set(prev).add(row.id));
    const result = await send(
      `/api/pending-items/${row.id}`,
      "PATCH",
      { resolved },
      "Tente de novo em instantes.",
    );
    if (!result.ok) {
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      setToast({
        kind: "error",
        text: `Não foi possível ${resolved ? "resolver" : "reabrir"} «${row.title}». ${result.failure.message}`,
      });
      return;
    }
    setToast(
      resolved
        ? {
            kind: "success",
            text: "Pendência resolvida.",
            action: { label: "Ver resolvidas", href: hrefFor({ ...values, situacao: "resolvidas" }) },
          }
        : {
            kind: "success",
            text: "Pendência reaberta.",
            action: { label: "Ver abertas", href: hrefFor({ ...values, situacao: "abertas" }) },
          },
    );
    refresh();
  }

  function afterCreate(item: { clientId: string; kind: string; responsibleUserId: string | null }) {
    setDialog(null);
    const hiddenByFilters =
      resolvedView ||
      (!!values.cliente && values.cliente !== item.clientId) ||
      (!!values.tipo && values.tipo !== item.kind) ||
      (!!values.responsavel && values.responsavel !== item.responsibleUserId);
    setToast(
      hiddenByFilters
        ? {
            kind: "success",
            text: "Pendência criada. Ela não aparece com os filtros atuais.",
            action: {
              label: "Ver pendências do cliente",
              href: hrefFor({ ...cleared(values), cliente: item.clientId, situacao: "abertas" }),
            },
          }
        : { kind: "success", text: "Pendência criada." },
    );
    refresh();
  }

  const newButton = (
    <Button ref={newButtonRef} variant="primary" leadingIcon={<Icon.plus />} onClick={() => setDialog({ type: "create" })}>
      Nova pendência
    </Button>
  );

  const listLabel = resolvedView ? "Pendências resolvidas" : "Pendências abertas";
  const countText = resolvedView
    ? plural(visible.length, "pendência resolvida", "pendências resolvidas")
    : plural(visible.length, "pendência aberta", "pendências abertas");

  return (
    <>
      <PageHeader title="Pendências" subtitle="Itens sem data, aguardando material ou avulsos" action={newButton} />

      <PendingFilters
        values={values}
        clients={clients}
        users={users}
        go={go}
        dialogOpen={filtersOpen}
        onDialogOpenChange={setFiltersOpen}
      />

      <div aria-busy={navPending || undefined} className="relative">
        {navPending && <div aria-hidden="true" className="absolute inset-x-0 -top-2 z-10 h-0.5 rounded-full bg-brand" />}
        <div className={`transition-opacity duration-(--sf-dur-fast) ${navPending ? "opacity-60" : ""}`}>
          {visible.length === 0 ? (
            filtered ? (
              <EmptyState
                headingLevel={2}
                icon={<Icon.inbox />}
                title="Nenhuma pendência com esses filtros"
                description="Mude ou limpe os filtros para ver outras pendências."
                action={
                  <Button variant="secondary" onClick={() => go(hrefFor(cleared(values)))}>
                    Limpar filtros
                  </Button>
                }
              />
            ) : resolvedView ? (
              <EmptyState
                headingLevel={2}
                icon={<Icon.inbox />}
                title="Nenhuma pendência resolvida"
                description="As pendências resolvidas ou convertidas em post aparecem aqui."
                action={
                  <Button variant="secondary" onClick={() => go(hrefFor({ ...values, situacao: "abertas" }))}>
                    Ver abertas
                  </Button>
                }
              />
            ) : (
              <EmptyState
                headingLevel={2}
                icon={<Icon.inbox />}
                title="Nenhuma pendência aberta"
                description="Stand-by, material aguardado e posts avulsos aparecem aqui."
                action={
                  <Button variant="primary" leadingIcon={<Icon.plus />} onClick={() => setDialog({ type: "create" })}>
                    Nova pendência
                  </Button>
                }
              />
            )
          ) : (
            <>
              <p className="mb-3 text-sm text-fg-muted">
                {countText}
                {!resolvedView && staleCount > 0 && (
                  <>
                    {" · "}
                    <span className="font-medium text-warning-fg">
                      {plural(staleCount, "parada", "paradas")} há mais de 30 dias
                    </span>
                  </>
                )}
                {truncated && " · mostrando as 500 primeiras"}
              </p>

              {/* ≥ lg: tabela. Cabe inteira a 1440; entre 1024 e ~1400 rola na horizontal dentro do
                  próprio contêiner (rolagem declarada), nunca a página. */}
              <div
                role="region"
                aria-label={listLabel}
                tabIndex={0}
                // relative: os textos sr-only (absolutos) ficam presos à rolagem do contêiner, não da página
                className="card relative hidden overflow-x-auto lg:block"
              >
                <table className="w-full text-sm">
                  <caption className="sr-only">{listLabel}</caption>
                  <thead className="bg-sunken">
                    <tr>
                      {["Cliente", "Tipo", "Pendência", "Post", "Responsável", resolvedView ? "Resolvida" : "Aberta há"].map(
                        (h) => (
                          <th
                            key={h}
                            scope="col"
                            className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-overline text-fg-muted first:pl-4"
                          >
                            {h}
                          </th>
                        ),
                      )}
                      <th scope="col" className="py-3 pl-3 pr-4">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr key={row.id} data-row={row.id} className="border-t border-line align-top">
                        <td className="py-2 pl-4 pr-3">
                          <Link
                            href={`/clients/${row.client.id}`}
                            title={row.client.name}
                            className={`${LOOSE_LINK} font-medium text-fg hover:text-link`}
                          >
                            {/* largura própria: na tabela automática a coluna não encolhe até cortar o nome */}
                            <span className="line-clamp-2 w-28 wrap-break-word">{row.client.name}</span>
                          </Link>
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge kind="pending" status={row.kind} />
                        </td>
                        <td className="px-3 py-3">
                          <div className="min-w-40">
                            <ItemText row={row} />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <PostLink row={row} />
                        </td>
                        <td className="px-3 py-3">
                          <Responsible row={row} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <Age row={row} />
                        </td>
                        <td className="py-2 pl-3 pr-4">
                          <RowActions
                            row={row}
                            menuOpen={menuFor === row.id}
                            menuId={menuId}
                            onResolve={() => setResolved(row, !row.resolved)}
                            onConvert={() => setDialog({ type: "convert", row })}
                            onMenu={(el) => toggleMenu(row.id, el)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* < lg: cartões */}
              <ul
                aria-label={listLabel}
                className="grid gap-3 lg:hidden"
              >
                {visible.map((row) => (
                  <li key={row.id} data-row={row.id} className="card grid gap-2 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <Link
                        href={`/clients/${row.client.id}`}
                        className={`${LOOSE_LINK} min-w-0 text-sm font-medium text-fg-muted hover:text-link`}
                      >
                        <span className="min-w-0 wrap-break-word">{row.client.name}</span>
                      </Link>
                      <StatusBadge kind="pending" status={row.kind} />
                    </div>
                    <ItemText row={row} large />
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
                      <Age row={row} />
                      {row.responsible && <Responsible row={row} />}
                      {row.post && (
                        <span className="inline-flex items-center gap-1">
                          Post: <PostLink row={row} />
                        </span>
                      )}
                    </div>
                    <RowActions
                      row={row}
                      menuOpen={menuFor === row.id}
                      menuId={menuId}
                      onResolve={() => setResolved(row, !row.resolved)}
                      onConvert={() => setDialog({ type: "convert", row })}
                      onMenu={(el) => toggleMenu(row.id, el)}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* Menu "Mais ações" (um Popover para todas as linhas) */}
      <Popover
        key={menuFor ?? "fechado"}
        open={!!menuRow}
        onOpenChange={(open) => {
          if (!open) setMenuFor(null);
        }}
        anchorRef={menuAnchorRef}
        placement="bottom-end"
        id={menuId}
        aria-label={menuRow ? `Ações: ${menuRow.title}` : "Ações"}
        className="w-60 p-1.5"
      >
        {menuRow && (
          <div className="grid gap-0.5">
            <MenuButton icon={<Icon.edit />} onClick={() => openFromMenu({ type: "edit", row: menuRow })}>
              Editar
            </MenuButton>
            {convertIsPrimary(menuRow) ? (
              // a linha mostra "Converter em post"; o "Resolver" fica aqui (U-16)
              <MenuButton
                icon={<Icon.check />}
                onClick={() => {
                  setMenuFor(null);
                  menuAnchorRef.current?.focus();
                  void setResolved(menuRow, true);
                }}
              >
                Resolver
              </MenuButton>
            ) : (
              !menuRow.resolved &&
              !menuRow.post && (
                <MenuButton icon={<Icon.calendar />} onClick={() => openFromMenu({ type: "convert", row: menuRow })}>
                  Converter em post
                </MenuButton>
              )
            )}
            <MenuButton icon={<Icon.trash />} danger onClick={() => openFromMenu({ type: "delete", row: menuRow })}>
              Excluir
            </MenuButton>
          </div>
        )}
      </Popover>

      {dialog && (dialog.type === "create" || dialog.type === "edit") && (
        <ItemFormDialog
          row={dialog.type === "edit" ? dialog.row : null}
          defaults={{ clientId: values.cliente, kind: values.tipo || "stand_by", responsibleUserId: values.responsavel }}
          clients={clients}
          users={users}
          onClose={() => setDialog(null)}
          onCreated={afterCreate}
          onSaved={() => {
            setDialog(null);
            setToast({ kind: "success", text: "Alterações salvas." });
            refresh();
          }}
        />
      )}

      {dialog?.type === "convert" && (
        <ConvertDialog
          row={dialog.row}
          onClose={() => setDialog(null)}
          onConverted={({ postId, dateLabel }) => {
            setDialog(null);
            setToast({
              kind: "success",
              text: `Rascunho criado para ${dateLabel}.`,
              action: { label: "Abrir post", href: `/posts/${postId}` },
            });
            refresh();
          }}
        />
      )}

      {dialog?.type === "delete" && (
        <DeleteDialog
          row={dialog.row}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            setToast({ kind: "success", text: "Pendência excluída." });
            refresh();
          }}
        />
      )}

      {/* canal único: nada de Toast com diálogo aberto (fica para quando ele fechar) */}
      <Toast toast={dialog || filtersOpen ? null : toast} onClose={() => setToast(null)} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Filtros
 * ------------------------------------------------------------------ */

function FilterSelects({
  values,
  clients,
  users,
  onChange,
  size,
  fieldClassName = "",
}: {
  values: PendingFilterValues;
  clients: Option[];
  users: Option[];
  onChange: (next: PendingFilterValues) => void;
  size: "sm" | "md";
  fieldClassName?: string;
}) {
  return (
    <>
      <Field label="Cliente" className={fieldClassName}>
        <Select size={size} value={values.cliente} onChange={(e) => onChange({ ...values, cliente: e.target.value })}>
          <option value="">Todos os clientes</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Tipo" className={fieldClassName}>
        <Select
          size={size}
          value={values.tipo}
          onChange={(e) => onChange({ ...values, tipo: isPendingKind(e.target.value) ? e.target.value : "" })}
        >
          <option value="">Todos os tipos</option>
          {PENDING_KINDS.map((k) => (
            <option key={k} value={k}>
              {PENDING_KIND[k].label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Responsável" className={fieldClassName}>
        <Select
          size={size}
          value={values.responsavel}
          onChange={(e) => onChange({ ...values, responsavel: e.target.value })}
        >
          <option value="">Todos</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

/**
 * ≥ md: Selects e Situação em linha (aplicam na hora) + "Limpar filtros".
 * < md: Situação visível + botão "Filtros (n)" que abre um diálogo com Aplicar/Limpar
 * (mesmo padrão do Quadro de Produção).
 */
function PendingFilters({
  values,
  clients,
  users,
  go,
  dialogOpen: open,
  onDialogOpenChange: setOpen,
}: {
  values: PendingFilterValues;
  clients: Option[];
  users: Option[];
  go: (href: string) => void;
  /** diálogo de filtros (< md); o estado fica no pai para o Toast não abrir junto */
  dialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
}) {
  // valor otimista enquanto a página nova carrega; volta a refletir a URL quando ela muda
  const [local, setLocal] = useState(values);
  const urlKey = hrefFor(values);
  const [prevUrlKey, setPrevUrlKey] = useState(urlKey);
  if (urlKey !== prevUrlKey) {
    setPrevUrlKey(urlKey);
    setLocal(values);
  }
  const [draft, setDraft] = useState(values);
  const situacaoId = useId();
  const situacaoMobileId = useId();

  const apply = (next: PendingFilterValues) => {
    setLocal(next);
    go(hrefFor(next));
  };
  const count = activeCount(values);

  return (
    <>
      <div className="mb-5 hidden flex-wrap items-end gap-3 md:flex">
        <FilterSelects values={local} clients={clients} users={users} onChange={apply} size="sm" fieldClassName="w-48" />
        <Field id={situacaoId} kind="group" label="Situação">
          <SegmentedControl
            aria-labelledby={`${situacaoId}-label`}
            size="sm"
            value={local.situacao}
            options={SITUACAO_OPTIONS}
            onChange={(situacao) => apply({ ...local, situacao })}
          />
        </Field>
        {count > 0 && (
          <Button variant="ghost" size="sm" onClick={() => apply(cleared(local))}>
            Limpar filtros
          </Button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 md:hidden">
        <Field id={situacaoMobileId} kind="group" label="Situação" labelHidden>
          <SegmentedControl
            aria-labelledby={`${situacaoMobileId}-label`}
            value={local.situacao}
            options={SITUACAO_OPTIONS}
            onChange={(situacao) => apply({ ...local, situacao })}
          />
        </Field>
        <Button
          variant="secondary"
          aria-haspopup="dialog"
          leadingIcon={<Icon.search />}
          onClick={() => {
            setDraft(values);
            setOpen(true);
          }}
        >
          {count > 0 ? `Filtros (${count})` : "Filtros"}
        </Button>
        {open && (
          <Dialog
            open
            onClose={() => setOpen(false)}
            title="Filtros"
            size="sm"
            footer={
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setOpen(false);
                    apply(cleared(values));
                  }}
                >
                  Limpar
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setOpen(false);
                    apply(draft);
                  }}
                >
                  Aplicar
                </Button>
              </>
            }
          >
            <div className="grid gap-4">
              <FilterSelects values={draft} clients={clients} users={users} onChange={setDraft} size="md" />
            </div>
          </Dialog>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Partes da linha
 * ------------------------------------------------------------------ */

function ItemText({ row, large = false }: { row: PendingRow; large?: boolean }) {
  return (
    <div className="min-w-0">
      <p className={`${large ? "text-base" : "text-sm"} font-semibold text-fg wrap-break-word`}>{row.title}</p>
      {row.details && (
        <p title={row.details} className="mt-0.5 line-clamp-2 whitespace-pre-line text-sm text-fg-muted wrap-break-word">
          {row.details}
        </p>
      )}
    </div>
  );
}

function PostLink({ row }: { row: PendingRow }) {
  if (!row.post) {
    return (
      <span className="text-fg-muted">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Sem post vinculado</span>
      </span>
    );
  }
  return (
    <Link href={`/posts/${row.post.id}`} className={`${LOOSE_LINK} font-medium text-link underline-offset-2 hover:underline`}>
      <span className="sr-only">Abrir o post de </span>
      {row.post.label}
    </Link>
  );
}

function Responsible({ row }: { row: PendingRow }) {
  if (!row.responsible) {
    return (
      <span className="text-fg-muted">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Sem responsável</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-fg" title={row.responsible.name}>
      <Avatar name={row.responsible.name} size="xs" />
      <span className="sr-only">Responsável: </span>
      {firstName(row.responsible.name)}
    </span>
  );
}

/** "há N dias"; aberta há mais de 30 dias → selo de alerta (ícone + texto, não só cor) [RD §2.2.5]. */
function Age({ row }: { row: PendingRow }) {
  if (row.resolved) return <span className="text-fg-muted">{row.resolvedLabel}</span>;
  if (row.stale) {
    return (
      <ToneBadge tone="warning" icon={<Icon.alert />} title="Parada há mais de 30 dias">
        Parada {row.ageLabel}
        <span className="sr-only"> (mais de 30 dias)</span>
      </ToneBadge>
    );
  }
  return (
    <span className="text-fg">
      <span className="sr-only">Aberta </span>
      {row.ageLabel}
    </span>
  );
}

function RowActions({
  row,
  menuOpen,
  menuId,
  onResolve,
  onConvert,
  onMenu,
}: {
  row: PendingRow;
  menuOpen: boolean;
  menuId: string;
  onResolve: () => void;
  onConvert: () => void;
  onMenu: (el: HTMLElement) => void;
}) {
  return (
    <div className="flex items-center gap-1 lg:justify-end">
      {convertIsPrimary(row) ? (
        <Button
          size="sm"
          data-row-action={row.id}
          aria-haspopup="dialog"
          aria-label={`Converter em post: ${row.title}`}
          leadingIcon={<Icon.calendar />}
          onClick={onConvert}
        >
          Converter em post
        </Button>
      ) : (
        <Button
          size="sm"
          data-row-action={row.id}
          aria-label={`${row.resolved ? "Reabrir" : "Resolver"}: ${row.title}`}
          onClick={onResolve}
        >
          {row.resolved ? "Reabrir" : "Resolver"}
        </Button>
      )}
      <Button
        iconOnly
        variant="ghost"
        size="sm"
        aria-label={`Mais ações: ${row.title}`}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onClick={(e) => onMenu(e.currentTarget)}
      >
        <Icon.moreHorizontal />
      </Button>
    </div>
  );
}

function MenuButton({
  icon,
  danger = false,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-sm hover:bg-hover active:bg-press sm:min-h-10 ${
        danger ? "text-danger-fg" : "text-fg"
      }`}
    >
      <span aria-hidden="true" className={`inline-flex size-4 shrink-0 [&>svg]:size-full ${danger ? "" : "text-fg-muted"}`}>
        {icon}
      </span>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Diálogos
 * ------------------------------------------------------------------ */

/** Nova pendência / Editar (DESIGN g.3). O cliente não muda depois de criada (o PATCH não aceita). */
function ItemFormDialog({
  row,
  defaults,
  clients,
  users,
  onClose,
  onCreated,
  onSaved,
}: {
  row: PendingRow | null;
  defaults: { clientId: string; kind: PendingKind; responsibleUserId: string };
  clients: Option[];
  users: Option[];
  onClose: () => void;
  onCreated: (item: { clientId: string; kind: string; responsibleUserId: string | null }) => void;
  onSaved: () => void;
}) {
  const editing = row !== null;
  const formId = useId();
  const [clientId, setClientId] = useState(row?.client.id ?? defaults.clientId);
  const [kind, setKind] = useState<PendingKind>(row ? (isPendingKind(row.kind) ? row.kind : "outro") : defaults.kind);
  const [title, setTitle] = useState(row?.title ?? "");
  const [details, setDetails] = useState(row?.details ?? "");
  const [responsible, setResponsible] = useState(row ? (row.responsible?.id ?? "") : defaults.responsibleUserId);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clientRef = useRef<HTMLSelectElement>(null);
  const kindRef = useRef<HTMLSelectElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLTextAreaElement>(null);
  const responsibleRef = useRef<HTMLSelectElement>(null);
  // fixo na abertura: trocar a ref depois reabriria o <dialog> (o efeito do Dialog depende dela)
  const [initialFocusRef] = useState(() => (editing || defaults.clientId ? titleRef : clientRef));
  const refs: Record<FormField, React.RefObject<HTMLElement | null>> = {
    clientId: clientRef,
    kind: kindRef,
    title: titleRef,
    details: detailsRef,
    responsibleUserId: responsibleRef,
  };
  const ORDER: FormField[] = ["clientId", "kind", "title", "details", "responsibleUserId"];
  const focusFirst = (errs: FieldErrors) => {
    const key = ORDER.find((k) => errs[k]);
    if (key) refs[key].current?.focus();
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const local: FieldErrors = {};
    if (!editing && !clientId) local.clientId = "Escolha o cliente.";
    if (!title.trim()) local.title = "Informe o título.";
    setErrors(local);
    setError(null);
    if (Object.keys(local).length > 0) {
      focusFirst(local);
      return;
    }
    setBusy(true);
    const result = editing
      ? await send(
          `/api/pending-items/${row.id}`,
          "PATCH",
          { kind, title: title.trim(), details, responsibleUserId: responsible || null },
          "Não foi possível salvar as alterações. Tente de novo.",
        )
      : await send(
          "/api/pending-items",
          "POST",
          {
            clientId,
            kind,
            title: title.trim(),
            details: details.trim() ? details : null,
            responsibleUserId: responsible || null,
          },
          "Não foi possível criar a pendência. Tente de novo.",
        );
    setBusy(false);
    if (!result.ok) {
      setErrors(result.failure.fields);
      setError(result.failure.message);
      focusFirst(result.failure.fields);
      return;
    }
    if (editing) onSaved();
    else onCreated({ clientId, kind, responsibleUserId: responsible || null });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? "Editar pendência" : "Nova pendência"}
      size="md"
      busy={busy}
      error={error}
      initialFocusRef={initialFocusRef}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy} loadingText="Salvando…">
            {editing ? "Salvar alterações" : "Criar pendência"}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="grid gap-4 pb-2">
        {editing ? (
          <Field label="Cliente" help="O cliente não muda depois que a pendência é criada.">
            <Input value={row.client.name} readOnly />
          </Field>
        ) : (
          <Field label="Cliente" required error={errors.clientId}>
            <Select
              ref={clientRef}
              value={clientId}
              placeholderOption="Escolha o cliente"
              onChange={(e) => setClientId(e.target.value)}
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Tipo" error={errors.kind}>
          <Select ref={kindRef} value={kind} onChange={(e) => isPendingKind(e.target.value) && setKind(e.target.value)}>
            {PENDING_KINDS.map((k) => (
              <option key={k} value={k}>
                {PENDING_KIND[k].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Título" required error={errors.title}>
          <Input ref={titleRef} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field
          label="Detalhes"
          optional
          help="Ex.: caminho do material, o que falta o cliente enviar, instruções ao designer."
          error={errors.details}
        >
          <Textarea
            ref={detailsRef}
            value={details}
            maxLength={10_000}
            showCount
            rows={4}
            onChange={(e) => setDetails(e.target.value)}
          />
        </Field>
        <Field label="Responsável" optional error={errors.responsibleUserId}>
          <Select ref={responsibleRef} value={responsible} onChange={(e) => setResponsible(e.target.value)}>
            <option value="">Sem responsável</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Dialog>
  );
}

/** Converter em post: cria um rascunho no cronograma do mês e resolve a pendência (S18 convert). */
function ConvertDialog({
  row,
  onClose,
  onConverted,
}: {
  row: PendingRow;
  onClose: () => void;
  onConverted: (r: { postId: string; dateLabel: string }) => void;
}) {
  const formId = useId();
  const [initialWhen] = useState(defaultWhen);
  const [when, setWhen] = useState(initialWhen);
  const [format, setFormat] = useState<PostFormat>("feed");
  const [targets, setTargets] = useState<Record<Target, boolean>>({ instagram: true, facebook: true });
  const [errors, setErrors] = useState<{ when?: string; targets?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const chosen = TARGETS.filter((t) => targets[t.id]).map((t) => t.id);
    const local: { when?: string; targets?: string } = {};
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) local.when = "Escolha a data e o horário.";
    if (chosen.length === 0) local.targets = "Escolha ao menos uma rede.";
    setErrors(local);
    setError(null);
    if (Object.keys(local).length > 0) return;
    setBusy(true);
    const result = await send(
      `/api/pending-items/${row.id}/convert`,
      "POST",
      { scheduledAt: spLocalInputToISO(when), format, targets: chosen },
      "Não foi possível criar o rascunho. Tente de novo.",
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    const post = (result.data as { post?: { id?: unknown; scheduledAt?: unknown } } | null)?.post;
    if (!post || typeof post.id !== "string") {
      setError("O rascunho foi criado, mas não deu para abrir os dados dele. Atualize a página.");
      return;
    }
    const at = typeof post.scheduledAt === "string" ? new Date(post.scheduledAt) : new Date(spLocalInputToISO(when));
    onConverted({ postId: post.id, dateLabel: DAY_MONTH.format(at) });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Converter em post"
      description="Cria um rascunho no cronograma do mês e marca esta pendência como resolvida. Nada é agendado."
      size="md"
      busy={busy}
      error={error}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy} loadingText="Criando…">
            Criar rascunho
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="grid gap-4 pb-2">
        <div className="rounded-control border border-line bg-sunken px-3 py-2 text-sm">
          <p className="font-semibold text-fg wrap-break-word">{row.title}</p>
          <p className="text-fg-muted">
            {row.client.name} · o título vira o tema do post e os detalhes viram a nota interna.
          </p>
        </div>
        <Field label="Data e hora" required error={errors.when} help="Horário de São Paulo.">
          <DateTimePicker defaultValue={initialWhen} onChange={setWhen} invalid={!!errors.when} />
        </Field>
        <Field label="Formato">
          <FormatPicker value={format} onChange={(v) => isPostFormat(v) && setFormat(v)} />
        </Field>
        <Field label="Redes" kind="group" error={errors.targets}>
          <div className="flex flex-wrap gap-x-6">
            {TARGETS.map((t) => (
              <label key={t.id} className="flex min-h-11 items-center gap-3 text-sm sm:min-h-10">
                <input
                  type="checkbox"
                  checked={targets[t.id]}
                  onChange={(e) => setTargets((prev) => ({ ...prev, [t.id]: e.target.checked }))}
                  className="size-4.5 rounded-chip accent-selected"
                />
                {t.label}
              </label>
            ))}
          </div>
        </Field>
      </form>
    </Dialog>
  );
}

function DeleteDialog({ row, onClose, onDeleted }: { row: PendingRow; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = await send(
      `/api/pending-items/${row.id}`,
      "DELETE",
      undefined,
      "Não foi possível excluir a pendência. Tente de novo.",
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    onDeleted();
  }

  return (
    <ConfirmDialog
      open
      tone="danger"
      title={`Excluir a pendência «${row.title}»?`}
      consequences={[
        "A pendência é apagada e não dá para desfazer.",
        ...(row.post ? [`O post vinculado (${row.post.label}) continua existindo.`] : []),
      ]}
      confirmLabel="Excluir pendência"
      busy={busy}
      busyLabel="Excluindo…"
      error={error}
      onConfirm={confirm}
      onCancel={onClose}
    />
  );
}
