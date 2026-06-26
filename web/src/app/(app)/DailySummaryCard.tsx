"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";

export default function DailySummaryCard({
  content,
  generatedAt,
  postCount,
}: {
  content: string | null;
  generatedAt: string | null;
  postCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function regenerate() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/ai/daily-summary", { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      setError("Falha ao gerar resumo.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="card p-6 mb-6 relative overflow-hidden">
      <div
        className="absolute -top-16 -right-10 w-48 h-48 rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: "linear-gradient(135deg,#7c5cff,#ec4899)" }}
      />
      <div className="relative flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "#7c5cff1f", border: "1px solid #7c5cff40", color: "#a78bfa" }}
          >
            <Icon.zap className="w-4 h-4" />
          </div>
          <div>
            <h2 className="font-semibold leading-tight">Resumo do dia</h2>
            <p className="text-xs text-[var(--color-text-faint)]">
              {postCount} {postCount === 1 ? "post hoje" : "posts hoje"}
              {generatedAt && ` · atualizado ${generatedAt}`}
            </p>
          </div>
        </div>
        <button
          onClick={regenerate}
          disabled={busy}
          className="btn-ghost !py-1.5 !px-3 text-xs shrink-0"
          title="Gerar novamente"
        >
          <Icon.refresh className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Gerando…" : "Atualizar"}
        </button>
      </div>

      {content ? (
        <p className="relative text-sm text-[var(--color-text-muted)] whitespace-pre-wrap leading-relaxed">
          {content}
        </p>
      ) : (
        <p className="relative text-sm text-[var(--color-text-muted)]">
          Nenhum resumo gerado ainda hoje.{" "}
          <button onClick={regenerate} disabled={busy} className="text-[var(--color-accent)] hover:underline">
            Gerar agora
          </button>
        </p>
      )}

      {error && <p className="relative mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
