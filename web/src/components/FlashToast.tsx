"use client";

import { useEffect, useState } from "react";
import { Toast, type ToastKind, type ToastState } from "./Toast";

/**
 * Aviso que sobrevive a um `router.refresh()` que desmonta quem o disparou
 * (ex.: o botão "Excluir" some quando o post vira publicado e a exclusão é recusada).
 * Quem dispara chama `flashToast(...)`; o `<FlashToast />` montado no layout mostra.
 */
const KEY = "sf-flash-toast";
const EVENT = "sf-flash-toast";

export function flashToast(text: string, kind: ToastKind = "error") {
  const payload = JSON.stringify({ kind, text });
  try {
    sessionStorage.setItem(KEY, payload);
  } catch {
    /* sem storage: só o evento */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: payload }));
}

function parse(raw: string | null): ToastState {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { kind?: unknown; text?: unknown };
    const kind = v.kind === "success" || v.kind === "info" ? v.kind : "error";
    return typeof v.text === "string" && v.text ? { kind, text: v.text.slice(0, 300) } : null;
  } catch {
    return null;
  }
}

function take(): ToastState {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return parse(raw);
  } catch {
    return null;
  }
}

export function FlashToast() {
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    const onFlash = () => {
      const next = take();
      if (next) setToast(next);
    };
    window.addEventListener(EVENT, onFlash);
    // aviso pendente de antes de um refresh/navegação (lido fora do corpo do efeito)
    const pending = window.setTimeout(onFlash, 0);
    return () => {
      window.removeEventListener(EVENT, onFlash);
      window.clearTimeout(pending);
    };
  }, []);

  return <Toast toast={toast} onClose={() => setToast(null)} />;
}
