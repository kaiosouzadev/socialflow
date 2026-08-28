"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui";
import DriveFolderPicker from "@/components/DriveFolderPicker";
import Link from "next/link";

export default function NewClientPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tier, setTier] = useState("completa");
  const [brandColor, setBrandColor] = useState("#7c5cff");
  const [showContacts, setShowContacts] = useState(false);

  const isBasica = tier === "basica";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const data: Record<string, unknown> = Object.fromEntries(new FormData(e.currentTarget));
    // não enviar campos opcionais vazios (evita gravar string em branco)
    for (const k of ["toneOfVoice", "driveFolderId", "whatsapp", "phone", "website", "instagramUrl", "city"]) {
      if (typeof data[k] === "string" && !(data[k] as string).trim()) delete data[k];
    }
    if (isBasica) {
      data.brandColor = brandColor;
      data.showContacts = showContacts;
    } else {
      // gestão completa não usa os campos de marca/contatos da arte por IA
      for (const k of ["brandColor", "showContacts", "whatsapp", "phone", "website", "instagramUrl", "city"]) {
        delete data[k];
      }
    }

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(
          typeof body?.error === "string"
            ? body.error
            : "Não foi possível criar o cliente. Verifique os dados."
        );
        return;
      }

      const client = await res.json();
      router.push(`/clients/${client.id}`);
      router.refresh();
    } catch {
      setError("Falha de conexão ao criar o cliente. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto animate-fade-up">
      <PageHeader title="Novo cliente" back="/clients" />

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        <div>
          <label className="label">Nome</label>
          <input name="name" required className="input" placeholder="Nome do cliente ou empresa" />
        </div>

        <div>
          <label className="label">Email</label>
          <input
            name="email"
            type="email"
            required
            className="input"
            placeholder="contato@cliente.com.br"
          />
        </div>

        <div>
          <label className="label">Plano</label>
          <select name="plan" className="input">
            <option value="sem_aprovacao">Auto-publicação (sem aprovação)</option>
            <option value="aprovacao_cliente">Com aprovação do cliente</option>
          </select>
        </div>

        <div>
          <label className="label">Tipo de gestão</label>
          <select
            name="tier"
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="input"
          >
            <option value="completa">Completa (artes próprias)</option>
            <option value="basica">Básica — artes geradas por IA do calendário padrão</option>
          </select>
        </div>

        <div>
          <label className="label">
            Tom de voz <span className="text-[var(--color-text-faint)] font-normal">(opcional)</span>
          </label>
          <textarea
            name="toneOfVoice"
            rows={3}
            className="input resize-none"
            placeholder="Ex: Tom profissional e próximo, foco em seguros..."
          />
        </div>

        <div>
          <label className="label">
            Pasta no Drive{" "}
            <span className="text-[var(--color-text-faint)] font-normal">
              (opcional — selecione a pasta; vazio = busca pelo nome do cliente)
            </span>
          </label>
          <DriveFolderPicker name="driveFolderId" />
        </div>

        {/* campos exclusivos da gestão básica (marca + contatos da arte por IA) */}
        {isBasica && (
          <div className="pt-4 border-t border-[var(--color-border)] space-y-4 animate-fade-up">
            <div>
              <p className="text-sm font-medium">Marca (geração de arte por IA)</p>
              <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
                A logo é enviada depois, na página do cliente (precisa do cadastro criado).
              </p>
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

            <div>
              <label className="label">Exibir dados de contato na arte?</label>
              <select
                value={showContacts ? "sim" : "nao"}
                onChange={(e) => setShowContacts(e.target.value === "sim")}
                className="input"
              >
                <option value="nao">Não — arte sem bloco de contato</option>
                <option value="sim">Sim — usa os contatos abaixo</option>
              </select>
            </div>

            {showContacts && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-fade-up">
                <div>
                  <label className="label">WhatsApp</label>
                  <input name="whatsapp" className="input" placeholder="(11) 99999-9999" />
                </div>
                <div>
                  <label className="label">Telefone</label>
                  <input name="phone" className="input" placeholder="(11) 3333-3333" />
                </div>
                <div>
                  <label className="label">Site</label>
                  <input name="website" className="input" placeholder="www.cliente.com.br" />
                </div>
                <div>
                  <label className="label">Instagram</label>
                  <input name="instagramUrl" className="input" placeholder="instagram.com/cliente" />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Cidade - UF</label>
                  <input name="city" className="input" placeholder="São Paulo - SP" />
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <Link href="/clients" className="btn-ghost flex-1">
            Cancelar
          </Link>
          <button type="submit" disabled={loading} className="btn-primary flex-1">
            {loading ? "Criando..." : "Criar cliente"}
          </button>
        </div>
      </form>
    </div>
  );
}
