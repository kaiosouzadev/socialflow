"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";

type Missing = { client: string; post: string; expected: string };

export default function SyncMediaButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [missing, setMissing] = useState<Missing[]>([]);

  async function sync() {
    setBusy(true);
    setMsg("");
    setMissing([]);
    try {
      const res = await fetch("/api/drive/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg(typeof data?.error === "string" ? data.error : "Falha ao sincronizar.");
        return;
      }
      const skipped = data.skipped?.length ? ` · ${data.skipped.length} ignorado(s)` : "";
      setMsg(`${data.attached} mídia(s) anexada(s) de ${data.checked} verificada(s)${skipped}`);
      setMissing(Array.isArray(data.missing) ? data.missing : []);
      router.refresh();
    } catch {
      setMsg("Falha de conexão ao sincronizar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button onClick={sync} disabled={busy} className="btn-ghost">
        <Icon.refresh className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Sincronizando..." : "Sincronizar mídia"}
      </button>
      {msg && <span className="text-xs text-[var(--color-text-muted)] max-w-xs text-right">{msg}</span>}
      {missing.length > 0 && (
        <div className="max-w-xs w-72 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-left">
          <p className="text-[11px] font-medium text-amber-300 mb-1">
            Sem arte no Drive ({missing.length}):
          </p>
          <ul className="space-y-0.5 max-h-40 overflow-y-auto">
            {missing.map((mi, i) => (
              <li key={i} className="text-[11px] text-amber-200/80">
                {mi.post} — esperado <span className="font-mono">{mi.expected}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
