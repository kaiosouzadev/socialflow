"use client";

import { useState } from "react";
import { Icon } from "@/components/Icons";
import { BrandBadge, BRAND } from "@/components/BrandIcons";
import { DateTimePicker } from "@/components/DatePickers";
import { spLocalInputFromISO, spLocalInputToISO } from "@/lib/format-date";

export type PreviewPost = {
  theme: string;
  format: string;
  captions: Record<string, string>;
  scheduledAt: string; // ISO
  targets: string[];
  mediaUrl: string;
};

type ReviewPost = {
  uid: string;
  theme: string;
  format: string;
  captions: Record<string, string>;
  scheduledLocal: string; // "YYYY-MM-DDTHH:MM"
  targets: string[];
  mediaUrl: string;
};

let uidSeq = 0;

export default function CalendarReviewModal({
  clientId,
  clientName,
  month,
  availablePlatforms,
  initialPosts,
  onClose,
  onCommitted,
}: {
  clientId: string;
  clientName: string;
  month: string; // YYYY-MM
  availablePlatforms: string[];
  initialPosts: PreviewPost[];
  onClose: () => void;
  onCommitted: () => void;
}) {
  const [posts, setPosts] = useState<ReviewPost[]>(() =>
    initialPosts.map((p) => ({
      uid: `r${uidSeq++}`,
      theme: p.theme,
      format: p.format,
      captions: p.captions ?? {},
      scheduledLocal: spLocalInputFromISO(p.scheduledAt),
      targets: p.targets,
      mediaUrl: p.mediaUrl ?? "",
    }))
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const platforms = availablePlatforms.length ? availablePlatforms : ["instagram", "facebook"];
  const withArt = posts.filter((p) => p.mediaUrl.trim()).length;

  const monthLabel = (() => {
    const [y, m] = month.split("-").map(Number);
    return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
      new Date(y, m - 1, 15)
    );
  })();

  function update(uid: string, patch: Partial<ReviewPost>) {
    setPosts((prev) => prev.map((p) => (p.uid === uid ? { ...p, ...patch } : p)));
  }
  function updateCaption(uid: string, platform: string, text: string) {
    setPosts((prev) =>
      prev.map((p) =>
        p.uid === uid ? { ...p, captions: { ...p.captions, [platform]: text } } : p
      )
    );
  }
  function toggleTarget(uid: string, platform: string) {
    setPosts((prev) =>
      prev.map((p) => {
        if (p.uid !== uid) return p;
        const has = p.targets.includes(platform);
        return {
          ...p,
          targets: has ? p.targets.filter((t) => t !== platform) : [...p.targets, platform],
        };
      })
    );
  }
  async function substitute(uid: string) {
    const post = posts.find((p) => p.uid === uid);
    if (!post || post.targets.length === 0) {
      setError("Selecione ao menos uma rede antes de substituir.");
      return;
    }
    setRegenerating((r) => ({ ...r, [uid]: true }));
    setError("");
    const avoid = posts.filter((p) => p.uid !== uid).map((p) => p.theme).filter(Boolean);
    const res = await fetch("/api/ai/calendar/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, targets: post.targets, avoid }),
    });
    const data = await res.json().catch(() => null);
    setRegenerating((r) => ({ ...r, [uid]: false }));
    if (!res.ok) {
      setError(typeof data?.error === "string" ? data.error : "Falha ao gerar novo post.");
      return;
    }
    // novo post: troca tema/legendas, mantém data e redes, zera a arte
    update(uid, {
      theme: data.theme ?? post.theme,
      format: data.format ?? post.format,
      captions: data.captions ?? {},
      mediaUrl: "",
    });
  }

  async function approve() {
    if (posts.length === 0) {
      setError("Adicione ou mantenha ao menos um post.");
      return;
    }
    if (posts.some((p) => p.targets.length === 0)) {
      setError("Cada post precisa de ao menos uma rede social.");
      return;
    }
    setBusy(true);
    setError("");
    const payload = {
      clientId,
      month,
      posts: posts.map((p) => {
        const captions: Record<string, string> = {};
        for (const t of p.targets) {
          const c = p.captions[t];
          if (c && c.trim()) captions[t] = c.trim();
        }
        return {
          theme: p.theme,
          captions,
          mediaUrl: p.mediaUrl.trim(),
          scheduledAt: spLocalInputToISO(p.scheduledLocal),
          targets: p.targets,
        };
      }),
    };
    const res = await fetch("/api/ai/calendar/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(typeof data?.error === "string" ? data.error : "Falha ao salvar os rascunhos.");
      return;
    }
    onCommitted();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={busy ? undefined : onClose} />

      <div
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-[var(--color-border-strong)] shadow-2xl"
        style={{ backgroundColor: "var(--color-surface)" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-5 border-b border-[var(--color-border)]">
          <div>
            <h2 className="text-lg font-semibold">Revisar calendário</h2>
            <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
              {clientName} · <span className="capitalize">{monthLabel}</span> · {posts.length} post
              {posts.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                withArt === posts.length && posts.length > 0
                  ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
                  : "text-amber-300 bg-amber-500/10 border-amber-500/25"
              }`}
            >
              {withArt}/{posts.length} com arte
            </span>
            <button
              onClick={onClose}
              disabled={busy}
              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-white hover:bg-white/5 transition disabled:opacity-50"
            >
              <Icon.x className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Intro */}
        <div className="px-5 pt-4">
          <p className="text-xs text-[var(--color-text-muted)] bg-white/[0.03] border border-[var(--color-border)] rounded-lg px-3 py-2">
            Ajuste tema, data, redes, legendas e a arte de cada post. Ao aprovar, tudo é salvo como
            <strong> rascunho</strong> — depois é só adicionar a arte que falta e agendar.
          </p>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {posts.length === 0 && (
            <p className="text-center text-sm text-[var(--color-text-muted)] py-10">
              Nenhum post. Cancele e gere novamente.
            </p>
          )}
          {posts.map((p, i) => {
            const hasArt = !!p.mediaUrl.trim();
            const open = expanded[p.uid];
            return (
              <div key={p.uid} className="rounded-xl border border-[var(--color-border)] bg-white/[0.02] p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-2.5 text-xs font-mono text-[var(--color-text-faint)] w-5 shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex-1 min-w-0 space-y-3">
                    <input
                      value={p.theme}
                      onChange={(e) => update(p.uid, { theme: e.target.value })}
                      placeholder="Tema do post"
                      className="input font-medium"
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="label">Agendar para</label>
                        <DateTimePicker
                          defaultValue={p.scheduledLocal}
                          onChange={(v) => update(p.uid, { scheduledLocal: v })}
                        />
                      </div>
                      <div>
                        <label className="label flex items-center gap-2">
                          Arte (URL da mídia)
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
                              hasArt
                                ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
                                : "text-amber-300 bg-amber-500/10 border-amber-500/25"
                            }`}
                          >
                            {hasArt ? "Com arte" : "Sem arte"}
                          </span>
                        </label>
                        <input
                          value={p.mediaUrl}
                          onChange={(e) => update(p.uid, { mediaUrl: e.target.value })}
                          placeholder="https://… (opcional agora)"
                          className="input font-mono text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {platforms.map((pl) => {
                        const on = p.targets.includes(pl);
                        return (
                          <button
                            key={pl}
                            type="button"
                            onClick={() => toggleTarget(p.uid, pl)}
                            className={`flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-lg border text-xs font-medium transition ${
                              on
                                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-white"
                                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)]"
                            }`}
                          >
                            <BrandBadge platform={pl} size={18} />
                            {BRAND[pl]?.label ?? pl}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setExpanded((e) => ({ ...e, [p.uid]: !open }))}
                        className="ml-auto text-xs text-[var(--color-text-muted)] hover:text-white transition"
                      >
                        {open ? "Ocultar legendas" : "Editar legendas"}
                      </button>
                    </div>

                    {open && (
                      <div className="space-y-3 pt-1">
                        {p.targets.length === 0 && (
                          <p className="text-xs text-amber-300">Selecione uma rede para editar a legenda.</p>
                        )}
                        {p.targets.map((t) => (
                          <div key={t}>
                            <label className="label flex items-center gap-1.5">
                              <BrandBadge platform={t} size={16} />
                              {BRAND[t]?.label ?? t}
                            </label>
                            <textarea
                              value={p.captions[t] ?? ""}
                              onChange={(e) => updateCaption(p.uid, t, e.target.value)}
                              rows={3}
                              className="input resize-none text-sm"
                              placeholder={`Legenda para ${BRAND[t]?.label ?? t}`}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => substitute(p.uid)}
                    disabled={regenerating[p.uid] || busy}
                    title="Substituir por um novo post gerado pela IA"
                    className="mt-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--color-text-muted)] border border-[var(--color-border)] hover:text-white hover:border-[var(--color-border-strong)] transition shrink-0 disabled:opacity-50"
                  >
                    <Icon.refresh className={`w-4 h-4 ${regenerating[p.uid] ? "animate-spin" : ""}`} />
                    {regenerating[p.uid] ? "Gerando..." : "Substituir"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-[var(--color-border)]">
          {error && (
            <p className="mb-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button onClick={onClose} disabled={busy} className="btn-ghost flex-1">
              Cancelar
            </button>
            <button onClick={approve} disabled={busy || posts.length === 0} className="btn-primary flex-1">
              <Icon.check className="w-4 h-4" />
              {busy ? "Salvando..." : `Aprovar e salvar (${posts.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
