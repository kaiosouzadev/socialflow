"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icons";
import { toUserMessage } from "@/lib/user-facing-error";

const FALLBACK = "Não foi possível gerar a arte agora. Tente de novo em instantes.";

export default function GenerateArtButton({ postId }: { postId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/posts/${postId}/generate-art`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        // N-14/A-048: só texto amigável; objeto, termo técnico ou URL viram a mensagem padrão
        setError(toUserMessage(typeof data?.error === "string" ? data.error : null, FALLBACK));
        return;
      }
      router.refresh();
    } catch {
      setError("Falha de conexão ao gerar a arte. Verifique a internet e tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 sm:items-end">
      <Button
        variant="secondary"
        leadingIcon={<Icon.zap />}
        loading={busy}
        loadingText="Gerando arte… (~1 min)"
        onClick={() => void generate()}
        title="Gera a arte com IA a partir da arte-base, da logo e da cor do cliente"
      >
        Gerar arte com IA
      </Button>
      {error && (
        <p role="alert" className="max-w-xs text-xs font-medium text-danger-fg sm:text-right">
          {error}
        </p>
      )}
    </div>
  );
}
