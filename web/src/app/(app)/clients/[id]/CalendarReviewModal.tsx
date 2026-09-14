"use client";

import { useState } from "react";
import { Icon } from "@/components/Icons";
import { BrandBadge, BRAND } from "@/components/BrandIcons";
import { DateTimePicker } from "@/components/DatePickers";
import { AssistantPanel } from "@/components/AssistantPanel";
import { MediaField } from "@/components/MediaField";
import { SlidesEditor } from "@/components/SlidesEditor";
import { spLocalInputFromISO, spLocalInputToISO } from "@/lib/format-date";

export type PreviewPost = {
  theme: string;
  format: string;
  explanation?: string;
  captions: Record<string, string>;
  scheduledAt: string; // ISO
  targets: string[];
  mediaUrl: string;
};

type ReviewPost = {
  uid: string;
  theme: string;
  format: string;
  // breve explicação do tema — é o que o cliente aprova na fase cronograma
  explanation: string;
  captions: Record<string, string>;
  slides: string[];
  scheduledLocal: string; // "YYYY-MM-DDTHH:MM"
  targets: string[];
  mediaUrl: string;
  // story sai junto do post (15 min depois, arte própria "Nstory.*")
  withStory: boolean;
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
    initialPosts.map((p) => {
      // legado "feed_story" vira feed + story junto; todo post não-story
      // nasce com story junto (regra da redação)
      const isLegacyFeedStory = p.format === "feed_story";
      const format = isLegacyFeedStory ? "feed" : p.format;
      return {
        uid: `r${uidSeq++}`,
        theme: p.theme,
        format,
        explanation: p.explanation ?? "",
        captions: p.captions ?? {},
        slides: [],
        scheduledLocal: spLocalInputFromISO(p.scheduledAt),
        targets: p.targets,
        mediaUrl: p.mediaUrl ?? "",
        withStory: format !== "story",
      };
    })
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [regenerating, setRegenerating] = useState<Record<string, boolean>>({});
  // LinkedIn editado manualmente (deixa de espelhar a legenda FB+IG)
  const [liDirty, setLiDirty] = useState<Record<string, boolean>>({});
  const [assistantUid, setAssistantUid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // um clique fora não pode descartar 12 posts gerados sem confirmar
  function confirmClose() {
    if (busy) return;
    if (posts.length === 0 || window.confirm("Descartar este cronograma e todas as edições?")) {
      onClose();
    }
  }

  const FORMATS = [
    { value: "feed", label: "Feed" },
    { value: "story", label: "Story" },
    { value: "carrossel", label: "Carrossel" },
    { value: "reels", label: "Reels" },
  ];

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
  // legenda única FB+IG (LinkedIn espelha até ser editado)
  function updateShared(uid: string, text: string) {
    setPosts((prev) =>
      prev.map((p) =>
        p.uid === uid
          ? {
              ...p,
              captions: {
                ...p.captions,
                instagram: text,
                facebook: text,
                ...(liDirty[uid] ? {} : { linkedin: text }),
              },
            }
          : p
      )
    );
  }
  function updateLinkedin(uid: string, text: string) {
    setLiDirty((d) => ({ ...d, [uid]: true }));
    setPosts((prev) =>
      prev.map((p) =>
        p.uid === uid ? { ...p, captions: { ...p.captions, linkedin: text } } : p
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
  /**
   * Regenera a postagem a partir do TÍTULO atual (mesmo fluxo da criação
   * individual): legendas, hashtags e conteúdo refeitos para o novo título.
   * Sem título, sorteia um tema novo (comportamento antigo).
   */
  async function substitute(uid: string) {
    const post = posts.find((p) => p.uid === uid);
    if (!post || post.targets.length === 0) {
      setError("Selecione ao menos uma rede antes de substituir.");
      return;
    }
    setRegenerating((r) => ({ ...r, [uid]: true }));
    setError("");

    try {
      if (post.theme.trim()) {
        // título definido pelo usuário → regenera legenda (e slides, se
        // carrossel/reels) a partir dele
        const res = await fetch("/api/ai/caption", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            theme: post.theme.trim(),
            targets: post.targets,
            format: post.format,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(typeof data?.error === "string" ? data.error : "Falha ao regenerar a postagem.");
          return;
        }
        const g: Record<string, string> = data.captions ?? {};
        const shared = g.instagram ?? g.facebook ?? "";
        setLiDirty((d) => ({ ...d, [uid]: !!g.linkedin && g.linkedin !== shared }));
        update(uid, {
          captions: { instagram: shared, facebook: shared, linkedin: g.linkedin ?? shared },
          ...(Array.isArray(data.slides) && data.slides.length ? { slides: data.slides } : {}),
        });
        return;
      }

      // sem título → sorteia tema novo (evitando os existentes)
      const avoid = posts.filter((p) => p.uid !== uid).map((p) => p.theme).filter(Boolean);
      const res = await fetch("/api/ai/calendar/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, targets: post.targets, avoid }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Falha ao gerar novo post.");
        return;
      }
      update(uid, {
        theme: data.theme ?? post.theme,
        format: data.format ?? post.format,
        explanation: data.explanation ?? "",
        captions: {},
        slides: [],
        mediaUrl: "",
      });
    } catch {
      setError("Falha de conexão com a IA. Tente novamente.");
    } finally {
      setRegenerating((r) => ({ ...r, [uid]: false }));
    }
  }

  function removePost(uid: string) {
    setPosts((prev) => prev.filter((p) => p.uid !== uid));
    if (assistantUid === uid) setAssistantUid(null);
  }

  /** nova postagem em branco: 2 dias após a última, 18h (dentro do mês) */
  function addPost() {
    const last = posts[posts.length - 1];
    let scheduledLocal: string;
    if (last?.scheduledLocal) {
      const d = new Date(`${last.scheduledLocal}:00`);
      d.setDate(d.getDate() + 2);
      const pad2 = (n: number) => String(n).padStart(2, "0");
      scheduledLocal = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T18:00`;
    } else {
      scheduledLocal = `${month}-05T18:00`;
    }
    const fresh: ReviewPost = {
      uid: `r${uidSeq++}`,
      theme: "",
      format: "feed",
      explanation: "",
      captions: {},
      slides: [],
      scheduledLocal,
      targets: platforms,
      mediaUrl: "",
      withStory: true,
    };
    setPosts((prev) => [...prev, fresh]);
    setExpanded((e) => ({ ...e, [fresh.uid]: true }));
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
    try {
    const payload = {
      clientId,
      month,
      // "Story junto" vira um segundo post (story, 15 min depois) — cada um
      // com seu formato, casando com a convenção de mídia (N.* e Nstory.*)
      posts: posts.flatMap((p) => {
        const captions: Record<string, string> = {};
        for (const t of p.targets) {
          const c = p.captions[t];
          if (c && c.trim()) captions[t] = c.trim();
        }
        const baseIso = spLocalInputToISO(p.scheduledLocal);
        const base = {
          theme: p.theme,
          explanation: p.explanation.trim() || undefined,
          captions,
          mediaUrl: p.mediaUrl.trim(),
          targets: p.targets,
        };
        const slides = p.slides.filter((s) => s.trim()).map((text) => ({ text }));
        const out: Record<string, unknown>[] = [
          {
            ...base,
            format: p.format,
            scheduledAt: baseIso,
            ...(slides.length && (p.format === "carrossel" || p.format === "reels")
              ? { slides }
              : {}),
          },
        ];
        if (p.withStory && p.format !== "story") {
          const storyIso = new Date(new Date(baseIso).getTime() + 15 * 60_000).toISOString();
          out.push({ ...base, format: "story", mediaUrl: "", scheduledAt: storyIso });
        }
        return out;
      }),
    };
    const res = await fetch("/api/ai/calendar/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(typeof data?.error === "string" ? data.error : "Falha ao salvar os rascunhos.");
      return;
    }
    onCommitted();
    } catch {
      setError("Falha de conexão ao salvar. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={busy ? undefined : confirmClose} />

      <div
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-[var(--color-border-strong)] shadow-2xl"
        style={{ backgroundColor: "var(--color-surface)" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-5 border-b border-[var(--color-border)]">
          <div>
            <h2 className="text-lg font-semibold">Revisar cronograma</h2>
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
              onClick={confirmClose}
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
            O cliente aprova <strong>título + explicação</strong> de cada postagem. Ajuste o que
            precisar e salve — legendas e slides completos são gerados depois que o cronograma for
            aprovado.
          </p>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {posts.length === 0 && (
            <p className="text-center text-sm text-[var(--color-text-muted)] py-10">
              Nenhuma postagem. Adicione uma abaixo ou cancele e gere novamente.
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
                      placeholder="Título da postagem"
                      className="input font-medium"
                    />

                    <textarea
                      value={p.explanation}
                      onChange={(e) => update(p.uid, { explanation: e.target.value })}
                      rows={2}
                      className="input resize-y text-sm"
                      placeholder="Breve explicação do tema para o cliente (aparece no link de aprovação)…"
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="label">Agendar para</label>
                        <DateTimePicker
                          defaultValue={p.scheduledLocal}
                          onChange={(v) => update(p.uid, { scheduledLocal: v })}
                        />
                      </div>
                      <div>
                        <label className="label">Tipo de postagem</label>
                        <select
                          value={p.format}
                          onChange={(e) =>
                            update(p.uid, {
                              format: e.target.value,
                              ...(e.target.value === "story" ? { withStory: false } : {}),
                            })
                          }
                          className="input"
                        >
                          {FORMATS.map((f) => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                          ))}
                        </select>
                        {p.format !== "story" && (
                          <label className="flex items-center gap-1.5 mt-1.5 text-xs text-[var(--color-text-muted)] cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={p.withStory}
                              onChange={(e) => update(p.uid, { withStory: e.target.checked })}
                              className="accent-[var(--color-accent)]"
                            />
                            Story junto (15 min depois · arte {String(i + 1)}story)
                          </label>
                        )}
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
                        <MediaField
                          value={p.mediaUrl}
                          onChange={(url) => update(p.uid, { mediaUrl: url })}
                          clientId={clientId}
                          compact
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
                        {(p.format === "carrossel" || p.format === "reels") && (
                          <SlidesEditor
                            format={p.format}
                            slides={p.slides}
                            onChange={(slides) => update(p.uid, { slides })}
                          />
                        )}
                        {p.targets.length === 0 && (
                          <p className="text-xs text-amber-300">Selecione uma rede para editar a legenda.</p>
                        )}
                        {(p.targets.includes("instagram") || p.targets.includes("facebook")) && (
                          <div>
                            <label className="label flex items-center gap-1.5">
                              <span className="flex items-center gap-1">
                                <BrandBadge platform="facebook" size={16} />
                                <BrandBadge platform="instagram" size={16} />
                              </span>
                              Facebook + Instagram (legenda única)
                            </label>
                            <textarea
                              value={p.captions.instagram ?? p.captions.facebook ?? ""}
                              onChange={(e) => updateShared(p.uid, e.target.value)}
                              rows={7}
                              className="input resize-y min-h-24 text-sm leading-relaxed"
                              placeholder="Legenda para Facebook e Instagram"
                            />
                          </div>
                        )}
                        {p.targets.includes("linkedin") && (
                          <div>
                            <label className="label flex items-center gap-1.5">
                              <BrandBadge platform="linkedin" size={16} />
                              LinkedIn
                              {!liDirty[p.uid] && (
                                <span className="text-[var(--color-text-faint)] font-normal">· espelhando FB+IG</span>
                              )}
                            </label>
                            <textarea
                              value={p.captions.linkedin ?? p.captions.instagram ?? p.captions.facebook ?? ""}
                              onChange={(e) => updateLinkedin(p.uid, e.target.value)}
                              rows={5}
                              className="input resize-y min-h-20 text-sm leading-relaxed"
                              placeholder="Legenda para LinkedIn (por padrão igual à de FB+IG)"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-stretch gap-1.5 shrink-0 mt-1">
                    <button
                      type="button"
                      onClick={() => substitute(p.uid)}
                      disabled={regenerating[p.uid] || busy}
                      title="Substituir por um novo post gerado pela IA"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--color-text-muted)] border border-[var(--color-border)] hover:text-white hover:border-[var(--color-border-strong)] transition disabled:opacity-50"
                    >
                      <Icon.refresh className={`w-4 h-4 ${regenerating[p.uid] ? "animate-spin" : ""}`} />
                      {regenerating[p.uid] ? "Gerando..." : "Substituir"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssistantUid(p.uid)}
                      disabled={busy}
                      title="Abrir o assistente de IA para este post"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--color-accent)] border border-[var(--color-border)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-accent)]/10 transition disabled:opacity-50"
                    >
                      <Icon.zap className="w-4 h-4" />
                      Assistente
                    </button>
                    <button
                      type="button"
                      onClick={() => removePost(p.uid)}
                      disabled={busy}
                      title="Remover este post do calendário"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--color-text-faint)] border border-transparent hover:text-red-400 hover:border-red-500/30 transition disabled:opacity-50"
                    >
                      <Icon.trash className="w-4 h-4" />
                      Excluir
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* nova postagem manual no cronograma */}
          <button
            type="button"
            onClick={addPost}
            disabled={busy}
            className="w-full rounded-xl border border-dashed border-[var(--color-border-strong)] px-4 py-3.5 text-sm text-[var(--color-text-muted)] hover:text-white hover:border-[var(--color-accent)] transition-colors disabled:opacity-50"
          >
            + Adicionar postagem
          </button>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-[var(--color-border)]">
          {error && (
            <p className="mb-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button onClick={confirmClose} disabled={busy} className="btn-ghost flex-1">
              Cancelar
            </button>
            <button onClick={approve} disabled={busy || posts.length === 0} className="btn-primary flex-1">
              <Icon.check className="w-4 h-4" />
              {busy ? "Salvando..." : `Aprovar e salvar (${posts.length})`}
            </button>
          </div>
        </div>
      </div>

      {/* assistente de IA para o post selecionado */}
      {assistantUid && (() => {
        const target = posts.find((p) => p.uid === assistantUid);
        if (!target) return null;
        return (
          <div className="absolute inset-y-0 right-0 z-20 w-full max-w-md p-4 flex">
            <div
              className="relative flex flex-col w-full rounded-2xl border border-[var(--color-border-strong)] shadow-2xl overflow-hidden"
              style={{ backgroundColor: "var(--color-surface)" }}
            >
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]">
                <p className="text-xs font-medium text-[var(--color-text-muted)] truncate">
                  Assistente · {target.theme || "post sem título"}
                </p>
                <button
                  onClick={() => setAssistantUid(null)}
                  className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-white hover:bg-white/5 transition"
                  title="Fechar assistente"
                >
                  <Icon.x className="w-4 h-4" />
                </button>
              </div>
              <AssistantPanel
                key={assistantUid}
                className="flex-1 !border-0 !rounded-none !bg-transparent"
                clientId={clientId}
                getPost={() => {
                  const p = posts.find((x) => x.uid === assistantUid);
                  return {
                    theme: p?.theme,
                    format: p?.format,
                    targets: p?.targets,
                    caption: p?.captions.instagram ?? p?.captions.facebook ?? "",
                    scheduledAt: p?.scheduledLocal,
                    slides: p?.slides.filter((s) => s.trim()),
                  };
                }}
                onApplyCaption={(text) => updateShared(assistantUid, text)}
                onApplyTitle={(title) => update(assistantUid, { theme: title })}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
