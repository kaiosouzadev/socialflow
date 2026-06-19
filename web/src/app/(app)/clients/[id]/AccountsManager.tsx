"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { StatusBadge } from "@/components/ui";
import { BrandBadge, BRAND } from "@/components/BrandIcons";
import { formatDate } from "@/lib/format-date";
import ImportMetaButton from "./ImportMetaButton";

type Account = {
  id: string;
  platform: string;
  externalId: string;
  status: string;
  dailyPostLimit: number;
  tokenExpiresAt: string | null;
};

const idHint: Record<string, string> = {
  instagram: "User ID da conta Business/Creator",
  facebook: "Page ID da página do Facebook",
  linkedin: "URN da organização",
};

function AccountRow({ account }: { account: Account }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [externalId, setExternalId] = useState(account.externalId);
  const [accessToken, setAccessToken] = useState("");
  const [limit, setLimit] = useState(account.dailyPostLimit);
  const [status, setStatus] = useState(account.status);

  const label = BRAND[account.platform]?.label ?? account.platform;

  async function save() {
    setBusy(true);
    setError("");

    const payload: Record<string, unknown> = {
      externalId,
      dailyPostLimit: limit,
      status,
    };
    // only send a new token if one was typed (keeps the current one otherwise)
    if (accessToken.trim()) payload.accessToken = accessToken.trim();

    const res = await fetch(`/api/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setBusy(false);
    if (!res.ok) {
      setError("Não foi possível salvar. Verifique os campos.");
      return;
    }
    setAccessToken("");
    setEditing(false);
    router.refresh();
  }

  function cancel() {
    setExternalId(account.externalId);
    setAccessToken("");
    setLimit(account.dailyPostLimit);
    setStatus(account.status);
    setError("");
    setEditing(false);
  }

  async function remove() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/accounts/${account.id}`, { method: "DELETE" });
    if (!res.ok) {
      setBusy(false);
      setConfirming(false);
      setError("Não foi possível excluir a conta.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-4">
        <BrandBadge platform={account.platform} size={38} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-[var(--color-text-faint)] truncate font-mono">
            {account.externalId}
          </p>
        </div>

        {!editing && (
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <StatusBadge status={account.status} />
              <p className="text-xs text-[var(--color-text-faint)] mt-1">
                {account.dailyPostLimit}/dia
                {account.tokenExpiresAt &&
                  ` · token até ${formatDate(account.tokenExpiresAt)}`}
              </p>
            </div>
            <button
              onClick={() => setEditing(true)}
              className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-white hover:bg-white/5 transition-colors"
              title="Editar"
            >
              <Icon.edit className="w-4 h-4" />
            </button>
            <button
              onClick={() => setConfirming(true)}
              className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Excluir"
            >
              <Icon.trash className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-4 space-y-4">
          <div>
            <label className="label">
              ID externo{" "}
              <span className="text-[var(--color-text-faint)] font-normal">
                ({idHint[account.platform] ?? "ID da conta"})
              </span>
            </label>
            <input
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              className="input font-mono"
            />
          </div>

          <div>
            <label className="label">
              Access Token{" "}
              <span className="text-[var(--color-text-faint)] font-normal">
                (deixe em branco para manter o atual)
              </span>
            </label>
            <textarea
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              rows={2}
              placeholder="Cole um novo token apenas se for atualizar…"
              className="input font-mono text-xs resize-none"
            />
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">Limite diário</label>
              <input
                type="number"
                min={1}
                max={200}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="input w-28"
              />
            </div>
            <div>
              <label className="label">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="input w-36"
              >
                <option value="active">Ativa</option>
                <option value="inactive">Inativa</option>
              </select>
            </div>
            <div className="flex gap-2 ml-auto">
              <button onClick={cancel} className="btn-ghost !py-2">
                Cancelar
              </button>
              <button onClick={save} disabled={busy} className="btn-primary !py-2">
                {busy ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>
      )}

      {!editing && error && (
        <p className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {confirming && (
        <div className="mt-3 flex items-center gap-3 rounded-lg bg-red-500/[0.07] border border-red-500/20 px-3 py-2">
          <span className="text-sm text-red-200 flex-1">
            Excluir esta conta {label}? Posts em fila para ela podem falhar.
          </span>
          <button
            onClick={remove}
            disabled={busy}
            className="text-sm font-medium text-red-300 hover:text-red-200"
          >
            {busy ? "Excluindo..." : "Sim, excluir"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="text-sm text-[var(--color-text-muted)] hover:text-white"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

export default function AccountsManager({
  clientId,
  accounts,
  metaConnections = [],
}: {
  clientId: string;
  accounts: Account[];
  metaConnections?: { id: string; name: string }[];
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between gap-2">
        <h2 className="font-semibold">Contas sociais</h2>
        <div className="flex items-center gap-3">
          <ImportMetaButton clientId={clientId} connections={metaConnections} />
          <Link
            href={`/clients/${clientId}/accounts/new`}
            className="text-sm text-[var(--color-accent)] hover:underline flex items-center gap-1"
          >
            <Icon.plus className="w-4 h-4" />
            Manual
          </Link>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-[var(--color-text-muted)]">
          Nenhuma conta conectada.{" "}
          <Link
            href={`/clients/${clientId}/accounts/new`}
            className="text-[var(--color-accent)] hover:underline"
          >
            Adicionar conta
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-[var(--color-border)]">
          {accounts.map((acc) => (
            <AccountRow key={acc.id} account={acc} />
          ))}
        </div>
      )}
    </div>
  );
}
