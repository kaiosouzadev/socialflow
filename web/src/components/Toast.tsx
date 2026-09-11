"use client";

import { useEffect, useState, useCallback } from "react";
import { Icon } from "./Icons";

export type ToastKind = "success" | "error" | "info";

export type ToastState = { kind: ToastKind; text: string } | null;

const STYLE: Record<ToastKind, { ring: string; icon: React.ReactNode }> = {
  success: {
    ring: "border-emerald-500/30 bg-emerald-500/[0.12] text-emerald-100",
    icon: <Icon.check className="w-4 h-4 text-emerald-300" />,
  },
  error: {
    ring: "border-red-500/30 bg-red-500/[0.12] text-red-100",
    icon: <Icon.alert className="w-4 h-4 text-red-300" />,
  },
  info: {
    ring: "border-white/15 bg-white/[0.08] text-zinc-100",
    icon: <Icon.zap className="w-4 h-4 text-[var(--color-accent)]" />,
  },
};

/**
 * Confirmação visível de uma ação que acabou de acontecer.
 * Substitui os avisos em texto pequeno que passavam despercebidos
 * (ex.: "E-mail enviado para ..." na tela de Aprovações).
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
    if (!toast || toast.kind === "error") return;
    const t = setTimeout(dismiss, duration);
    return () => clearTimeout(t);
  }, [toast, duration, dismiss]);

  if (!toast) return null;
  const s = STYLE[toast.kind];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed z-[60] bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm flex items-start gap-3 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur transition-all duration-200 ${s.ring} ${
        leaving ? "opacity-0 translate-y-2" : "opacity-100 translate-y-0 animate-fade-up"
      }`}
    >
      <span className="shrink-0 mt-0.5">{s.icon}</span>
      <p className="flex-1 text-sm leading-snug">{toast.text}</p>
      <button
        onClick={dismiss}
        aria-label="Fechar aviso"
        className="shrink-0 p-0.5 rounded hover:bg-white/10 opacity-70 hover:opacity-100"
      >
        <Icon.x className="w-4 h-4" />
      </button>
    </div>
  );
}
