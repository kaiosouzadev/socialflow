"use client";

import { useId, useState } from "react";
import { Button } from "./Button";
import { toUserMessage } from "@/lib/user-facing-error";

const CAPTION_ERROR = "Não foi possível gerar a legenda agora. Tente de novo em instantes.";

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
  const errorId = useId();

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
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(toUserMessage(data, CAPTION_ERROR));
        return;
      }
      onResult(data?.captions ?? {});
    } catch {
      setError("Falha de conexão com a IA. Verifique a internet e tente de novo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        leadingIcon={<SparkleIcon />}
        loading={loading}
        loadingText="Gerando…"
        disabled={disabled}
        aria-describedby={error ? errorId : undefined}
        onClick={generate}
        title={disabled ? "Selecione um cliente primeiro" : "Gerar legenda com IA"}
      >
        Gerar com IA
      </Button>
      {error && (
        <span id={errorId} role="alert" className="text-xs font-medium text-danger-fg">
          {error}
        </span>
      )}
    </span>
  );
}
