"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Icon } from "@/components/Icons";
import { BrandBadge } from "@/components/BrandIcons";
import { DatePicker } from "@/components/DatePickers";

const PLATFORMS = [
  { id: "instagram", label: "Instagram", hint: "User ID da conta Business/Creator (ex: 17841400000000000)" },
  { id: "facebook", label: "Facebook", hint: "Page ID da página do Facebook (ex: 123456789)" },
  { id: "linkedin", label: "LinkedIn", hint: "URN da organização (ex: urn:li:organization:12345)" },
];

export default function NewAccountPage() {
  const router = useRouter();
  const { id: clientId } = useParams<{ id: string }>();
  const [platform, setPlatform] = useState("instagram");
  const [tokenExpiresAt, setTokenExpiresAt] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const hint = PLATFORMS.find((p) => p.id === platform)?.hint ?? "";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const data = {
      clientId,
      platform,
      externalId: form.get("externalId") as string,
      accessToken: form.get("accessToken") as string,
      dailyPostLimit: Number(form.get("dailyPostLimit") ?? 25),
      tokenExpiresAt: form.get("tokenExpiresAt")
        ? new Date(form.get("tokenExpiresAt") as string).toISOString()
        : undefined,
    };

    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    setLoading(false);

    if (!res.ok) {
      setError("Não foi possível adicionar a conta. Verifique os dados.");
      return;
    }

    router.push(`/clients/${clientId}`);
    router.refresh();
  }

  return (
    <div className="p-8 max-w-2xl mx-auto animate-fade-up">
      <PageHeader title="Adicionar conta social" back={`/clients/${clientId}`} />

      <div className="flex items-start gap-3 rounded-xl px-4 py-3 mb-6 bg-amber-500/[0.07] border border-amber-500/20">
        <Icon.alert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-200/90">
          O token é criptografado (AES-256-GCM) antes de ser armazenado e nunca é exibido novamente após salvar.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        <div>
          <label className="label">Plataforma</label>
          <div className="grid grid-cols-3 gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPlatform(p.id)}
                className={`flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-all ${
                  platform === p.id
                    ? "text-white border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                    : "text-[var(--color-text-muted)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
                }`}
              >
                <BrandBadge platform={p.id} size={22} />
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">ID externo</label>
          <input name="externalId" required className="input font-mono" placeholder={hint} />
          <p className="text-xs text-[var(--color-text-faint)] mt-1.5">{hint}</p>
        </div>

        <div>
          <label className="label">Access Token</label>
          <textarea
            name="accessToken"
            required
            rows={3}
            className="input resize-none font-mono text-xs"
            placeholder="EAABx..."
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Limite diário de posts</label>
            <input
              name="dailyPostLimit"
              type="number"
              defaultValue={25}
              min={1}
              max={200}
              className="input"
            />
          </div>
          <div>
            <label className="label">
              Expira em <span className="text-[var(--color-text-faint)] font-normal">(opcional)</span>
            </label>
            <DatePicker
              name="tokenExpiresAt"
              value={tokenExpiresAt}
              onChange={setTokenExpiresAt}
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <Link href={`/clients/${clientId}`} className="btn-ghost flex-1">
            Cancelar
          </Link>
          <button type="submit" disabled={loading} className="btn-primary flex-1">
            {loading ? "Salvando..." : "Salvar conta"}
          </button>
        </div>
      </form>
    </div>
  );
}
