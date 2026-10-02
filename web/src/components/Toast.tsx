"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { Button } from "./Button";
import { Icon } from "./Icons";

export type ToastKind = "success" | "error" | "info";

export type ToastState = { kind: ToastKind; text: string; action?: { label: string; href: string } } | null;

const STYLE: Record<ToastKind, { bar: string; icon: string; Glyph: (p: { className?: string }) => React.ReactNode }> = {
  success: { bar: "border-l-success-solid", icon: "text-success-solid", Glyph: Icon.check },
  error: { bar: "border-l-danger-solid", icon: "text-danger-solid", Glyph: Icon.xCircle },
  info: { bar: "border-l-info-solid", icon: "text-info-solid", Glyph: Icon.info },
};

/**
 * Confirmação visível de uma ação que acabou de acontecer.
 * Substitui os avisos em texto pequeno que passavam despercebidos
 * (ex.: "E-mail enviado para ..." na tela de Aprovações).
 *
 * Fica embaixo e centralizado, para não cobrir as ações de linha à direita
 * (A-024). Canal único: nunca abra Toast com um Dialog aberto (ficaria sob a
 * top layer) — o erro do diálogo vai no `error` dele.
 */
export function Toast({
  toast,
  onClose,
  duration = 5000,
}: {
  toast: ToastState;
  onClose: () => void;
  duration?: number;
}) {
  const [leaving, setLeaving] = useState(false);
  // passar o mouse ou focar dentro pausa o tempo
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;

  const dismiss = useCallback(() => {
    setLeaving(true);
    // deixa a transição de saída rodar antes de desmontar
    setTimeout(onClose, 180);
  }, [onClose]);

  // toast novo reinicia a animação de saída — ajuste de estado durante o
  // render (padrão do React), em vez de um efeito que dispara setState
  const [prevToast, setPrevToast] = useState(toast);
  if (toast !== prevToast) {
    setPrevToast(toast);
    setLeaving(false);
  }

  useEffect(() => {
    // erro fica até o usuário fechar; sucesso/info somem sozinhos
    if (!toast || toast.kind === "error" || paused) return;
    const t = setTimeout(dismiss, duration);
    return () => clearTimeout(t);
  }, [toast, duration, dismiss, paused]);

  if (!toast) return null;
  const s = STYLE[toast.kind];
  const isError = toast.kind === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      className={`fixed bottom-[max(16px,env(safe-area-inset-bottom))] left-1/2 z-60 flex w-[calc(100%-32px)] max-w-105 -translate-x-1/2 items-start gap-3 rounded-card border border-l-4 border-line bg-raised p-3 shadow-raised transition-[opacity,translate] duration-(--sf-dur-base) ease-out-soft starting:translate-y-2 starting:opacity-0 md:bottom-6 ${s.bar} ${
        leaving ? "translate-y-2 opacity-0" : "opacity-100"
      }`}
    >
      <span aria-hidden="true" className={`mt-px inline-flex size-4.5 shrink-0 [&>svg]:size-full ${s.icon}`}>
        <s.Glyph />
      </span>
      <div className="min-w-0 flex-1 text-sm leading-snug text-fg">
        <p>{toast.text}</p>
        {toast.action && (
          <Link
            href={toast.action.href}
            className="mt-1 inline-flex font-medium text-link underline underline-offset-2 hover:text-link-hover"
          >
            {toast.action.label}
          </Link>
        )}
      </div>
      <Button iconOnly variant="ghost" size="sm" aria-label="Fechar aviso" onClick={dismiss} className="-my-1 -mr-1">
        <Icon.x />
      </Button>
    </div>
  );
}
