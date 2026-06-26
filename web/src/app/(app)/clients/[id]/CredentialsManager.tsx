"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";

type Credential = { network: string; login: string; password: string; note?: string };

export default function CredentialsManager({
  clientId,
  hasCredentials,
}: {
  clientId: string;
  hasCredentials: boolean;
}) {
  const router = useRouter();
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Credential[]>([]);
  const [show, setShow] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(thenEdit = false) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/clients/${clientId}/credentials`);
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError("Falha ao carregar credenciais.");
      return;
    }
    setRows(data.credentials ?? []);
    setRevealed(true);
    if (thenEdit) setEditing(true);
  }

  function startNew() {
    setRows([{ network: "", login: "", password: "", note: "" }]);
    setRevealed(true);
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/clients/${clientId}/credentials`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentials: rows }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Falha ao salvar.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  const setRow = (i: number, patch: Partial<Credential>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon.shield className="w-4 h-4 text-[var(--color-text-muted)]" />
          <h2 className="font-semibold">Credenciais</h2>
          <span className="text-xs text-[var(--color-text-faint)]">(criptografadas)</span>
        </div>
        <div className="flex gap-2">
          {!editing && hasCredentials && !revealed && (
            <button onClick={() => load(false)} disabled={busy} className="btn-ghost !py-2 !px-3 text-xs">
              {busy ? "..." : "Revelar"}
            </button>
          )}
          {!editing && (revealed || !hasCredentials) && (
            <button
              onClick={() => (revealed ? setEditing(true) : startNew())}
              className="btn-ghost !py-2 !px-3 text-xs"
            >
              <Icon.edit className="w-3.5 h-3.5" />
              {hasCredentials ? "Editar" : "Adicionar"}
            </button>
          )}
        </div>
      </div>

      {!revealed && hasCredentials && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Credenciais salvas e criptografadas. Clique em <b>Revelar</b> para visualizar.
        </p>
      )}
      {!revealed && !hasCredentials && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Nenhuma credencial cadastrada.
        </p>
      )}

      {revealed && !editing && (
        <div className="space-y-2">
          {rows.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">Nenhuma credencial.</p>
          )}
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-3 text-sm rounded-lg bg-white/[0.02] border border-[var(--color-border)] px-3 py-2">
              <span className="w-24 font-medium shrink-0">{r.network}</span>
              <span className="text-[var(--color-text-muted)] truncate flex-1">{r.login || "—"}</span>
              <span className="font-mono text-[var(--color-text-muted)] w-40 truncate">
                {show[i] ? r.password : "••••••••"}
              </span>
              <button
                onClick={() => setShow({ ...show, [i]: !show[i] })}
                className="text-xs text-[var(--color-accent)] hover:underline shrink-0"
              >
                {show[i] ? "ocultar" : "ver"}
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input
                placeholder="rede"
                value={r.network}
                onChange={(e) => setRow(i, { network: e.target.value })}
                className="input col-span-3 !py-1.5"
              />
              <input
                placeholder="login"
                value={r.login}
                onChange={(e) => setRow(i, { login: e.target.value })}
                className="input col-span-4 !py-1.5"
              />
              <input
                placeholder="senha"
                value={r.password}
                onChange={(e) => setRow(i, { password: e.target.value })}
                className="input col-span-4 !py-1.5 font-mono"
              />
              <button
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                className="col-span-1 p-2 rounded-lg text-[var(--color-text-muted)] hover:text-red-400"
                title="Remover"
              >
                <Icon.trash className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            onClick={() => setRows([...rows, { network: "", login: "", password: "", note: "" }])}
            className="text-sm text-[var(--color-accent)] hover:underline flex items-center gap-1"
          >
            <Icon.plus className="w-4 h-4" /> Adicionar rede
          </button>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button onClick={() => { setEditing(false); }} className="btn-ghost flex-1">Cancelar</button>
            <button onClick={save} disabled={busy} className="btn-primary flex-1">
              {busy ? "Salvando..." : "Salvar credenciais"}
            </button>
          </div>
        </div>
      )}

      {error && !editing && <p className="text-sm text-red-400 mt-2">{error}</p>}
    </div>
  );
}
