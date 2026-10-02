"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/Dialog";
import { Toast, type ToastState } from "@/components/Toast";
import { toUserMessage } from "@/lib/user-facing-error";

const FALLBACK_ERROR = "Não foi possível enviar os links da semana. Tente de novo em instantes.";

function length(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

/** Resumo do que o envio fez, com plural certo. */
function summary(d: unknown): { kind: "success" | "info"; text: string } {
  const r = (d ?? {}) as { reviews?: unknown; postponed?: unknown; skipped?: unknown; contentGenerated?: unknown };
  const sent = length(r.reviews);
  const postponed = length(r.postponed);
  const skipped = length(r.skipped);
  const generated = typeof r.contentGenerated === "number" ? r.contentGenerated : 0;
  const parts = [
    sent === 0
      ? "Nenhum link semanal foi enviado."
      : sent === 1
        ? "Link da semana enviado para 1 cliente."
        : `Links da semana enviados para ${sent} clientes.`,
  ];
  if (generated > 0) parts.push(generated === 1 ? "1 conteúdo gerado com IA." : `${generated} conteúdos gerados com IA.`);
  if (postponed > 0) parts.push(postponed === 1 ? "1 post sem arte adiado." : `${postponed} posts sem arte adiados.`);
  if (skipped > 0) parts.push(skipped === 1 ? "1 cliente ficou de fora." : `${skipped} clientes ficaram de fora.`);
  return { kind: sent > 0 ? "success" : "info", text: parts.join(" ") };
}

/**
 * Dispara manualmente o envio dos links semanais (posts completos da próxima
 * semana). O mesmo processo roda automático quarta/quinta via cron. Como gera
 * conteúdo com IA, adia posts e manda e-mails a clientes, só roda depois de
 * confirmado no diálogo (A-002).
 */
export default function WeeklyRunButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  function openDialog() {
    setError(null);
    setOpen(true);
  }

  function close() {
    if (busy) return;
    setOpen(false);
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/internal/weekly/run", { method: "POST" });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        // N-14 + A-048: só texto, e sem detalhe técnico (o 500 já vem do toUserMessage da rota; aqui é só defesa)
        setError(typeof d?.error === "string" ? toUserMessage(d.error, FALLBACK_ERROR) : FALLBACK_ERROR);
        return;
      }
      setOpen(false);
      setToast(summary(d));
      router.refresh();
    } catch {
      setError("Falha de conexão. Verifique a internet e tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" leadingIcon={<Icon.send />} onClick={openDialog}>
        Enviar links da semana
      </Button>
      <ConfirmDialog
        open={open}
        title="Enviar os links da semana?"
        description="Vale para os posts da próxima semana de todos os clientes com aprovação e cronograma aprovado."
        consequences={[
          "Gera com IA o conteúdo que falta (legendas e roteiros).",
          "Adia em 7 dias os posts sem arte e avisa a equipe.",
          "Envia por e-mail o link semanal aos clientes com aprovação.",
        ]}
        confirmLabel="Enviar links da semana"
        busy={busy}
        busyLabel="Preparando a semana…"
        error={error}
        onConfirm={() => void run()}
        onCancel={close}
      >
        <p className="text-fg-muted">Pode levar alguns minutos.</p>
      </ConfirmDialog>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}
