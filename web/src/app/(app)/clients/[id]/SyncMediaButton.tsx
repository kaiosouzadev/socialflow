"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";

export default function SyncMediaButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function sync() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/drive/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setMsg(typeof data?.error === "string" ? data.error : "Falha ao sincronizar.");
      return;
    }
    const skipped = data.skipped?.length
      ? ` · ${data.skipped.length} ignorado(s)`
      : "";
    setMsg(`${data.attached} mídia(s) anexada(s) de ${data.checked} verificada(s)${skipped}`);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={sync} disabled={busy} className="btn-ghost">
        <Icon.refresh className="w-4 h-4" />
        {busy ? "Sincronizando..." : "Sincronizar mídia"}
      </button>
      {msg && <span className="text-xs text-[var(--color-text-muted)] max-w-xs text-right">{msg}</span>}
    </div>
  );
}
