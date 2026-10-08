"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { Button, buttonClasses } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { ConfirmDialog } from "@/components/Dialog";
import { Popover } from "@/components/Popover";
import { EmptyState, StatusBadge, ToneBadge } from "@/components/ui";
import { Toast, type ToastState } from "@/components/Toast";
import { labelOf, metaOf, PLAN, SCHEDULE_STATUS, type Tone } from "@/lib/status-meta";
import EmptySchedules from "./EmptySchedules";
import ScheduleFilters from "./ScheduleFilters";
import {
  APPROVED_PREVIEW,
  buildScheduleView,
  countLabel,
  filtersQuery,
  FRESHNESS_LABEL,
  GROUP_META,
  hasActiveFilters,
  monthOptions,
  NO_FILTERS,
  type Freshness,
  type ScheduleFilters as Filters,
  type ScheduleGroup,
} from "./schedules-view";

export type ScheduleRow = {
  id: string;
  client: string;
  /** Client.plan: "sem_aprovacao" | "aprovacao_cliente" */
  plan: string;
  /** false = cliente só produção: aprovar não coloca nada na fila */
  agencyPublishes: boolean;
  /** "2026-10" (filtro de mês) */
  monthKey: string;
  /** "Outubro de 2026" */
  month: string;
  status: string;
  posts: number;
  withMedia: number;
  /** posts em rascunho: entram na fila no "Aprovar" quando a agência publica */
  drafts: number;
  draftsWithoutArt: number;
  /** posts agendados: saem da fila no "Reverter aprovação" */
  queued: number;
  /** publicados ou publicando: o "Reverter" não mexe neles */
  published: number;
  notedPosts: number;
  /** ajustes do cliente ainda abertos (bloqueiam a aprovação pelo link) */
  pendingAdjustments: number;
  /** nº de e-mails do cliente (principal + adicionais) */
  recipients: number;
  clientNote: string | null;
  changesAskedAt: string | null;
  sentAt: string | null;
  /** dias civis (SP) desde o envio, só com o cliente ("enviado_cliente"); senão null (U-09) */
  waitingDays: number | null;
  /** prazo do cliente "25/09" (lib/production `approvalDeadline`), só com o cliente */
  clientDeadline: string | null;
  /** prazo do cliente vencido sem resposta: tom de aviso e "Reenviar" como ação principal */
  overdue: boolean;
  approvedAt: string | null;
  /** criado em "07/10" */
  createdAt: string;
  /** ms da última atividade (criação, envio, aprovação, ajuste pedido, post mais novo) — ordem da lista */
  lastActivity: number;
  /** selo "Novo" / "Atualizado hoje" */
  freshness: Freshness;
  link: string | null;
};

type Notify = (t: ToastState) => void;
type DialogKind = "approve" | "resend" | "sendNoArt" | "revert";
type Busy = "" | "send" | "approve" | "revert";
type EmailIssue = { title: string; text: string; window: string | null };

/* Etapas do fluxo (DESIGN h.3): em_revisao fica na etapa 2, com o badge "Em revisão". */
const STEPS = ["Rascunho", "Enviado ao cliente", "Aprovado"] as const;
const STEP_OF: Record<string, number> = {
  rascunho: 0,
  aprovado_interno: 0,
  enviado_cliente: 1,
  em_revisao: 1,
  aprovado_cliente: 2,
};

/* Borda esquerda no tom do status (reforço; o texto do status está ao lado). */
const BORDER: Record<Tone, string> = {
  neutral: "border-l-neutral-solid",
  info: "border-l-info-solid",
  success: "border-l-success-solid",
  warning: "border-l-warning-solid",
  danger: "border-l-danger-solid",
  accent: "border-l-brand-solid",
};

const NOT_SENT = new Set(["rascunho", "aprovado_interno"]);

function count(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Ícone 14 px dentro de texto corrido. */
function InlineIcon({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden="true" className="inline-flex size-3.5 shrink-0 [&>svg]:size-full">
      {children}
    </span>
  );
}

/**
 * Contagem de arte em texto (A-023): neutra antes do envio; depois do envio, aviso só quando
 * importa (o texto diz o número; o ícone e a cor reforçam).
 */
function ArtText({ row }: { row: ScheduleRow }) {
  const text = `${row.withMedia}/${row.posts} com arte`;
  if (NOT_SENT.has(row.status) || !(row.status in STEP_OF)) {
    return <span title="As artes podem chegar depois da aprovação dos temas.">{text}</span>;
  }
  if (row.withMedia === row.posts) {
    return (
      <span className="inline-flex items-center gap-1 text-success-fg">
        <InlineIcon>
          <Icon.check />
        </InlineIcon>
        {text}
      </span>
    );
  }
  const hint = row.agencyPublishes ? "Posts sem arte falham na publicação." : "Ainda faltam artes.";
  const danger = row.status === "aprovado_cliente" && row.agencyPublishes && row.withMedia === 0;
  return (
    <span title={hint} className={`inline-flex items-center gap-1 font-medium ${danger ? "text-danger-fg" : "text-warning-fg"}`}>
      <InlineIcon>
        <Icon.alert />
      </InlineIcon>
      {text}
      <span className="sr-only"> ({hint})</span>
    </span>
  );
}

/** "Aguardando desde hoje" · "Aguardando há 1 dia" · "Aguardando há N dias". */
function waitingLabel(days: number): string {
  if (days <= 0) return "Aguardando desde hoje";
  return days === 1 ? "Aguardando há 1 dia" : `Aguardando há ${days} dias`;
}

/**
 * Envio e espera do cliente (U-09), numa linha de texto: neutra dentro do prazo; com o prazo
 * vencido, tom de aviso + ícone (a cor nunca é o único sinal: o texto diz "vencido").
 */
function ClientLine({ row }: { row: ScheduleRow }) {
  const parts: React.ReactNode[] = [];
  if (row.sentAt) parts.push(<span key="sent">Enviado em {row.sentAt}</span>);
  if (row.waitingDays !== null) {
    parts.push(
      <span
        key="wait"
        className={`inline-flex items-center gap-1 ${row.overdue ? "font-medium text-warning-fg" : ""}`}
      >
        <InlineIcon>{row.overdue ? <Icon.alert /> : <Icon.clock />}</InlineIcon>
        {waitingLabel(row.waitingDays)}
      </span>
    );
  }
  if (row.clientDeadline) {
    parts.push(
      row.overdue ? (
        <span key="deadline" className="font-medium text-warning-fg">
          Prazo do cliente: {row.clientDeadline} (vencido)
        </span>
      ) : (
        <span key="deadline">Prazo do cliente: {row.clientDeadline}</span>
      )
    );
  }
  if (parts.length === 0) return null;
  return <MetaLine className="mt-1">{parts}</MetaLine>;
}

/** Partes separadas por "·" (decorativo). O ponto fica no fim da parte: ao quebrar, a linha nova não começa nele. */
function MetaLine({ children, className = "" }: { children: React.ReactNode[]; className?: string }) {
  return (
    <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted ${className}`}>
      {children.map((part, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {part}
          {i < children.length - 1 && (
            <span aria-hidden="true" className="text-fg-faint">
              ·
            </span>
          )}
        </span>
      ))}
    </p>
  );
}

/** Etapa com texto visível (lido pelo leitor de tela); a barra é só reforço visual. */
function Steps({ status }: { status: string }) {
  const current = STEP_OF[status] ?? 0;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <div aria-hidden="true" className="flex items-center gap-1">
        {STEPS.map((label, i) => (
          <span key={label} className={`h-1.5 w-6 rounded-full ${i <= current ? "bg-selected" : "bg-neutral-bg"}`} />
        ))}
      </div>
      <p className="text-xs text-fg-muted">
        Etapa {current + 1} de {STEPS.length} · {STEPS[current]}
      </p>
    </div>
  );
}

/** Item do menu "Mais ações": botão ou link (abre em nova aba). */
type MenuItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  onSelect?: () => void;
  href?: string;
};

function MoreMenu({ label, items, disabled }: { label: string; items: MenuItem[]; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const itemClass =
    "flex min-h-11 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-sm text-fg hover:bg-hover active:bg-press sm:min-h-10";
  const iconBox = (icon: React.ReactNode) => (
    <span aria-hidden="true" className="inline-flex size-4 shrink-0 text-fg-muted [&>svg]:size-full">
      {icon}
    </span>
  );
  return (
    <>
      <Button
        ref={anchorRef}
        iconOnly
        variant="ghost"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon.moreHorizontal />
      </Button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        placement="bottom-end"
        id={menuId}
        aria-label={label}
        className="w-64 p-1.5"
      >
        <div className="grid gap-0.5">
          {items.map((it) =>
            it.href ? (
              <a
                key={it.key}
                href={it.href}
                target="_blank"
                rel="noreferrer"
                className={itemClass}
                onClick={() => setOpen(false)}
              >
                {iconBox(it.icon)}
                {it.label}
                <span className="sr-only"> (abre em nova aba)</span>
              </a>
            ) : (
              <button
                key={it.key}
                type="button"
                className={itemClass}
                onClick={() => {
                  // fecha e devolve o foco ao "Mais ações": o diálogo aberto a seguir volta para ele
                  setOpen(false);
                  anchorRef.current?.focus();
                  it.onSelect?.();
                }}
              >
                {iconBox(it.icon)}
                {it.label}
              </button>
            )
          )}
        </div>
      </Popover>
    </>
  );
}

function RowItem({ row, notify }: { row: ScheduleRow; notify: Notify }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>("");
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  // o servidor recusou com o estado mudado (ex.: já aprovado): ao fechar, recarrega
  const [stale, setStale] = useState(false);
  // e-mail não saiu (ou saiu só para parte): aviso na linha, sem Toast (A-024)
  const [emailIssue, setEmailIssue] = useState<EmailIssue | null>(null);
  // link recém-gerado pelo envio desta linha; senão, o que veio do servidor
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const link = freshLink ?? row.link;

  const approved = row.status === "aprovado_cliente";
  const notSent = !approved && !(row.status === "enviado_cliente" || row.status === "em_revisao");
  const withApproval = row.plan === "aprovacao_cliente";
  const noArt = row.posts > 0 && row.withMedia === 0;
  const approveLabel = notSent && !withApproval ? "Aprovar cronograma" : "Aprovar sem o cliente";
  const disabled = busy !== "";
  // prazo do cliente vencido sem resposta: a borda acompanha o aviso (U-09)
  const tone: Tone = row.overdue ? "warning" : metaOf(SCHEDULE_STATUS, row.status).tone;
  const title = `${row.client} · ${row.month}`;

  function openDialog(kind: DialogKind) {
    setDialogError(null);
    setStale(false);
    setDialog(kind);
  }

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setDialogError(null);
    if (stale) router.refresh();
  }

  /** Erro de uma ação: dentro do diálogo, se houver um aberto; senão, Toast. */
  function fail(text: string, fromDialog: boolean) {
    if (fromDialog) setDialogError(text);
    else notify({ kind: "error", text });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      notify({ kind: "success", text: "Link copiado" });
    } catch {
      notify({
        kind: "error",
        text: "Não foi possível copiar o link. Use “Abrir link” e copie o endereço da barra do navegador.",
      });
    }
  }

  async function send(fromDialog: boolean) {
    setBusy("send");
    setDialogError(null);
    try {
      const r = await fetch(`/api/schedules/${row.id}/send`, { method: "POST" });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        // N-14: só o texto do servidor; objeto (zod) vira mensagem desta tela
        fail(typeof d?.error === "string" ? d.error : "Não foi possível enviar o cronograma. Tente de novo.", fromDialog);
        if (r.status === 404 || r.status === 409) {
          if (fromDialog) setStale(true);
          else router.refresh();
        }
        return;
      }
      setDialog(null);
      if (typeof d?.link === "string") setFreshLink(d.link);
      const recipients = strings(d?.recipients);
      const failed = strings(d?.failed);
      // N-12: "Enviado para" = destinatários menos os que falharam (nunca o campo `to`)
      const sentTo = recipients.filter((r) => !failed.includes(r));
      const windowNote = typeof d?.windowWarning === "string" ? d.windowWarning : null;
      const reason =
        typeof d?.emailError === "string" ? d.emailError : "Não foi possível enviar o e-mail. Tente de novo em instantes.";
      if (sentTo.length > 0 && failed.length === 0) {
        setEmailIssue(null);
        notify({ kind: "success", text: `E-mail enviado para ${sentTo.join(", ")}.${windowNote ? ` ${windowNote}` : ""}` });
      } else if (sentTo.length > 0) {
        setEmailIssue({
          title: "Parte dos e-mails não foi enviada",
          text: `Enviado para ${sentTo.join(", ")}. Não foi para ${failed.join(", ")}: ${reason} Copie o link e mande pelo WhatsApp.`,
          window: windowNote,
        });
      } else {
        setEmailIssue({
          title: "O e-mail não foi enviado",
          text: `${reason} Copie o link e mande pelo WhatsApp.`,
          window: windowNote,
        });
      }
      router.refresh();
    } catch {
      fail("Falha de conexão ao enviar. Verifique a internet e tente de novo.", fromDialog);
    } finally {
      setBusy("");
    }
  }

  function startSend() {
    // sem nenhuma arte, confirma antes: o cliente veria só temas e legendas
    if (noArt) openDialog("sendNoArt");
    else void send(false);
  }

  async function approve() {
    setBusy("approve");
    setDialogError(null);
    try {
      const r = await fetch(`/api/schedules/${row.id}/approve-internal`, { method: "POST" });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        fail(typeof d?.error === "string" ? d.error : "Não foi possível aprovar o cronograma. Tente de novo.", true);
        if (r.status === 404 || r.status === 409) setStale(true);
        return;
      }
      setDialog(null);
      const queued = typeof d?.queued === "number" ? d.queued : typeof d?.scheduled === "number" ? d.scheduled : 0;
      const text =
        d?.noPublish === true
          ? `Cronograma de ${row.month} aprovado. Os posts continuam como rascunho: ${row.client} é só produção.`
          : queued > 0
            ? `Cronograma de ${row.month} aprovado: ${queued === 1 ? "1 post entrou" : `${queued} posts entraram`} na fila de publicação.`
            : `Cronograma de ${row.month} aprovado. Nenhum post entrou na fila.`;
      notify({ kind: "success", text });
      router.refresh();
    } catch {
      fail("Falha de conexão ao aprovar. Verifique a internet e tente de novo.", true);
    } finally {
      setBusy("");
    }
  }

  async function revert() {
    setBusy("revert");
    setDialogError(null);
    try {
      const r = await fetch(`/api/schedules/${row.id}/revert`, { method: "POST" });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        fail(typeof d?.error === "string" ? d.error : "Não foi possível reverter a aprovação. Tente de novo.", true);
        if (r.status === 404 || r.status === 409) setStale(true);
        return;
      }
      setDialog(null);
      const n = typeof d?.reverted === "number" ? d.reverted : 0;
      notify({
        kind: "success",
        text:
          n > 0
            ? `Aprovação revertida: ${n === 1 ? "1 post voltou" : `${n} posts voltaram`} para rascunho.`
            : "Aprovação revertida. Nenhum post estava na fila.",
      });
      router.refresh();
    } catch {
      fail("Falha de conexão ao reverter. Verifique a internet e tente de novo.", true);
    } finally {
      setBusy("");
    }
  }

  /* ---------------- consequências dos diálogos (números da linha) ---------------- */

  function approveConsequences(): string[] {
    const out = ["O cronograma passa para “Aprovado”."];
    if (row.agencyPublishes) {
      out.push(
        row.drafts === 0
          ? "Nenhum post está em rascunho: nada novo entra na fila de publicação."
          : row.drafts === 1
            ? "1 rascunho entra na fila e será publicado na data agendada."
            : `${row.drafts} rascunhos entram na fila e serão publicados nas datas agendadas.`
      );
      if (row.draftsWithoutArt > 0) {
        out.push(
          row.draftsWithoutArt === 1
            ? "1 post ainda sem arte vai falhar se não receber mídia até a data."
            : `${row.draftsWithoutArt} posts ainda sem arte vão falhar se não receberem mídia até a data.`
        );
      }
    } else {
      out.push(
        row.drafts === 0
          ? "Nenhum post entra na fila de publicação: este cliente é só produção."
          : row.drafts === 1
            ? "O rascunho continua como rascunho e não entra na fila de publicação: este cliente é só produção."
            : `Os ${row.drafts} rascunhos continuam como rascunho e não entram na fila de publicação: este cliente é só produção.`
      );
    }
    if (withApproval) out.push("O cliente não precisará aprovar este cronograma.");
    if (!notSent) out.push("O link do cliente passa a mostrar o cronograma aprovado, sem pedir ajustes.");
    if (row.pendingAdjustments > 0) {
      out.push(
        row.pendingAdjustments === 1
          ? "1 ajuste pedido pelo cliente continua aberto no painel de ajustes."
          : `${row.pendingAdjustments} ajustes pedidos pelo cliente continuam abertos no painel de ajustes.`
      );
    }
    return out;
  }

  /** Contexto do reenvio: há quanto tempo o cliente não responde (U-09). */
  function resendDescription(): string | undefined {
    if (row.waitingDays === null || !row.sentAt) return undefined;
    const days =
      row.waitingDays <= 0 ? "desde hoje" : row.waitingDays === 1 ? "há 1 dia" : `há ${row.waitingDays} dias`;
    const deadline = row.clientDeadline
      ? row.overdue
        ? ` O prazo do cliente venceu em ${row.clientDeadline}.`
        : ` O prazo do cliente é ${row.clientDeadline}.`
      : "";
    return `Enviado em ${row.sentAt}, sem resposta ${days}.${deadline}`;
  }

  function resendConsequences(): string[] {
    const out =
      row.recipients === 0
        ? ["Este cliente não tem e-mail válido cadastrado. Cadastre um e-mail na página do cliente antes de reenviar."]
        : [
            `O cliente recebe de novo o e-mail com o link de aprovação (${count(row.recipients, "endereço", "endereços")}).`,
            "O link anterior deixa de funcionar: vale só o link novo deste envio.",
          ];
    if (row.status === "em_revisao") out.push("O status volta para “Enviado ao cliente”.");
    if (noArt) out.push("Nenhum post tem arte: o cliente verá só temas e legendas.");
    return out;
  }

  function sendNoArtConsequences(): string[] {
    const out = ["O cliente verá só temas e legendas."];
    if (row.agencyPublishes) out.push("Posts sem mídia falham na publicação.");
    return out;
  }

  function revertConsequences(): string[] {
    const out = [
      link
        ? "O cronograma volta para “Em revisão” e o link do cliente reabre para ajustes."
        : "O cronograma volta para “Rascunho”.",
      row.queued === 0
        ? "Nenhum post deste cronograma está na fila agora."
        : row.queued === 1
          ? "1 post agendado sai da fila e volta para rascunho."
          : `${row.queued} posts agendados saem da fila e voltam para rascunho.`,
    ];
    if (row.published > 0) {
      out.push(
        row.published === 1 ? "1 post já publicado não muda." : `${row.published} posts já publicados não mudam.`
      );
    }
    return out;
  }

  /* ---------------- ações: 1 primária (o próximo passo do status), 1 secundária, o resto em "…" ---------------- */

  type Action = { key: string; label: string; icon: React.ReactNode; run?: () => void; href?: string; busy?: boolean; busyText?: string };
  const A = {
    copy: link ? { key: "copy", label: "Copiar link", icon: <Icon.copy />, run: () => void copy() } : null,
    open: link ? { key: "open", label: "Abrir link", icon: <Icon.externalLink />, href: link } : null,
    resend: { key: "resend", label: "Reenviar", icon: <Icon.send />, run: () => openDialog("resend") },
    send: {
      key: "send",
      label: "Enviar ao cliente",
      icon: <Icon.send />,
      run: startSend,
      busy: busy === "send",
      busyText: "Enviando…",
    },
    approve: { key: "approve", label: approveLabel, icon: <Icon.check />, run: () => openDialog("approve") },
    revert: { key: "revert", label: "Reverter aprovação", icon: <Icon.refresh />, run: () => openDialog("revert") },
  } satisfies Record<string, Action | null>;

  let primary: React.ReactNode = null;
  let primaryAction: Action | null = null;
  let others: (Action | null)[] = [];
  if (approved) {
    others = [A.open, A.revert];
  } else if (row.status === "enviado_cliente") {
    // prazo vencido sem resposta (U-09): o próximo passo é lembrar o cliente
    if (row.overdue || !link) {
      primaryAction = A.resend;
      others = [A.copy, A.open, A.approve];
    } else {
      primaryAction = A.copy;
      others = [A.resend, A.open, A.approve];
    }
  } else if (row.status === "em_revisao") {
    const adjustLink = `${buttonClasses({ variant: "primary", fullWidth: true })} sm:w-auto`;
    if (row.pendingAdjustments > 0) {
      // ajuste formal: a equipe conclui no painel acima, o que libera a aprovação do cliente
      primary = (
        <a href="#ajustes" className={adjustLink}>
          Ver ajustes ({row.pendingAdjustments})
        </a>
      );
    } else if (row.notedPosts > 0) {
      primary = (
        <Link href={`/posts?scheduleId=${row.id}&noted=1`} className={adjustLink}>
          Ver ajustes ({row.notedPosts})
        </Link>
      );
    }
    // sem ajuste para ver, o próximo passo é reenviar
    if (primary) others = [A.resend, A.copy, A.open, A.approve];
    else {
      primaryAction = A.resend;
      others = [A.copy, A.open, A.approve];
    }
  } else if (withApproval) {
    primaryAction = A.send;
    others = [A.approve];
  } else {
    primaryAction = A.approve;
    others = [A.send];
  }
  const rest = others.filter((a): a is Action => a !== null);
  // 1 secundária visível; com 3 ou mais ações além da primária, as outras vão para o "…"
  const visibleSecondary = rest.length <= 2 ? rest : rest.slice(0, 1);
  const menuActions = rest.length <= 2 ? [] : rest.slice(1);

  const renderButton = (a: Action, variant: "primary" | "secondary") =>
    a.href ? (
      <a
        key={a.key}
        href={a.href}
        target="_blank"
        rel="noreferrer"
        className={`${buttonClasses({ variant, fullWidth: variant === "primary" })} ${variant === "primary" ? "sm:w-auto" : ""}`}
      >
        <span aria-hidden="true" className="inline-flex size-4.5 shrink-0 [&>svg]:size-full">
          {a.icon}
        </span>
        {a.label}
        <span className="sr-only"> (abre em nova aba)</span>
      </a>
    ) : (
      <Button
        key={a.key}
        variant={variant}
        leadingIcon={a.icon}
        loading={a.busy}
        loadingText={a.busyText}
        disabled={disabled}
        onClick={a.run}
        fullWidth={variant === "primary"}
        className={variant === "primary" ? "sm:w-auto" : ""}
      >
        {a.label}
      </Button>
    );

  if (primaryAction) primary = renderButton(primaryAction, "primary");

  /* ---------------- diálogo aberto ---------------- */

  const dialogProps =
    dialog === "approve"
      ? {
          title: `Aprovar o cronograma de ${row.month} de ${row.client}?`,
          consequences: approveConsequences(),
          confirmLabel: approveLabel,
          busyLabel: "Aprovando…",
          tone: "primary" as const,
          onConfirm: () => void approve(),
        }
      : dialog === "resend"
        ? {
            title: `Reenviar o link para ${row.client}?`,
            description: resendDescription(),
            consequences: resendConsequences(),
            confirmLabel: "Reenviar link",
            busyLabel: "Enviando…",
            tone: "primary" as const,
            confirmDisabled: row.recipients === 0,
            onConfirm: () => void send(true),
          }
        : dialog === "sendNoArt"
          ? {
              title: "Enviar sem nenhuma arte?",
              description: `Nenhum dos ${row.posts} posts de ${row.month} de ${row.client} tem arte.`,
              consequences: sendNoArtConsequences(),
              confirmLabel: "Enviar mesmo assim",
              busyLabel: "Enviando…",
              tone: "primary" as const,
              onConfirm: () => void send(true),
            }
          : dialog === "revert"
            ? {
                title: `Reverter a aprovação de ${row.month} de ${row.client}?`,
                consequences: revertConsequences(),
                confirmLabel: "Reverter aprovação",
                busyLabel: "Revertendo…",
                tone: "danger" as const,
                onConfirm: () => void revert(),
              }
            : null;

  const meta: React.ReactNode[] = [
    <span key="posts">{count(row.posts, "post", "posts")}</span>,
    <ArtText key="art" row={row} />,
    <span key="plan">{labelOf(PLAN, row.plan).toLowerCase()}</span>,
  ];
  if (!row.agencyPublishes) {
    meta.push(
      <span key="prod" title="A agência produz o conteúdo, mas o sistema não agenda nem publica.">
        só produção
      </span>
    );
  }

  return (
    <li className={`border-l-3 px-4 py-4 sm:px-5 ${BORDER[tone]}`} data-schedule={row.id}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <h3 className="text-base font-semibold text-fg">
              {row.client} <span className="font-normal text-fg-muted">· {row.month}</span>
            </h3>
            <StatusBadge kind="schedule" status={row.status} />
            {row.freshness && (
              <ToneBadge tone={row.freshness === "novo" ? "accent" : "info"}>{FRESHNESS_LABEL[row.freshness]}</ToneBadge>
            )}
          </div>
          <MetaLine className="mt-1.5">{meta}</MetaLine>
          <ClientLine row={row} />
          <Steps status={row.status} />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:max-w-xl lg:shrink-0 lg:justify-end">
          {approved && (
            <p className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-success-fg sm:min-h-10">
              <span aria-hidden="true" className="inline-flex size-4 shrink-0 [&>svg]:size-full">
                <Icon.check />
              </span>
              {row.approvedAt ? `Aprovado em ${row.approvedAt}` : "Aprovado"}
            </p>
          )}
          {primary}
          {(visibleSecondary.length > 0 || menuActions.length > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              {visibleSecondary.map((a) => renderButton(a, "secondary"))}
              {menuActions.length > 0 && (
                <MoreMenu
                  label={`Mais ações: ${title}`}
                  disabled={disabled}
                  items={menuActions.map((a) => ({
                    key: a.key,
                    label: a.label,
                    icon: a.icon,
                    href: a.href,
                    onSelect: a.run,
                  }))}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {emailIssue && (
        <Callout
          tone="warning"
          live="polite"
          title={emailIssue.title}
          className="mt-3"
          onDismiss={() => setEmailIssue(null)}
          action={
            link ? (
              <Button variant="secondary" leadingIcon={<Icon.copy />} onClick={() => void copy()}>
                Copiar link
              </Button>
            ) : undefined
          }
        >
          <p>{emailIssue.text}</p>
          {emailIssue.window && <p className="mt-1 text-fg-muted">{emailIssue.window}</p>}
        </Callout>
      )}

      {/* o que o cliente pediu no link */}
      {(row.clientNote || row.notedPosts > 0) && (
        <Callout
          tone="warning"
          title={`Ajustes pedidos pelo cliente${row.changesAskedAt ? ` · ${row.changesAskedAt}` : ""}`}
          className="mt-3"
        >
          {row.clientNote && <p className="whitespace-pre-wrap">{row.clientNote}</p>}
          {row.notedPosts > 0 && (
            <Link
              href={`/posts?scheduleId=${row.id}&noted=1`}
              className="inline-flex min-h-11 items-center sm:min-h-10"
            >
              {count(row.notedPosts, "post com comentário", "posts com comentário")} →
            </Link>
          )}
        </Callout>
      )}

      {dialogProps && (
        <ConfirmDialog
          open
          {...dialogProps}
          busy={busy !== ""}
          error={dialogError}
          onCancel={closeDialog}
        />
      )}
    </li>
  );
}

function GroupSection({
  id,
  rows,
  notify,
  collapsible,
  approvedCapped,
}: {
  id: ScheduleGroup;
  rows: ScheduleRow[];
  notify: Notify;
  /** "Aprovados" sem filtro: só os mais recentes + "Ver todos" */
  collapsible: boolean;
  approvedCapped: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const titleId = `grupo-${id}`;
  const listId = `grupo-${id}-lista`;
  const meta = GROUP_META[id];
  const limited = collapsible && !showAll && rows.length > APPROVED_PREVIEW;
  const shown = limited ? rows.slice(0, APPROVED_PREVIEW) : rows;
  return (
    <section aria-labelledby={titleId}>
      <div className="mb-3">
        <h2 id={titleId} className="flex flex-wrap items-center gap-2 text-lg font-semibold text-fg">
          {meta.title}
          <span className="inline-flex min-w-7 items-center justify-center rounded-full border border-line bg-neutral-bg px-2 text-sm font-semibold tabular-nums text-fg-muted">
            {rows.length}
            <span className="sr-only"> {rows.length === 1 ? "cronograma" : "cronogramas"}</span>
          </span>
        </h2>
        <p className="mt-0.5 text-sm text-fg-muted">{meta.hint}</p>
      </div>
      <ul id={listId} aria-labelledby={titleId} className="card divide-y divide-line overflow-hidden">
        {shown.map((r) => (
          <RowItem key={r.id} row={r} notify={notify} />
        ))}
      </ul>
      {collapsible && rows.length > APPROVED_PREVIEW && (
        <Button
          variant="ghost"
          className="mt-2"
          aria-expanded={showAll}
          aria-controls={listId}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? `Mostrar só os ${APPROVED_PREVIEW} mais recentes` : `Ver todos os ${rows.length} aprovados`}
        </Button>
      )}
      {collapsible && showAll && approvedCapped && (
        <p className="mt-1 text-xs text-fg-muted">Mostrando os aprovados mais recentes. Use os filtros para achar um mais antigo.</p>
      )}
    </section>
  );
}

export default function SchedulesManager({
  rows,
  initialFilters,
  approvedCapped,
}: {
  rows: ScheduleRow[];
  initialFilters: Filters;
  /** só os aprovados mais recentes vieram do servidor */
  approvedCapped: boolean;
}) {
  const [toast, setToast] = useState<ToastState>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const view = useMemo(() => buildScheduleView(rows, filters), [rows, filters]);
  const months = useMemo(() => monthOptions(rows), [rows]);
  const filtered = hasActiveFilters(filters);

  function changeFilters(next: Filters) {
    setFilters(next);
    // a URL acompanha (recarregar/compartilhar mantém o filtro) sem ir ao servidor
    try {
      window.history.replaceState(null, "", `${window.location.pathname}${filtersQuery(next)}${window.location.hash}`);
    } catch {
      /* sem history: o filtro continua só na tela */
    }
  }

  return (
    <>
      <ScheduleFilters
        value={filters}
        months={months}
        summary={countLabel(view.shown, view.total, filtered)}
        onChange={changeFilters}
      />

      {view.groups.length === 0 ? (
        filtered ? (
          <EmptyState
            title="Nenhum cronograma encontrado"
            description="Nenhum cronograma com posts corresponde aos filtros."
            action={<Button onClick={() => changeFilters(NO_FILTERS)}>Limpar filtros</Button>}
            headingLevel={2}
          />
        ) : (
          <EmptyState
            title="Nenhum cronograma com posts"
            description="Gere o cronograma com IA ou importe o documento do mês na página do cliente."
            action={
              <Link href="/clients" className={buttonClasses({ variant: "secondary" })}>
                Ver clientes
              </Link>
            }
            headingLevel={2}
          />
        )
      ) : (
        <div className="grid gap-10">
          {view.groups.map((g) => (
            <GroupSection
              key={g.id}
              id={g.id}
              rows={g.rows}
              notify={setToast}
              collapsible={g.id === "aprovados" && !filtered}
              approvedCapped={approvedCapped}
            />
          ))}
        </div>
      )}

      <EmptySchedules rows={view.empty} notify={setToast} />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}
