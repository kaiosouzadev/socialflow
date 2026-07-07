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
  logoUrl: string | null;
  brandColor: string | null;
  tier: string;
  showContacts: boolean;
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
  const [logoUrl, setLogoUrl] = useState(client.logoUrl ?? "");
  const [brandColor, setBrandColor] = useState(client.brandColor ?? "#7c5cff");
  const [tier, setTier] = useState(client.tier ?? "completa");
  const [showContacts, setShowContacts] = useState(client.showContacts);
  const [uploading, setUploading] = useState(false);

  async function uploadLogo(file: File) {
    setUploading(true);
    setError("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", "logo");
    fd.append("clientId", client.id);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json().catch(() => null);
    setUploading(false);
    if (!res.ok) {
      setError(typeof data?.error === "string" ? data.error : "Falha no upload da logo.");
      return;
    }
    setLogoUrl(data.url);
  }

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/clients/${client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, email, plan, toneOfVoice: tone, driveFolderId,
        logoUrl, brandColor, tier, showContacts,
      }),
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
    setLogoUrl(client.logoUrl ?? "");
    setBrandColor(client.brandColor ?? "#7c5cff");
    setTier(client.tier ?? "completa");
    setShowContacts(client.showContacts);
    setError("");
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="card p-6">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-4">
            {client.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={client.logoUrl}
                alt={client.name}
                className="w-14 h-14 rounded-2xl object-contain bg-white/5 border border-[var(--color-border)] shrink-0"
              />
            ) : (
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-semibold text-white shrink-0"
                style={{ background: `linear-gradient(135deg,${client.brandColor ?? "#7c5cff"},#ec4899)` }}
              >
                {client.name[0]?.toUpperCase()}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold">{client.name}</h2>
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)] capitalize">
                  {client.tier === "basica" ? "gestão básica" : "completa"}
                </span>
                {client.brandColor && (
                  <span
                    className="w-4 h-4 rounded-full border border-white/20"
                    style={{ background: client.brandColor }}
                    title={client.brandColor}
                  />
                )}
              </div>
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

      <div className="pt-3 border-t border-[var(--color-border)] space-y-4">
        <p className="text-sm font-medium">Marca (geração de arte)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Tipo de gestão</label>
            <select value={tier} onChange={(e) => setTier(e.target.value)} className="input">
              <option value="completa">Completa</option>
              <option value="basica">Básica (arte gerada por IA)</option>
            </select>
          </div>
          <div>
            <label className="label">Cor da marca</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="h-10 w-12 rounded-lg bg-transparent border border-[var(--color-border)] cursor-pointer"
              />
              <input
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="input font-mono"
                placeholder="#7c5cff"
              />
            </div>
          </div>
        </div>
        <div>
          <label className="label">Exibir dados de contato na arte?</label>
          <select
            value={showContacts ? "sim" : "nao"}
            onChange={(e) => setShowContacts(e.target.value === "sim")}
            className="input"
          >
            <option value="nao">Não — arte sem bloco de contato</option>
            <option value="sim">Sim — usa telefone, WhatsApp, site e Instagram do briefing</option>
          </select>
          {showContacts && (
            <p className="text-xs text-[var(--color-text-faint)] mt-1">
              Preencha os contatos na seção &quot;Dados do cliente&quot; abaixo (telefone, WhatsApp, site, Instagram, cidade).
            </p>
          )}
        </div>
        <div>
          <label className="label">Logo</label>
          <div className="flex items-center gap-4">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt="logo"
                className="w-16 h-16 rounded-xl object-contain bg-white/5 border border-[var(--color-border)]"
              />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-white/5 border border-dashed border-[var(--color-border)] flex items-center justify-center text-xs text-[var(--color-text-faint)]">
                sem logo
              </div>
            )}
            <label className="btn-ghost !py-2 cursor-pointer">
              {uploading ? "Enviando..." : logoUrl ? "Trocar logo" : "Enviar logo"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
                disabled={uploading}
              />
            </label>
            {logoUrl && (
              <button
                type="button"
                onClick={() => setLogoUrl("")}
                className="text-xs text-[var(--color-text-muted)] hover:text-red-400"
              >
                Remover
              </button>
            )}
          </div>
        </div>
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
