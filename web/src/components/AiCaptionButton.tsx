"use client";

import { useState } from "react";

function SparkleIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3Z" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z" />
    </svg>
  );
}

export function AiCaptionButton({
  clientId,
  theme,
  targets,
  disabled,
  onResult,
}: {
  clientId: string;
  theme: string;
  targets: string[];
  disabled?: boolean;
  onResult: (captions: Record<string, string>) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    if (targets.length === 0) {
      setError("Selecione uma rede.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ai/caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, theme, targets }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Falha ao gerar.");
        return;
      }
      onResult(data.captions ?? {});
    } catch {
      setError("Falha de conexão com a IA.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={generate}
        disabled={disabled || loading}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border border-[var(--color-border)] text-[var(--color-accent)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-accent)]/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title={disabled ? "Selecione um cliente primeiro" : "Gerar legenda com IA"}
      >
        <SparkleIcon className="w-3.5 h-3.5" />
        {loading ? "Gerando..." : "Gerar com IA"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
