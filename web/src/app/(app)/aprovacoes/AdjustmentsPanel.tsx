"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icons";

type Row = {
  id: string;
  comment: string;
  createdAt: string;
  postId: string;
  postTheme: string;
  clientName: string;
  month: string;
};

function AdjustmentRow({ row }: { row: Row }) {
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [showReply, setShowReply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function resolve() {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`/api/adjustments/${row.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: reply.trim() || undefined }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg(typeof d?.error === "string" ? d.error : "Erro ao concluir o ajuste.");
        return;
      }
      setMsg(
        d.autoApproved
          ? "Ajuste concluído — cronograma aprovado automaticamente (prazo vencido) ✓"
          : "Ajuste concluído ✓ — cliente avisado para revisar e aprovar."
      );
      router.refresh();
    } catch {
      setMsg("Falha de conexão. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 py-4 space-y-2.5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{row.clientName}</p>
            <span className="text-[var(--color-text-faint)] text-sm">·</span>
            <span className="text-sm text-[var(--color-text-muted)] capitalize">{row.month}</span>
          </div>
          <Link
            href={`/posts/${row.postId}`}
            className="text-xs text-[var(--color-accent)] hover:underline"
          >
            {row.postTheme || "Abrir post"}
          </Link>
          <p className="text-[11px] text-[var(--color-text-faint)] mt-0.5">
            Pedido em {row.createdAt}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowReply((v) => !v)}
            className="btn-ghost !py-2 text-xs"
          >
            {showReply ? "Sem resposta" : "Responder"}
          </button>
          <button onClick={resolve} disabled={busy} className="btn-primary !py-2 text-xs">
            <Icon.check className="w-3.5 h-3.5" />
            {busy ? "Concluindo..." : "Concluir ajuste"}
          </button>
        </div>
      </div>

      <p className="text-sm whitespace-pre-wrap leading-relaxed rounded-lg bg-amber-500/[0.06] border border-amber-500/25 px-3 py-2">
        {row.comment}
      </p>

      {showReply && (
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={2}
          className="input text-sm resize-y"
          placeholder="Resposta opcional que o cliente verá (ex: 'Trocamos o tema para focar em resultados')…"
        />
      )}

      {msg && <p className="text-xs text-[var(--color-text-muted)]">{msg}</p>}
    </div>
  );
}

export default function AdjustmentsPanel({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/15 border border-amber-500/30">
          <Icon.alert className="w-3.5 h-3.5 text-amber-300" />
        </span>
        <h2 className="font-semibold">
          Ajustes solicitados pelos clientes
          <span className="ml-2 text-sm font-normal text-[var(--color-text-muted)]">
            {rows.length} pendente(s) — a aprovação do cronograma fica bloqueada até concluir
          </span>
        </h2>
      </div>
      <div className="card overflow-hidden divide-y divide-[var(--color-border)] border-amber-500/20">
        {rows.map((r) => (
          <AdjustmentRow key={r.id} row={r} />
        ))}
      </div>
    </div>
  );
}
