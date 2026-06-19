"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";

export default function ApprovePostButton({
  postId,
  hasMedia,
}: {
  postId: string;
  hasMedia: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function approve() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/posts/${postId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "scheduled" }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Não foi possível agendar.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={approve} disabled={busy} className="btn-primary">
        <Icon.check className="w-4 h-4" />
        {busy ? "Agendando..." : "Aprovar e agendar"}
      </button>
      {!hasMedia && (
        <span className="text-xs text-amber-300/90">Dica: adicione a mídia antes de publicar.</span>
      )}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
