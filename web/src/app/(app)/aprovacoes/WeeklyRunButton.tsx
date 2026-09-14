"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";

/**
 * Dispara manualmente o envio dos links semanais (posts completos da próxima
 * semana). O mesmo processo roda automático quarta/quinta via cron.
 */
export default function WeeklyRunButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function run() {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/internal/weekly/run", { method: "POST" });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg(typeof d?.error === "string" ? d.error : "Falha ao rodar o envio semanal.");
        return;
      }
      const sent = d.reviews?.length ?? 0;
      const post = d.postponed?.length ?? 0;
      setMsg(
        `${sent} link(s) semanal(is) ${sent ? "enviado(s)" : ""}${sent === 0 ? "nenhum link enviado" : ""}` +
          `${d.contentGenerated ? ` · ${d.contentGenerated} conteúdo(s) gerado(s)` : ""}` +
          `${post ? ` · ${post} post(s) sem arte adiado(s)` : ""}` +
          `${d.skipped?.length ? ` · ${d.skipped.length} cliente(s) pulado(s)` : ""}`
      );
      router.refresh();
    } catch {
      setMsg("Falha de conexão. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={busy}
        className="btn-primary"
        title="Gera conteúdo pendente, adia posts sem arte e envia os links da próxima semana"
      >
        <Icon.send className={`w-4 h-4 ${busy ? "animate-pulse" : ""}`} />
        {busy ? "Preparando semana..." : "Enviar links da semana"}
      </button>
      {msg && <span className="text-xs text-[var(--color-text-muted)] max-w-md text-right">{msg}</span>}
    </div>
  );
}
