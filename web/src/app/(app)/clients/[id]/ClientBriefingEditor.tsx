"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";

export type Briefing = {
  products?: string;
  themes?: string;
  hashtags?: string;
  partnerships?: string;
  observations?: string;
  restrictions?: string;
  mandatoryArtText?: string;
  designNotes?: string;
  plan?: string;
  responsibleTech?: string;
};

export type BriefingClient = {
  id: string;
  tradeName: string | null;
  website: string | null;
  city: string | null;
  phone: string | null;
  whatsapp: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  briefing: Briefing | null;
};

const FIELDS: { key: keyof Briefing; label: string; area?: boolean }[] = [
  { key: "products", label: "Produtos / serviços", area: true },
  { key: "themes", label: "Principais temas a abordar", area: true },
  { key: "hashtags", label: "Hashtags", area: true },
  { key: "partnerships", label: "Parcerias / convênios", area: true },
  { key: "restrictions", label: "Restrições (datas, religião, etc.)" },
  { key: "mandatoryArtText", label: "Texto obrigatório nas artes", area: true },
  { key: "responsibleTech", label: "Responsável técnico / registro" },
  { key: "designNotes", label: "Notas de design", area: true },
  { key: "plan", label: "Plano (nível / frequência)" },
  { key: "observations", label: "Observações", area: true },
];

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-[var(--color-text-faint)] uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm text-[var(--color-text-muted)] whitespace-pre-wrap">{value}</p>
    </div>
  );
}

export default function ClientBriefingEditor({ client }: { client: BriefingClient }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [tradeName, setTradeName] = useState(client.tradeName ?? "");
  const [website, setWebsite] = useState(client.website ?? "");
  const [city, setCity] = useState(client.city ?? "");
  const [phone, setPhone] = useState(client.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(client.whatsapp ?? "");
  const [facebookUrl, setFacebookUrl] = useState(client.facebookUrl ?? "");
  const [instagramUrl, setInstagramUrl] = useState(client.instagramUrl ?? "");
  const [b, setB] = useState<Briefing>(client.briefing ?? {});

  const briefing = client.briefing ?? {};
  const hasAny =
    client.tradeName || client.website || client.city || client.phone || client.whatsapp ||
    client.facebookUrl || client.instagramUrl || Object.values(briefing).some(Boolean);

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/clients/${client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tradeName, website, city, phone, whatsapp, facebookUrl, instagramUrl,
        briefing: b,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Não foi possível salvar.");
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Briefing do cliente</h2>
          <button onClick={() => setEditing(true)} className="btn-ghost !py-2 !px-3 text-xs">
            <Icon.edit className="w-3.5 h-3.5" />
            {hasAny ? "Editar" : "Preencher"}
          </button>
        </div>
        {!hasAny ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            Briefing vazio. Preencha os dados do cliente (substitui o documento).
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Row label="Nome fantasia" value={client.tradeName} />
            <Row label="Site" value={client.website} />
            <Row label="Cidade / UF" value={client.city} />
            <Row label="Telefone fixo" value={client.phone} />
            <Row label="WhatsApp" value={client.whatsapp} />
            <Row label="Facebook" value={client.facebookUrl} />
            <Row label="Instagram" value={client.instagramUrl} />
            {FIELDS.map((f) => (
              <Row key={f.key} label={f.label} value={briefing[f.key]} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card p-6 space-y-4">
      <h2 className="font-semibold">Editar briefing</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Nome fantasia</label>
          <input value={tradeName} onChange={(e) => setTradeName(e.target.value)} className="input" />
        </div>
        <div>
          <label className="label">Site</label>
          <input value={website} onChange={(e) => setWebsite(e.target.value)} className="input" />
        </div>
        <div>
          <label className="label">Cidade / UF</label>
          <input value={city} onChange={(e) => setCity(e.target.value)} className="input" />
        </div>
        <div>
          <label className="label">Telefone fixo</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className="input" />
        </div>
        <div>
          <label className="label">WhatsApp</label>
          <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className="input" />
        </div>
        <div>
          <label className="label">Facebook (URL)</label>
          <input value={facebookUrl} onChange={(e) => setFacebookUrl(e.target.value)} className="input" />
        </div>
        <div>
          <label className="label">Instagram (URL)</label>
          <input value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} className="input" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 pt-2 border-t border-[var(--color-border)]">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="label">{f.label}</label>
            {f.area ? (
              <textarea
                value={b[f.key] ?? ""}
                onChange={(e) => setB({ ...b, [f.key]: e.target.value })}
                rows={2}
                className="input resize-none"
              />
            ) : (
              <input
                value={b[f.key] ?? ""}
                onChange={(e) => setB({ ...b, [f.key]: e.target.value })}
                className="input"
              />
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-3 pt-1">
        <button onClick={() => setEditing(false)} className="btn-ghost flex-1">Cancelar</button>
        <button onClick={save} disabled={saving} className="btn-primary flex-1">
          {saving ? "Salvando..." : "Salvar briefing"}
        </button>
      </div>
    </div>
  );
}
