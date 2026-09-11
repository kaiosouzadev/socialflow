"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";

/** Reenvio de um post específico, direto da lista onde ele aparece. */
export default function RetryPostButton({
  postId,
  label = "Reenviar",
}: {
  postId: string;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function retry() {
    setBusy(true);
    try {
      const r = await fetch("/api/posts/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "ids", ids: [postId] }),
      });
      if (r.ok) {
        setDone(true);
        router.refresh();
      }
    } catch {
      /* silêncio aqui: o status do post na própria lista mostra o resultado */
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return <span className="text-[11px] text-emerald-300 shrink-0">na fila ✓</span>;
  }

  return (
    <button
      onClick={retry}
      disabled={busy}
      title="Recoloca este post na fila de publicação"
      className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-accent)] hover:underline disabled:opacity-40"
    >
      <Icon.refresh className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} />
      {busy ? "..." : label}
    </button>
  );
}
