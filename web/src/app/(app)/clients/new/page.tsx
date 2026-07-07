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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const data = Object.fromEntries(new FormData(e.currentTarget));
    // não enviar campos opcionais vazios (evita gravar string em branco)
    for (const k of ["toneOfVoice", "driveFolderId"]) {
      if (typeof data[k] === "string" && !data[k].trim()) delete data[k];
    }

    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    setLoading(false);

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
          <select name="tier" className="input">
            <option value="completa">Completa (artes próprias)</option>
            <option value="basica">Básica — artes geradas por IA do calendário padrão</option>
          </select>
          <p className="text-xs text-[var(--color-text-faint)] mt-1">
            No plano básico, após criar o cliente configure logo, cor e contatos; as artes do
            calendário são geradas automaticamente na página do cliente.
          </p>
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
