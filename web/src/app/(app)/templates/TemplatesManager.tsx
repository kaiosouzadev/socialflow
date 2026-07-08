"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";

type Template = {
  id: string;
  name: string;
  month: string | null;
  day: number | null;
  time: string | null;
  baseImageUrl: string;
  active: boolean;
};

const MONTH_LABEL = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  const nome = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", month: "long" })
    .format(new Date(Date.UTC(y, mm - 1, 15)));
  return `${nome} de ${y}`;
};

export default function TemplatesManager({ initial }: { initial: Template[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("18:00");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // gerar mês inteiro com IA (títulos + legendas padronizadas + arte-base do mês)
  const [genMonth, setGenMonth] = useState("");
  const [genCount, setGenCount] = useState("12");
  const [genFile, setGenFile] = useState<File | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function generateMonth() {
    if (!/^\d{4}-\d{2}$/.test(genMonth)) {
      setGenMsg({ ok: false, text: "Mês no formato YYYY-MM (ex: 2026-08)." });
      return;
    }
    if (!genFile) {
      setGenMsg({ ok: false, text: "Selecione a arte-base do mês." });
      return;
    }
    setGenBusy(true);
    setGenMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", genFile);
      fd.append("kind", "template");
      const up = await fetch("/api/upload", { method: "POST", body: fd });
      const upData = await up.json();
      if (!up.ok) throw new Error(upData?.error ?? "upload falhou");

      const res = await fetch("/api/art-templates/generate-month", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: genMonth,
          baseImageUrl: upData.url,
          count: Math.max(1, Math.min(31, Number(genCount) || 12)),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Falha na geração");

      setGenMsg({ ok: true, text: `${data.created} artes criadas para ${genMonth} (títulos + legendas padronizadas).` });
      setGenFile(null);
      router.refresh();
    } catch (e) {
      setGenMsg({ ok: false, text: e instanceof Error ? e.message : "Erro" });
    } finally {
      setGenBusy(false);
    }
  }

  async function create() {
    if (!name.trim() || !file) {
      setError("Título e imagem-base são obrigatórios.");
      return;
    }
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      setError("Mês no formato YYYY-MM (ex: 2026-08).");
      return;
    }
    const dayNum = day ? Number(day) : null;
    if (dayNum !== null && (dayNum < 1 || dayNum > 31)) {
      setError("Dia entre 1 e 31.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "template");
      const up = await fetch("/api/upload", { method: "POST", body: fd });
      const upData = await up.json();
      if (!up.ok) throw new Error(upData?.error ?? "upload falhou");

      const res = await fetch("/api/art-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          month: month || undefined,
          day: dayNum,
          time: time || undefined,
          baseImageUrl: upData.url,
        }),
      });
      if (!res.ok) throw new Error("Falha ao criar arte-base");

      setName("");
      setDay("");
      setFile(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(t: Template) {
    await fetch(`/api/art-templates/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !t.active }),
    });
    router.refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/art-templates/${id}`, { method: "DELETE" });
    router.refresh();
  }

  // agrupa por mês (itens sem mês = "avulsas")
  const groups = new Map<string, Template[]>();
  for (const t of initial) {
    const key = t.month ?? "";
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }
  const orderedKeys = [...groups.keys()].sort((a, b) => {
    if (!a) return 1;
    if (!b) return -1;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-6">
      {/* gerar mês inteiro com IA */}
      <div className="card p-6 border-[var(--color-accent)]/30">
        <h2 className="font-semibold mb-1 flex items-center gap-2">
          <Icon.zap className="w-4 h-4 text-[var(--color-accent)]" />
          Gerar mês com IA
        </h2>
        <p className="text-xs text-[var(--color-text-faint)] mb-4">
          Igual ao calendário dos clientes completos: a IA cria os títulos do mês e as legendas
          padronizadas, todos usando a arte-base do mês. Datas seg/qua/sex, nunca no passado.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="label">Mês (YYYY-MM)</label>
            <input value={genMonth} onChange={(e) => setGenMonth(e.target.value)} placeholder="2026-08" className="input" />
          </div>
          <div>
            <label className="label">Qtd. de posts</label>
            <input
              value={genCount}
              onChange={(e) => setGenCount(e.target.value.replace(/\D/g, "").slice(0, 2))}
              inputMode="numeric"
              className="input"
            />
          </div>
          <div className="flex items-end gap-3">
            <label className="btn-ghost !py-2 cursor-pointer whitespace-nowrap">
              {genFile ? "Trocar arte-base" : "Arte-base do mês"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => setGenFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <button onClick={generateMonth} disabled={genBusy} className="btn-primary !py-2 ml-auto">
              {genBusy ? "Gerando..." : "Gerar"}
            </button>
          </div>
        </div>
        {genFile && <p className="text-xs text-[var(--color-text-muted)] mt-2 truncate">{genFile.name}</p>}
        {genMsg && (
          <p className={`mt-3 text-sm ${genMsg.ok ? "text-emerald-300" : "text-red-400"}`}>{genMsg.text}</p>
        )}
      </div>

      {/* nova arte-base */}
      <div className="card p-6">
        <h2 className="font-semibold mb-1">Nova arte do calendário básico</h2>
        <p className="text-xs text-[var(--color-text-faint)] mb-4">
          Mesmo título e layout para todos os clientes básicos; a IA personaliza logo, cores e contatos.
          Com mês + dia preenchidos, a arte entra no calendário automático.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="lg:col-span-2">
            <label className="label">Título da postagem</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Dia dos Pais — homenagem"
              className="input"
            />
          </div>
          <div>
            <label className="label">Mês (YYYY-MM)</label>
            <input
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              placeholder="2026-08"
              className="input"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Dia</label>
              <input
                value={day}
                onChange={(e) => setDay(e.target.value.replace(/\D/g, "").slice(0, 2))}
                placeholder="10"
                inputMode="numeric"
                className="input"
              />
            </div>
            <div>
              <label className="label">Hora</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="input"
              />
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <label className="btn-ghost !py-2 cursor-pointer">
            {file ? "Trocar imagem" : "Selecionar imagem-base"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {file && <span className="text-sm text-[var(--color-text-muted)] truncate">{file.name}</span>}
          <button onClick={create} disabled={busy} className="btn-primary !py-2 ml-auto">
            {busy ? "Salvando..." : "Adicionar"}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>

      {/* banco de artes por mês */}
      {initial.length === 0 ? (
        <div className="card p-10 text-center text-sm text-[var(--color-text-muted)]">
          Nenhuma arte-base cadastrada.
        </div>
      ) : (
        orderedKeys.map((key) => (
          <div key={key || "avulsas"}>
            <h3 className="text-sm font-semibold capitalize mb-3 text-[var(--color-text-muted)]">
              {key ? MONTH_LABEL(key) : "Avulsas (sem mês)"}
              <span className="font-normal text-[var(--color-text-faint)]">
                {" "}· {groups.get(key)!.length} artes
              </span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {groups
                .get(key)!
                .sort((a, b) => (a.day ?? 99) - (b.day ?? 99))
                .map((t) => (
                  <div key={t.id} className="card overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.baseImageUrl} alt={t.name} className="w-full aspect-square object-cover bg-white/5" />
                    <div className="p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium truncate">{t.name}</p>
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full border shrink-0 ${
                            t.active
                              ? "border-emerald-500/30 text-emerald-300 bg-emerald-500/10"
                              : "border-[var(--color-border)] text-[var(--color-text-faint)]"
                          }`}
                        >
                          {t.active ? "ativa" : "inativa"}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
                        {t.day
                          ? `dia ${String(t.day).padStart(2, "0")} às ${t.time ?? "18:00"}`
                          : "sem data (não entra no calendário)"}
                      </p>
                      <div className="flex items-center gap-3 mt-3">
                        <button onClick={() => toggle(t)} className="text-sm text-[var(--color-accent)] hover:underline">
                          {t.active ? "Desativar" : "Ativar"}
                        </button>
                        <button
                          onClick={() => remove(t.id)}
                          className="text-sm text-[var(--color-text-muted)] hover:text-red-400 ml-auto flex items-center gap-1"
                        >
                          <Icon.trash className="w-3.5 h-3.5" /> Excluir
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
