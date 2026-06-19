"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";

export default function DeleteClientButton({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function handleDelete() {
    setLoading(true);
    setError(false);
    const res = await fetch(`/api/clients/${clientId}`, { method: "DELETE" });
    if (!res.ok) {
      setLoading(false);
      setError(true);
      return;
    }
    router.push("/clients");
    router.refresh();
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-red-500/[0.07] border border-red-500/20 px-3 py-2">
        <span className="text-sm text-red-200">
          {error ? "Não foi possível excluir. Tentar de novo?" : `Excluir ${clientName} e todos os dados?`}
        </span>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="text-sm font-medium text-red-300 hover:text-red-200"
        >
          {loading ? "Excluindo..." : "Sim"}
        </button>
        <button
          onClick={() => {
            setConfirming(false);
            setError(false);
          }}
          className="text-sm text-[var(--color-text-muted)] hover:text-white"
        >
          Não
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="btn-ghost !py-2 hover:!text-red-400 hover:!border-red-500/30"
    >
      <Icon.trash className="w-4 h-4" />
      Excluir
    </button>
  );
}
