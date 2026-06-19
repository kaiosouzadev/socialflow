"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { BrandBadge } from "@/components/BrandIcons";

type Conn = { id: string; name: string };
type Asset = {
  pageId: string;
  pageName: string;
  instagramId: string | null;
  instagramUsername: string | null;
};

export default function ImportMetaButton({
  clientId,
  connections,
}: {
  clientId: string;
  connections: Conn[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [connId, setConnId] = useState(connections[0]?.id ?? "");
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [connectingId, setConnectingId] = useState("");

  async function loadAssets(id: string) {
    setConnId(id);
    setAssets(null);
    setError("");
    if (!id) return;
    setLoading(true);
    const res = await fetch(`/api/meta/connections/${id}/assets`);
    const data = await res.json().catch(() => null);
    setLoading(false);
    if (!res.ok) {
      setError(typeof data?.error === "string" ? data.error : "Falha ao listar ativos.");
      return;
    }
    setAssets(data.assets ?? []);
  }

  async function connect(a: Asset) {
    setConnectingId(a.pageId);
    setError("");
    const res = await fetch("/api/meta/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        connectionId: connId,
        pageId: a.pageId,
        connectFacebook: true,
        connectInstagram: !!a.instagramId,
      }),
    });
    const data = await res.json().catch(() => null);
    setConnectingId("");
    if (!res.ok) {
      setError(typeof data?.error === "string" ? data.error : "Falha ao conectar.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="btn-ghost">
        <BrandBadge platform="facebook" size={18} />
        Importar do Meta
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 mt-2 w-96 z-20 card p-5 shadow-2xl"
            style={{ backgroundColor: "var(--color-surface)" }}
          >
            <h3 className="font-semibold text-sm mb-3">Importar conta do Meta</h3>

            {connections.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                Nenhuma conexão Meta.{" "}
                <Link href="/meta" className="text-[var(--color-accent)] hover:underline">
                  Conectar um Business Manager
                </Link>{" "}
                primeiro.
              </p>
            ) : (
              <>
                <label className="label">Conexão</label>
                <select
                  value={connId}
                  onChange={(e) => loadAssets(e.target.value)}
                  className="input mb-3"
                >
                  <option value="">Selecione…</option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                {loading && (
                  <p className="text-sm text-[var(--color-text-muted)]">Carregando ativos…</p>
                )}

                {assets && assets.length === 0 && (
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Nenhuma Página nesta conexão.
                  </p>
                )}

                {assets && assets.length > 0 && (
                  <div className="max-h-72 overflow-auto rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                    {assets.map((a) => (
                      <div key={a.pageId} className="flex items-center gap-2 px-3 py-2.5">
                        <BrandBadge platform="facebook" size={20} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{a.pageName}</p>
                          <p className="text-[11px] text-[var(--color-text-faint)]">
                            {a.instagramId ? `IG: @${a.instagramUsername ?? a.instagramId}` : "sem IG"}
                          </p>
                        </div>
                        <button
                          onClick={() => connect(a)}
                          disabled={connectingId === a.pageId}
                          className="btn-primary !py-1.5 !px-3 text-xs"
                        >
                          {connectingId === a.pageId ? "..." : "Conectar"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {error && (
              <p className="mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
