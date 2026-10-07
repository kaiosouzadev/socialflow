"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { Button, buttonClasses } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { ConfirmDialog } from "@/components/Dialog";
import { StatusBadge, ToneBadge } from "@/components/ui";
import { Toast, type ToastState } from "@/components/Toast";
import { metaOf, SCHEDULE_STATUS, type Tone } from "@/lib/status-meta";

export type ScheduleRow = {
  id: string;
  client: string;
  /** Client.plan: "sem_aprovacao" | "aprovacao_cliente" */
  plan: string;
  /** false = cliente só produção: aprovar não coloca nada na fila */
  agencyPublishes: boolean;
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

/** Contagem de arte (A-023): neutra antes do envio e sem posts; alarme só quando importa. */
function ArtBadge({ row }: { row: ScheduleRow }) {
  if (row.posts === 0) return <ToneBadge tone="neutral">Sem posts</ToneBadge>;
  const text = `${row.withMedia}/${row.posts} com arte`;
  if (NOT_SENT.has(row.status) || !(row.status in STEP_OF)) {
    return (
      <ToneBadge tone="neutral" title="As artes podem chegar depois da aprovação dos temas.">
        {text}
      </ToneBadge>
    );
  }
  if (row.withMedia === row.posts) {
    return (
      <ToneBadge tone="success" icon={<Icon.check />}>
        {text}
      </ToneBadge>
    );
  }
  const hint = row.agencyPublishes ? "Posts sem arte falham na publicação." : "Ainda faltam artes.";
  if (row.status === "aprovado_cliente" && row.agencyPublishes && row.withMedia === 0) {
    return (
      <ToneBadge tone="danger" icon={<Icon.alert />} title={hint}>
        {text}
      </ToneBadge>
    );
  }
  return (
    <ToneBadge tone="warning" icon={<Icon.alert />} title={hint}>
      {text}
    </ToneBadge>
  );
}

/** "Aguardando desde hoje" · "Aguardando há 1 dia" · "Aguardando há N dias". */
function waitingLabel(days: number): string {
  if (days <= 0) return "Aguardando desde hoje";
  return days === 1 ? "Aguardando há 1 dia" : `Aguardando há ${days} dias`;
}

/**
 * Idade do envio ao lado do status (U-09): neutra dentro do prazo; com o prazo do cliente
 * vencido, tom de aviso + ícone (a cor nunca é o único sinal: o texto do prazo diz "vencido").
 */
function WaitingBadge({ row }: { row: ScheduleRow }) {
  if (row.waitingDays === null) return null;
  const label = waitingLabel(row.waitingDays);
  if (row.overdue) {
    return (
      <ToneBadge
        tone="warning"
        icon={<Icon.alert />}
        title={row.clientDeadline ? `O prazo do cliente venceu em ${row.clientDeadline}` : undefined}
      >
        {label}
      </ToneBadge>
    );
  }
  return (
    <ToneBadge tone="neutral" icon={<Icon.clock />}>
      {label}
    </ToneBadge>
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
            "O link continua o mesmo.",
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

  /* ---------------- ações: 1 primária = o próximo passo do status (DESIGN h.3) ---------------- */

  const copyButton = (variant: "primary" | "ghost") =>
    link ? (
      <Button
        key="copy"
        variant={variant}
        size="sm"
        leadingIcon={<Icon.copy />}
        onClick={() => void copy()}
        fullWidth={variant === "primary"}
        className={variant === "primary" ? "sm:w-auto" : ""}
      >
        Copiar link
      </Button>
    ) : null;

  const openLink = link ? (
    <a
      key="open"
      href={link}
      target="_blank"
      rel="noreferrer"
      className={buttonClasses({ variant: "ghost", size: "sm" })}
    >
      <span aria-hidden="true" className="inline-flex size-4 shrink-0 [&>svg]:size-full">
        <Icon.externalLink />
      </span>
      Abrir link
      <span className="sr-only"> (abre em nova aba)</span>
    </a>
  ) : null;

  const resendButton = (variant: "primary" | "secondary") => (
    <Button
      key="resend"
      variant={variant}
      size="sm"
      leadingIcon={<Icon.send />}
      disabled={disabled}
      onClick={() => openDialog("resend")}
      fullWidth={variant === "primary"}
      className={variant === "primary" ? "sm:w-auto" : ""}
    >
      Reenviar
    </Button>
  );

  const sendButton = (variant: "primary" | "secondary") => (
    <Button
      key="send"
      variant={variant}
      size="sm"
      leadingIcon={<Icon.send />}
      loading={busy === "send"}
      loadingText="Enviando…"
      disabled={disabled}
      onClick={startSend}
      fullWidth={variant === "primary"}
      className={variant === "primary" ? "sm:w-auto" : ""}
    >
      Enviar ao cliente
    </Button>
  );

  const approveButton = (variant: "primary" | "ghost") => (
    <Button
      key="approve"
      variant={variant}
      size="sm"
      leadingIcon={<Icon.check />}
      disabled={disabled}
      onClick={() => openDialog("approve")}
      fullWidth={variant === "primary"}
      className={variant === "primary" ? "sm:w-auto" : ""}
    >
      {approveLabel}
    </Button>
  );

  let primary: React.ReactNode = null;
  let secondary: React.ReactNode[] = [];
  if (approved) {
    secondary = [
      openLink,
      <Button
        key="revert"
        variant="secondary"
        size="sm"
        leadingIcon={<Icon.refresh />}
        disabled={disabled}
        onClick={() => openDialog("revert")}
      >
        Reverter aprovação
      </Button>,
    ];
  } else if (row.status === "enviado_cliente") {
    if (row.overdue || !link) {
      // prazo vencido sem resposta (U-09): o próximo passo é lembrar o cliente
      primary = resendButton("primary");
      secondary = [copyButton("ghost"), openLink, approveButton("ghost")];
    } else {
      primary = copyButton("primary");
      secondary = [resendButton("secondary"), openLink, approveButton("ghost")];
    }
  } else if (row.status === "em_revisao") {
    const adjustLink = `${buttonClasses({ variant: "primary", size: "sm", fullWidth: true })} sm:w-auto`;
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
    if (primary) secondary = [resendButton("secondary"), copyButton("ghost"), approveButton("ghost")];
    else {
      primary = resendButton("primary");
      secondary = [copyButton("ghost"), approveButton("ghost")];
    }
  } else if (withApproval) {
    primary = sendButton("primary");
    secondary = [approveButton("ghost")];
  } else {
    primary = approveButton("primary");
    secondary = [sendButton("secondary")];
  }
  secondary = secondary.filter(Boolean);

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

  return (
    <li className={`border-l-3 px-4 py-4 ${BORDER[tone]}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <h3 className="text-sm font-semibold text-fg">
              {row.client} <span className="font-normal text-fg-muted">· {row.month}</span>
            </h3>
            <StatusBadge kind="schedule" status={row.status} />
            <WaitingBadge row={row} />
            {!row.agencyPublishes && (
              <span title="A agência produz o conteúdo, mas o sistema não agenda nem publica.">
                <StatusBadge kind="agencyPublishes" status="nao" />
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-muted">
            <span>{count(row.posts, "post", "posts")}</span>
            <ArtBadge row={row} />
            <StatusBadge kind="plan" status={row.plan} />
            {row.sentAt && <span>Enviado em {row.sentAt}</span>}
            {row.clientDeadline &&
              (row.overdue ? (
                <span className="font-medium text-warning-fg">Prazo do cliente: {row.clientDeadline} (vencido)</span>
              ) : (
                <span>Prazo do cliente: {row.clientDeadline}</span>
              ))}
          </div>
          <Steps status={row.status} />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:max-w-xl lg:shrink-0 lg:justify-end">
          {approved && (
            <p className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-success-fg sm:min-h-8">
              <span aria-hidden="true" className="inline-flex size-4 shrink-0 [&>svg]:size-full">
                <Icon.check />
              </span>
              {row.approvedAt ? `Aprovado em ${row.approvedAt}` : "Aprovado"}
            </p>
          )}
          {primary}
          {secondary.length > 0 && <div className="flex flex-wrap items-center gap-2">{secondary}</div>}
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
              <Button variant="secondary" size="sm" leadingIcon={<Icon.copy />} onClick={() => void copy()}>
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

export default function SchedulesManager({ rows }: { rows: ScheduleRow[] }) {
  const [toast, setToast] = useState<ToastState>(null);
  return (
    <>
      <ul aria-labelledby="cronogramas-titulo" className="card divide-y divide-line overflow-hidden">
        {rows.map((r) => (
          <RowItem key={r.id} row={r} notify={setToast} />
        ))}
      </ul>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}
