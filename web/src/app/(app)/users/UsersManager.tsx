"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
};

function RoleBadge({ role }: { role: string }) {
  const isAdmin = role === "admin";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
        isAdmin
          ? "text-violet-200 bg-violet-500/10 border-violet-500/25"
          : "text-zinc-300 bg-white/5 border-white/10"
      }`}
    >
      {isAdmin && <Icon.shield className="w-3 h-3" />}
      {isAdmin ? "Administrador" : "Equipe"}
    </span>
  );
}

function UserRow({ user, currentUserId }: { user: User; currentUserId: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [password, setPassword] = useState("");

  const isSelf = user.id === currentUserId;

  async function save() {
    setBusy(true);
    setError("");
    const payload: Record<string, unknown> = { name, role };
    if (password.trim()) payload.password = password.trim();

    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setError(typeof b?.error === "string" ? b.error : "Erro ao salvar.");
      return;
    }
    setPassword("");
    setEditing(false);
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setError(typeof b?.error === "string" ? b.error : "Erro ao excluir.");
      setBusy(false);
      setConfirming(false);
      return;
    }
    router.refresh();
  }

  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-4">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white shrink-0"
          style={{ background: "linear-gradient(135deg,#8b6dff,#ec4899)" }}
        >
          {user.name[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium flex items-center gap-2">
            {user.name}
            {isSelf && (
              <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">
                você
              </span>
            )}
          </p>
          <p className="text-xs text-[var(--color-text-faint)] truncate">{user.email}</p>
        </div>

        {!editing && (
          <div className="flex items-center gap-3">
            <RoleBadge role={user.role} />
            <button
              onClick={() => setEditing(true)}
              className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-white hover:bg-white/5 transition-colors"
              title="Editar"
            >
              <Icon.edit className="w-4 h-4" />
            </button>
            <button
              onClick={() => setConfirming(true)}
              disabled={isSelf}
              className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-muted)]"
              title={isSelf ? "Você não pode excluir a si mesmo" : "Excluir"}
            >
              <Icon.trash className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Nome</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Papel</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} className="input">
                <option value="staff">Equipe</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label">
              Nova senha{" "}
              <span className="text-[var(--color-text-faint)] font-normal">
                (deixe em branco para manter)
              </span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="Mínimo 8 caracteres"
            />
          </div>
          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setEditing(false);
                setError("");
              }}
              className="btn-ghost !py-2"
            >
              Cancelar
            </button>
            <button onClick={save} disabled={busy} className="btn-primary !py-2">
              {busy ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      )}

      {confirming && (
        <div className="mt-3 flex items-center gap-3 rounded-lg bg-red-500/[0.07] border border-red-500/20 px-3 py-2">
          <span className="text-sm text-red-200 flex-1">Excluir o usuário {user.name}?</span>
          <button
            onClick={remove}
            disabled={busy}
            className="text-sm font-medium text-red-300 hover:text-red-200"
          >
            {busy ? "..." : "Sim, excluir"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="text-sm text-[var(--color-text-muted)] hover:text-white"
          >
            Cancelar
          </button>
        </div>
      )}

      {!editing && error && (
        <p className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}

export default function UsersManager({
  initialUsers,
  currentUserId,
}: {
  initialUsers: User[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));

    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setError(typeof b?.error === "string" ? b.error : "Não foi possível criar o usuário.");
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
            Novo usuário
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={create} className="card p-6 space-y-4">
          <h2 className="font-semibold">Novo usuário</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Nome</label>
              <input name="name" required className="input" placeholder="Nome completo" />
            </div>
            <div>
              <label className="label">Email</label>
              <input name="email" type="email" required className="input" placeholder="email@agencia.com" />
            </div>
            <div>
              <label className="label">Senha</label>
              <input
                name="password"
                type="password"
                required
                minLength={8}
                className="input"
                placeholder="Mínimo 8 caracteres"
              />
            </div>
            <div>
              <label className="label">Papel</label>
              <select name="role" className="input" defaultValue="staff">
                <option value="staff">Equipe</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
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
              {busy ? "Criando..." : "Criar usuário"}
            </button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden divide-y divide-[var(--color-border)]">
        {initialUsers.map((u) => (
          <UserRow key={u.id} user={u} currentUserId={currentUserId} />
        ))}
      </div>
    </div>
  );
}
