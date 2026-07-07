"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";

export default function GenerateArtButton({ postId }: { postId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/posts/${postId}/generate-art`, { method: "POST" });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(typeof data?.error === "string" ? data.error : "Falha ao gerar arte.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={generate} disabled={busy} className="btn-ghost" title="Gera a arte via IA a partir da arte-base + logo + cor">
        <Icon.zap className={`w-4 h-4 ${busy ? "animate-pulse" : ""}`} />
        {busy ? "Gerando arte…" : "Gerar arte (IA)"}
      </button>
      {error && <span className="text-xs text-red-400 max-w-xs text-right">{error}</span>}
    </div>
  );
}
