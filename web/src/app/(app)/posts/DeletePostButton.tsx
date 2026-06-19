"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";

export default function DeletePostButton({ postId }: { postId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function remove() {
    setLoading(true);
    setError(false);
    const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
    setLoading(false);
    if (!res.ok) {
      setError(true);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  if (confirming) {
    return (
      <div className="flex items-center justify-end gap-2">
        {error && <span className="text-xs text-red-400">Falhou</span>}
        <button
          onClick={remove}
          disabled={loading}
          className="text-xs font-medium text-red-300 hover:text-red-200"
        >
          {loading ? "..." : error ? "Tentar de novo" : "Excluir"}
        </button>
        <button
          onClick={() => {
            setConfirming(false);
            setError(false);
          }}
          className="text-xs text-[var(--color-text-muted)] hover:text-white"
        >
          Cancelar
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="p-1.5 rounded-lg text-[var(--color-text-faint)] hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
      title="Excluir agendamento"
    >
      <Icon.trash className="w-4 h-4" />
    </button>
  );
}
