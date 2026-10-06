"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "./Button";
import { Callout } from "./Callout";
import { Icon } from "./Icons";
import { hasOpenPopover } from "./Popover";

/*
 * Modal nativo (DESIGN e.2): <dialog> + showModal() usa a top layer, então o
 * fundo fica inerte e o painel não sofre com `transform` de ancestrais
 * [RC Risco 13]. Nenhum transform/filter no próprio <dialog>: a animação fica
 * no painel interno, para um Popover dentro dele continuar posicionado.
 */

export type DialogSize = "sm" | "md" | "lg"; // largura máxima 400 · 560 · 720
export type DialogProps = {
  open: boolean;
  /** PEDIDO de fechar (Esc, fundo, X). O pai decide. */
  onClose: () => void;
  /** h2, aria-labelledby */
  title: string;
  /** aria-describedby */
  description?: React.ReactNode;
  /** corpo (rola por dentro) */
  children?: React.ReactNode;
  /** ações; DOM = [secundária, …, primária] */
  footer?: React.ReactNode;
  /** padrão "md" */
  size?: DialogSize;
  /** ignora Esc/fundo/X e marca aria-busy */
  busy?: boolean;
  /** Callout danger DENTRO do diálogo, acima do footer */
  error?: string | null;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** padrão true */
  closeOnBackdrop?: boolean;
  /** padrão false */
  hideCloseButton?: boolean;
};

const PANEL_WIDTH: Record<DialogSize, string> = {
  sm: "sm:max-w-100",
  md: "sm:max-w-140",
  lg: "sm:max-w-180",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Elementos alcançáveis por Tab dentro de `root`, sem os de um diálogo aninhado. */
function tabbables(root: HTMLElement): HTMLElement[] {
  const owner = root.closest("dialog");
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && el.getClientRects().length > 0 && el.closest("dialog") === owner,
  );
}

function canFocus(el: HTMLElement | null | undefined): el is HTMLElement {
  return !!el && el.isConnected && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0;
}

/* Trava da rolagem do body, com contador para diálogos aninhados. */
const scrollLock = { count: 0, previous: "" };

function lockBodyScroll() {
  if (scrollLock.count === 0) {
    scrollLock.previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLock.count += 1;
}

function unlockBodyScroll() {
  scrollLock.count = Math.max(0, scrollLock.count - 1);
  if (scrollLock.count === 0) document.body.style.overflow = scrollLock.previous;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  busy = false,
  error,
  initialFocusRef,
  closeOnBackdrop = true,
  hideCloseButton = false,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  // corpo que rola sem nada focável dentro: entra na ordem de Tab para rolar pelo teclado
  const [bodyFocusable, setBodyFocusable] = useState(false);

  function requestClose() {
    if (busy || hasOpenPopover()) return;
    onClose();
  }

  // Fechamento nativo sem passar por nós (ex.: <form method="dialog">, ou o Chrome forçando o
  // fechamento no 2º Esc seguido): o estado do pai manda. Reabre e repassa o pedido ao pai,
  // que fecha (open=false) ou mantém aberto (ex.: abre um ConfirmDialog por cima).
  const onNativeClose = useEffectEvent(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog || dialog.open) return;
    dialog.showModal();
    if (!busy) onClose();
  });

  // Abre/fecha o <dialog>, trava a rolagem, foco inicial e devolução do foco.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    lockBodyScroll();
    const preferred = initialFocusRef?.current;
    const target = canFocus(preferred)
      ? preferred
      : ((bodyRef.current ? tabbables(bodyRef.current)[0] : undefined) ?? panelRef.current);
    target?.focus();
    const handleClose = () => onNativeClose();
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("close", handleClose);
      if (dialog.open) dialog.close();
      unlockBodyScroll();
      // Depois das outras limpezas do mesmo commit: se dois diálogos fecham juntos (ConfirmDialog
      // sobre Dialog), o gatilho só deixa de ser inerte quando o último <dialog> fecha.
      queueMicrotask(() => {
        if (previous?.isConnected) previous.focus();
      });
    };
  }, [open, initialFocusRef]);

  // Enquanto `busy`, o botão focado fica desabilitado e o Chrome tira o foco dele: o foco vai
  // para o painel (Esc continua passando pelo nosso onKeyDown) e volta ao botão depois.
  useEffect(() => {
    const dialog = dialogRef.current;
    const panel = panelRef.current;
    if (!open || !busy || !dialog || !panel) return;
    const active = document.activeElement;
    const before = active instanceof HTMLElement && dialog.contains(active) ? active : null;
    if (!before || (before as HTMLButtonElement).disabled) panel.focus();
    return () => {
      const now = document.activeElement;
      if (canFocus(before) && (now === panel || now === document.body || now === null)) before.focus();
    };
  }, [open, busy]);

  // Corpo rolável sem focáveis precisa de tabIndex (teclado e axe scrollable-region-focusable).
  useEffect(() => {
    const body = bodyRef.current;
    const content = contentRef.current;
    if (!open || !body || !content) return;
    const ro = new ResizeObserver(() => {
      const overflowing = body.scrollHeight > body.clientHeight + 1;
      setBodyFocusable(overflowing && tabbables(body).length === 0);
    });
    ro.observe(body);
    ro.observe(content);
    return () => ro.disconnect();
  }, [open]);

  function trapTab(e: KeyboardEvent<HTMLDialogElement>) {
    const dialog = e.currentTarget;
    const items = tabbables(dialog);
    const panel = panelRef.current;
    if (items.length === 0) {
      e.preventDefault();
      panel?.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement;
    if (e.shiftKey && (current === first || current === panel || !dialog.contains(current))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (current === last || !dialog.contains(current))) {
      e.preventDefault();
      first.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    // eventos de um diálogo aninhado (ex.: ConfirmDialog sobre este) são dele
    if ((e.target as Element).closest("dialog") !== e.currentTarget) return;
    if (e.key === "Escape") {
      // impede o fechamento nativo; quem decide é o pai (onClose)
      e.preventDefault();
      requestClose();
      return;
    }
    if (e.key === "Tab" && !e.defaultPrevented) trapTab(e);
  }

  const isBackdrop = (target: EventTarget) => target === dialogRef.current || target === wrapperRef.current;

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-busy={busy || undefined}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        // o "cancel" de um <input type="file"> (seletor fechado sem escolher) borbulha até
        // aqui; só o do próprio <dialog> (Esc) fecha
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        requestClose();
      }}
      onPointerDownCapture={(e: PointerEvent<HTMLDialogElement>) => {
        // registrado antes do Popover: um clique fora que só fecha o Popover não fecha o diálogo
        pressedOnBackdrop.current = isBackdrop(e.target) && !hasOpenPopover();
      }}
      onClick={(e) => {
        const fromBackdrop = pressedOnBackdrop.current && isBackdrop(e.target);
        pressedOnBackdrop.current = false;
        if (fromBackdrop && closeOnBackdrop) requestClose();
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none overflow-visible border-0 bg-transparent p-0 text-fg backdrop:bg-scrim backdrop:animate-[sf-fade-in_var(--sf-dur-base)_var(--sf-ease-out)_backwards]"
    >
      {open && (
        <div ref={wrapperRef} className="flex h-full w-full items-end justify-center sm:items-center sm:p-4">
          <div
            ref={panelRef}
            tabIndex={-1}
            className={`flex max-h-[92dvh] w-full flex-col rounded-t-sheet border border-line bg-raised shadow-raised outline-none transition-[opacity,translate] duration-(--sf-dur-slow) ease-out-soft starting:translate-y-full starting:opacity-0 sm:max-h-[85dvh] sm:rounded-card sm:starting:translate-y-2 ${PANEL_WIDTH[size]}`}
          >
            <div className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-5">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="font-display text-lg font-semibold tracking-title text-fg">
                  {title}
                </h2>
                {description && (
                  <div id={descriptionId} className="mt-1 text-sm text-fg-muted">
                    {description}
                  </div>
                )}
              </div>
              {!hideCloseButton && (
                <Button
                  iconOnly
                  variant="ghost"
                  size="md"
                  aria-label="Fechar"
                  disabled={busy}
                  onClick={requestClose}
                  // alvo de 44 px também em ≥ sm (DESIGN h.1: "inclusive o X"); o mínimo vence o size-10 do md
                  className="-mr-2 -mt-2 min-h-11 min-w-11"
                >
                  <Icon.x />
                </Button>
              )}
            </div>

            {children != null && children !== false && (
              <div
                ref={bodyRef}
                tabIndex={bodyFocusable ? 0 : undefined}
                className="min-h-0 flex-1 overflow-y-auto px-5 py-2"
              >
                <div ref={contentRef}>{children}</div>
              </div>
            )}

            {error && (
              <div className="mx-5 mb-3 mt-2">
                <Callout tone="danger" live="assertive">
                  {error}
                </Callout>
              </div>
            )}

            {footer && (
              <div className="flex shrink-0 flex-col gap-2 border-t border-line px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 max-sm:[&>*]:min-h-12 max-sm:[&>*]:w-full sm:flex-row sm:justify-end sm:pb-4">
                {footer}
              </div>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}

export type ConfirmDialogProps = {
  open: boolean;
  /** pergunta: "Excluir o cliente Coletivo?" */
  title: string;
  description?: React.ReactNode;
  /** lista "O que vai acontecer:" */
  consequences?: React.ReactNode[];
  /** extra (ex.: resumo do cronograma no link público) */
  children?: React.ReactNode;
  /** verbo explícito: "Excluir cliente" */
  confirmLabel: string;
  /** padrão "Cancelar" */
  cancelLabel?: string;
  /** padrão "primary" */
  tone?: "primary" | "danger";
  busy?: boolean;
  /** ex.: "Excluindo…" */
  busyLabel?: string;
  error?: string | null;
  /** confirmar desabilitado (ex.: contagem ainda não carregou — ERROR PATHS). Padrão false */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Confirmação: pergunta + consequências + [Cancelar] [verbo]. Foco em Cancelar se `danger`. */
export function ConfirmDialog({
  open,
  title,
  description,
  consequences,
  children,
  confirmLabel,
  cancelLabel = "Cancelar",
  tone = "primary",
  busy = false,
  busyLabel,
  error,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const hasConsequences = !!consequences && consequences.length > 0;
  const hasBody = hasConsequences || (children != null && children !== false);

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      busy={busy}
      error={error}
      initialFocusRef={tone === "danger" ? cancelRef : confirmRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={tone === "danger" ? "danger" : "primary"}
            loading={busy}
            loadingText={busyLabel}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {hasBody ? (
        <div className="grid gap-3 pb-2 text-sm text-fg">
          {hasConsequences && (
            <div>
              <p className="font-medium">O que vai acontecer:</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5">
                {consequences.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {children}
        </div>
      ) : null}
    </Dialog>
  );
}
