"use client";

import { useState, useEffect } from "react";
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
  const [query, setQuery] = useState("");

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

  // load assets for the preselected connection as soon as the modal opens.
  // deferred so the effect doesn't call setState synchronously in its body.
  useEffect(() => {
    if (open && connId && assets === null && !loading) {
      const t = setTimeout(() => loadAssets(connId), 0);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    setError("");
    setQuery("");
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
    close();
    router.refresh();
  }

  const filtered =
    assets?.filter((a) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        a.pageName.toLowerCase().includes(q) ||
        a.pageId.includes(q) ||
        (a.instagramUsername ?? "").toLowerCase().includes(q)
      );
    }) ?? null;

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-ghost">
        <BrandBadge platform="facebook" size={18} />
        Importar do Meta
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-up"
            onClick={close}
          />
          <div
            className="relative z-10 w-full max-w-xl card shadow-2xl flex flex-col max-h-[85vh]"
            style={{ backgroundColor: "var(--color-surface)" }}
          >
            {/* header */}
            <div className="px-6 py-5 border-b border-[var(--color-border)] flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <BrandBadge platform="facebook" size={34} />
                <div>
                  <h3 className="font-semibold">Importar conta do Meta</h3>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    Escolha a conexão e vincule uma Página a este cliente.
                  </p>
                </div>
              </div>
              <button
                onClick={close}
                className="p-2 -mr-2 rounded-lg text-[var(--color-text-muted)] hover:text-white hover:bg-white/5 transition-colors"
                title="Fechar"
              >
                <Icon.x className="w-4 h-4" />
              </button>
            </div>

            {connections.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-[var(--color-text-muted)]">
                Nenhuma conexão Meta.{" "}
                <Link href="/meta" className="text-[var(--color-accent)] hover:underline">
                  Conectar um Business Manager
                </Link>{" "}
                primeiro.
              </div>
            ) : (
              <>
                {/* controls */}
                <div className="px-6 pt-5 pb-3 space-y-3">
                  <div>
                    <label className="label">Conexão</label>
                    <select
                      value={connId}
                      onChange={(e) => loadAssets(e.target.value)}
                      className="input"
                    >
                      <option value="">Selecione…</option>
                      {connections.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {assets && assets.length > 0 && (
                    <div className="relative">
                      <Icon.search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)] pointer-events-none" />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Buscar página…"
                        className="input pl-9"
                      />
                    </div>
                  )}
                </div>

                {/* page list */}
                <div className="flex-1 overflow-auto px-6 pb-6">
                  {loading && (
                    <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">
                      Carregando páginas…
                    </div>
                  )}

                  {!loading && !connId && (
                    <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">
                      Selecione uma conexão para ver as páginas.
                    </div>
                  )}

                  {!loading && assets && assets.length === 0 && (
                    <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">
                      Nenhuma Página nesta conexão.
                    </div>
                  )}

                  {!loading && filtered && filtered.length === 0 && assets!.length > 0 && (
                    <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">
                      Nenhuma página corresponde a “{query}”.
                    </div>
                  )}

                  {!loading && filtered && filtered.length > 0 && (
                    <div className="rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-border)] overflow-hidden">
                      {filtered.map((a) => (
                        <div
                          key={a.pageId}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
                        >
                          <BrandBadge platform="facebook" size={32} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{a.pageName}</p>
                            <p className="text-[11px] text-[var(--color-text-faint)] font-mono truncate">
                              {a.pageId}
                            </p>
                            {a.instagramId ? (
                              <span className="inline-flex items-center gap-1 mt-1 text-[11px] text-[var(--color-text-muted)]">
                                <BrandBadge platform="instagram" size={14} />
                                @{a.instagramUsername ?? a.instagramId}
                              </span>
                            ) : (
                              <span className="inline-block mt-1 text-[11px] text-[var(--color-text-faint)]">
                                sem Instagram vinculado
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => connect(a)}
                            disabled={connectingId === a.pageId}
                            className="btn-primary !py-1.5 !px-3 text-xs shrink-0"
                          >
                            {connectingId === a.pageId ? (
                              "Conectando…"
                            ) : (
                              <>
                                <Icon.link className="w-3.5 h-3.5" />
                                Vincular
                              </>
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {error && (
                    <p className="mt-4 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                      {error}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
