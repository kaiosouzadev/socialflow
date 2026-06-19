"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import DriveFolderPicker from "@/components/DriveFolderPicker";

type Client = {
  id: string;
  name: string;
  email: string;
  plan: string;
  toneOfVoice: string | null;
  driveFolderId: string | null;
};

const planLabel: Record<string, string> = {
  sem_aprovacao: "Auto-publicação",
  aprovacao_cliente: "Com aprovação",
};

export default function ClientInfoEditor({ client }: { client: Client }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState(client.name);
  const [email, setEmail] = useState(client.email);
  const [plan, setPlan] = useState(client.plan);
  const [tone, setTone] = useState(client.toneOfVoice ?? "");
  const [driveFolderId, setDriveFolderId] = useState(client.driveFolderId ?? "");

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/clients/${client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, plan, toneOfVoice: tone, driveFolderId }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Não foi possível salvar. Verifique os dados.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  function cancel() {
    setName(client.name);
    setEmail(client.email);
    setPlan(client.plan);
    setTone(client.toneOfVoice ?? "");
    setDriveFolderId(client.driveFolderId ?? "");
    setError("");
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="card p-6">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-semibold text-white shrink-0"
              style={{ background: "linear-gradient(135deg,#7c5cff,#ec4899)" }}
            >
              {client.name[0]?.toUpperCase()}
            </div>
            <div>
              <h2 className="text-xl font-semibold">{client.name}</h2>
              <p className="text-sm text-[var(--color-text-muted)]">{client.email}</p>
            </div>
          </div>
          <button onClick={() => setEditing(true)} className="btn-ghost !py-2 !px-3 text-xs">
            <Icon.edit className="w-3.5 h-3.5" />
            Editar
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider mb-1">
              Plano
            </p>
            <p className="text-sm">{planLabel[client.plan] ?? client.plan}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider mb-1">
              Tom de voz
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">
              {client.toneOfVoice || "Não definido"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Editar cliente</h2>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Nome</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </div>
        <div>
          <label className="label">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
        </div>
      </div>

      <div>
        <label className="label">Plano</label>
        <select value={plan} onChange={(e) => setPlan(e.target.value)} className="input">
          <option value="sem_aprovacao">Auto-publicação (sem aprovação)</option>
          <option value="aprovacao_cliente">Com aprovação do cliente</option>
        </select>
      </div>

      <div>
        <label className="label">Tom de voz</label>
        <textarea
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          rows={3}
          className="input resize-none"
          placeholder="Ex: Tom profissional e próximo..."
        />
      </div>

      <div>
        <label className="label">
          Pasta no Drive{" "}
          <span className="text-[var(--color-text-faint)] font-normal">
            (opcional — selecione a pasta; vazio = busca pelo nome do cliente)
          </span>
        </label>
        <DriveFolderPicker value={driveFolderId} onChange={setDriveFolderId} />
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-3 pt-1">
        <button onClick={cancel} className="btn-ghost flex-1">
          Cancelar
        </button>
        <button onClick={save} disabled={saving} className="btn-primary flex-1">
          {saving ? "Salvando..." : "Salvar alterações"}
        </button>
      </div>
    </div>
  );
}
