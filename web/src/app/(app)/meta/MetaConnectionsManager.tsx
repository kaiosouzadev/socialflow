"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import { BrandBadge } from "@/components/BrandIcons";

type Connection = {
  id: string;
  name: string;
  businessId: string | null;
  status: string;
  accounts: number;
  createdAt: string;
};

type Asset = {
  pageId: string;
  pageName: string;
  instagramId: string | null;
  instagramUsername: string | null;
};

function ConnectionRow({ conn }: { conn: Connection }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function loadAssets() {
    if (assets) {
      setOpen((v) => !v);
      return;
    }
    setLoading(true);
    setError("");
    const res = await fetch(`/api/meta/connections/${conn.id}/assets`);
    const data = await res.json().catch(() => null);
    setLoading(false);
    if (!res.ok) {
      setError(typeof data?.error === "string" ? data.error : "Falha ao listar ativos.");
      return;
    }
    setAssets(data.assets ?? []);
    setOpen(true);
  }

  async function remove() {
    await fetch(`/api/meta/connections/${conn.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
          style={{ background: "linear-gradient(135deg,#1877f2,#0a5cd6)" }}
        >
          <Icon.link className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{conn.name}</p>
          <p className="text-xs text-[var(--color-text-faint)]">
            {conn.accounts} conta(s) conectada(s)
            {conn.businessId ? ` · business ${conn.businessId}` : ""}
          </p>
        </div>
        <button onClick={loadAssets} disabled={loading} className="btn-ghost !py-2 text-xs">
          <Icon.users className="w-3.5 h-3.5" />
          {loading ? "Carregando..." : open ? "Ocultar ativos" : "Ver ativos"}
        </button>
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Remover conexão"
          >
            <Icon.trash className="w-4 h-4" />
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={remove} className="text-xs font-medium text-red-300 hover:text-red-200">
              Remover
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="text-xs text-[var(--color-text-muted)] hover:text-white"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {open && assets && (
        <div className="mt-4 rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
          {assets.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[var(--color-text-muted)]">
              Nenhuma Página encontrada neste Business.
            </p>
          ) : (
            assets.map((a) => (
              <div key={a.pageId} className="flex items-center gap-3 px-4 py-3">
                <BrandBadge platform="facebook" size={22} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{a.pageName}</p>
                  <p className="text-xs text-[var(--color-text-faint)] font-mono">{a.pageId}</p>
                </div>
                {a.instagramId ? (
                  <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                    <BrandBadge platform="instagram" size={18} />
                    @{a.instagramUsername ?? a.instagramId}
                  </div>
                ) : (
                  <span className="text-xs text-[var(--color-text-faint)]">sem IG vinculado</span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function MetaConnectionsManager({ initial }: { initial: Connection[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const res = await fetch("/api/meta/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: data.name || undefined, token: data.token }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(typeof body?.error === "string" ? body.error : "Não foi possível conectar.");
      return;
    }
    setCreating(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {!creating && (
          <button onClick={() => setCreating(true)} className="btn-primary">
            <Icon.plus className="w-4 h-4" />
            Nova conexão
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={create} className="card p-6 space-y-4">
          <h2 className="font-semibold">Conectar Business Manager</h2>
          <div className="flex items-start gap-3 rounded-lg bg-sky-500/[0.07] border border-sky-500/20 px-4 py-3 text-sm text-sky-200/90">
            <Icon.alert className="w-5 h-5 shrink-0 mt-0.5" />
            <span>
              Cole o <strong>System User token</strong> do Business Manager. O token é validado na
              Meta e armazenado criptografado. Ele lista as Páginas e contas Instagram que o
              Business administra.
            </span>
          </div>
          <div>
            <label className="label">
              Nome <span className="text-[var(--color-text-faint)] font-normal">(opcional)</span>
            </label>
            <input name="name" className="input" placeholder="Ex: Business da Agência" />
          </div>
          <div>
            <label className="label">System User token</label>
            <textarea
              name="token"
              required
              rows={3}
              className="input resize-none font-mono text-xs"
              placeholder="EAAB..."
            />
          </div>
          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setError("");
              }}
              className="btn-ghost"
            >
              Cancelar
            </button>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? "Validando..." : "Conectar"}
            </button>
          </div>
        </form>
      )}

      {initial.length === 0 && !creating ? (
        <div className="card px-6 py-12 text-center text-sm text-[var(--color-text-muted)]">
          Nenhuma conexão. Conecte o Business Manager da agência para importar as contas dos clientes.
        </div>
      ) : (
        <div className="card overflow-hidden divide-y divide-[var(--color-border)]">
          {initial.map((c) => (
            <ConnectionRow key={c.id} conn={c} />
          ))}
        </div>
      )}
    </div>
  );
}
