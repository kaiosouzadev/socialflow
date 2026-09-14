"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { BrandBadge, BRAND } from "@/components/BrandIcons";
import { Icon } from "@/components/Icons";
import { Logo } from "@/components/Logo";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
// pedido de ajuste formal precisa dizer O QUE mudar
const MIN_ADJUST = 30;

/** Cada tipo de post tem cor e rótulo próprios — é isso que diferencia os
 *  cards quando ainda não existe arte (antes tudo virava um retângulo preto). */
const FORMAT: Record<string, { label: string; color: string }> = {
  feed: { label: "Feed", color: "#7c5cff" },
  carrossel: { label: "Carrossel", color: "#38bdf8" },
  reels: { label: "Reels", color: "#f472b6" },
  story: { label: "Story", color: "#fbbf24" },
};
const fmtOf = (f: string) => FORMAT[f] ?? { label: f, color: "#a1a1aa" };

type Adjustment = {
  id: string;
  comment: string;
  status: string; // pendente | resolvido
  reply: string | null;
};

type Post = {
  id: string;
  theme: string;
  explanation: string;
  format: string;
  mediaUrl: string | null;
  mediaItems: { url: string; type?: string }[] | null;
  captions: Record<string, string>;
  targets: string[];
  when: string;
  fullWhen: string;
  day: number;
  time: string;
  aiEditsUsed: number;
  clientNote: string | null;
  slides: string[];
  adjustments: Adjustment[];
};

/** Feed + Story do mesmo tema no mesmo dia viram UM card. Antes apareciam
 *  como dois cards idênticos e o cliente lia isso como duplicação. */
type Group = {
  key: string;
  day: number;
  theme: string;
  posts: Post[];
  primary: Post;
};

function isVid(u: string) {
  return /\.(mp4|mov|webm|m4v)$/i.test(u);
}

const pendingOf = (p: Post) => p.adjustments.filter((a) => a.status === "pendente").length;

/* ------------------ "já vi este post" (por navegador) ------------------ */

const EMPTY: string[] = [];
const noopSubscribe = () => () => {};

/** true só depois da hidratação — os handlers de clique só existem a partir daí. */
function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

/**
 * O conjunto de temas já revisados vive no localStorage, que é estado externo
 * ao React — por isso um store com useSyncExternalStore, e não um efeito que
 * chama setState logo após montar.
 */
function createSeenStore(key: string) {
  let value: string[] = EMPTY;
  let loaded = false;
  const listeners = new Set<() => void>();

  return {
    subscribe(cb: () => void) {
      if (!loaded) {
        loaded = true;
        try {
          const raw = localStorage.getItem(key);
          const parsed = raw ? (JSON.parse(raw) as unknown) : null;
          if (Array.isArray(parsed) && parsed.length) value = parsed as string[];
        } catch {
          /* aba anônima ou storage bloqueado — segue sem marcação de visto */
        }
      }
      listeners.add(cb);
      cb(); // publica o que veio do localStorage
      return () => {
        listeners.delete(cb);
      };
    },
    getSnapshot: () => value,
    getServerSnapshot: () => EMPTY,
    add(k: string) {
      if (value.includes(k)) return;
      value = [...value, k];
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* sem persistência, mas a sessão atual continua marcando */
      }
      for (const l of listeners) l();
    },
  };
}

function mediaOf(post: Post) {
  return post.mediaItems?.length
    ? post.mediaItems
    : post.mediaUrl
      ? [{ url: post.mediaUrl, type: undefined as string | undefined }]
      : [];
}

/** Prévia do conteúdo no card: primeira linha da legenda ou, na fase
 *  cronograma (sem legenda ainda), a explicação do tema. */
function captionPreview(post: Post): string {
  const raw = post.captions.instagram ?? post.captions.facebook ?? post.captions.linkedin ?? "";
  const firstLine = raw.split("\n").find((l) => l.trim().length > 0) ?? "";
  return firstLine.trim() || post.explanation.trim();
}

function groupPosts(posts: Post[]): Group[] {
  const map = new Map<string, Post[]>();
  for (const p of posts) {
    // tema vazio não agrupa com nada (cai sozinho pelo id)
    const k = p.theme.trim() ? `${p.day}::${p.theme.trim().toLowerCase()}` : `${p.day}::#${p.id}`;
    const arr = map.get(k) ?? [];
    arr.push(p);
    map.set(k, arr);
  }
  const groups: Group[] = [];
  for (const [key, arr] of map) {
    const sorted = [...arr].sort((a, b) => a.time.localeCompare(b.time));
    // o principal é o primeiro que não for story; senão o mais cedo
    const primary = sorted.find((p) => p.format !== "story") ?? sorted[0];
    groups.push({ key, day: primary.day, theme: primary.theme, posts: sorted, primary });
  }
  return groups.sort((a, b) => a.day - b.day || a.primary.time.localeCompare(b.primary.time));
}

function Thumb({
  url,
  className = "",
  playable = false,
}: {
  url: string;
  className?: string;
  playable?: boolean;
}) {
  if (isVid(url)) {
    return (
      <video
        src={url}
        muted={!playable}
        controls={playable}
        playsInline
        preload="metadata"
        className={`object-cover ${className}`}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" loading="lazy" className={`object-cover ${className}`} />;
}

/** Placeholder por tipo de post — substitui o retângulo preto "sem mídia". */
function FormatPlaceholder({ format, compact = false }: { format: string; compact?: boolean }) {
  const f = fmtOf(format);
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-1"
      style={{ background: `linear-gradient(135deg, ${f.color}26, ${f.color}0d)` }}
    >
      <span style={{ color: f.color }}>
        <Icon.calendar className={compact ? "w-3.5 h-3.5" : "w-5 h-5"} />
      </span>
      {!compact && (
        <span className="text-[10px] font-semibold" style={{ color: f.color }}>
          {f.label}
        </span>
      )}
    </div>
  );
}

function FormatBadge({ format, size = "sm" }: { format: string; size?: "sm" | "xs" }) {
  const f = fmtOf(format);
  return (
    <span
      className={`inline-flex items-center rounded font-semibold leading-none ${
        size === "xs" ? "text-[9px] px-1 py-0.5" : "text-[10px] px-1.5 py-0.5"
      }`}
      style={{ background: `${f.color}22`, color: f.color, border: `1px solid ${f.color}40` }}
    >
      {f.label}
    </span>
  );
}

/* --------------------------- modal de detalhe --------------------------- */

function PostModal({
  token,
  group,
  onClose,
  onSaved,
  onNoted,
  onAdjustmentAdded,
  readOnly = false,
}: {
  token: string;
  group: Group;
  onClose: () => void;
  onSaved: (postId: string, captions: Record<string, string>) => void;
  onNoted: (postId: string, note: string | null) => void;
  onAdjustmentAdded: (postId: string, adjustment: Adjustment) => void;
  readOnly?: boolean;
}) {
  const [postId, setPostId] = useState(group.primary.id);
  const post = group.posts.find((p) => p.id === postId) ?? group.primary;

  const media = mediaOf(post);
  const [active, setActive] = useState(0);
  const [caps, setCaps] = useState<Record<string, string>>(post.captions);
  const [note, setNote] = useState(post.clientNote ?? "");
  const [noteOpen, setNoteOpen] = useState(!!post.clientNote);
  const [adjustComment, setAdjustComment] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  // trocar de post dentro do grupo recarrega os campos do post escolhido
  const [prevPostId, setPrevPostId] = useState(postId);
  if (postId !== prevPostId) {
    setPrevPostId(postId);
    setCaps(post.captions);
    setNote(post.clientNote ?? "");
    setNoteOpen(!!post.clientNote);
    setAdjustComment("");
    setAdjustOpen(false);
    setActive(0);
    setMsg("");
  }

  const hasCaption = !!(post.captions.instagram ?? post.captions.facebook ?? post.captions.linkedin);
  const hasMeta = post.targets.includes("instagram") || post.targets.includes("facebook");
  const hasLinkedin = post.targets.includes("linkedin");
  const shared = caps.instagram ?? caps.facebook ?? "";
  // LinkedIn espelha a legenda FB+IG até ser editado
  const [liDirty, setLiDirty] = useState(
    () => typeof post.captions.linkedin === "string" &&
      post.captions.linkedin !== (post.captions.instagram ?? post.captions.facebook ?? "")
  );

  function setShared(text: string) {
    setCaps((p) => ({
      ...p,
      ...(post.targets.includes("instagram") ? { instagram: text } : {}),
      ...(post.targets.includes("facebook") ? { facebook: text } : {}),
      ...(hasLinkedin && !liDirty ? { linkedin: text } : {}),
    }));
  }
  function setLinkedin(text: string) {
    setLiDirty(true);
    setCaps((p) => ({ ...p, linkedin: text }));
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function save() {
    setBusy("save");
    setMsg("");
    try {
      const captions: Record<string, string> = {};
      for (const t of post.targets) captions[t] = caps[t] ?? "";
      const r = await fetch(`/api/aprovar/${token}/post/${post.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit", captions }),
      });
      if (r.ok) {
        onSaved(post.id, captions);
        setMsg("Salvo ✓");
      } else {
        const d = await r.json().catch(() => null);
        setMsg(typeof d?.error === "string" ? d.error : "Erro ao salvar");
      }
    } catch {
      setMsg("Falha de conexão ao salvar. Tente novamente.");
    } finally {
      setBusy("");
    }
  }

  async function saveNote() {
    setBusy("note");
    setMsg("");
    try {
      const r = await fetch(`/api/aprovar/${token}/post/${post.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "note", clientNote: note }),
      });
      if (r.ok) {
        onNoted(post.id, note.trim() || null);
        setMsg(note.trim() ? "Comentário enviado ✓" : "Comentário removido");
      } else {
        const d = await r.json().catch(() => null);
        setMsg(typeof d?.error === "string" ? d.error : "Erro ao enviar comentário");
      }
    } catch {
      setMsg("Falha de conexão. Tente novamente.");
    } finally {
      setBusy("");
    }
  }

  const adjustRemaining = MIN_ADJUST - adjustComment.trim().length;

  async function requestAdjust() {
    if (adjustComment.trim().length < MIN_ADJUST || busy) return;
    setBusy("adjust");
    setMsg("");
    try {
      const r = await fetch(`/api/aprovar/${token}/post/${post.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "adjust", comment: adjustComment.trim() }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg(typeof d?.error === "string" ? d.error : "Erro ao enviar o pedido de ajuste.");
        return;
      }
      onAdjustmentAdded(post.id, d.adjustment);
      setAdjustComment("");
      setAdjustOpen(false);
      setMsg("Pedido de ajuste enviado ✓ — a equipe foi avisada.");
    } catch {
      setMsg("Falha de conexão. Tente novamente.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-b-none sm:rounded-2xl animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-3 bg-[var(--color-surface)]/95 backdrop-blur border-b border-[var(--color-border)]">
          <div className="min-w-0">
            <p className="font-medium truncate">{post.theme || "Post"}</p>
            <p className="text-xs text-[var(--color-text-faint)] capitalize">{post.fullWhen}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 p-1.5 rounded-lg hover:bg-white/10 text-[var(--color-text-muted)]"
          >
            <Icon.x className="w-5 h-5" />
          </button>
        </div>

        {/* seletor quando o tema tem Feed + Story */}
        {group.posts.length > 1 && (
          <div className="flex gap-2 px-5 pt-4 flex-wrap">
            {group.posts.map((p) => {
              const f = fmtOf(p.format);
              const on = p.id === post.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setPostId(p.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                  style={{
                    background: on ? `${f.color}22` : "transparent",
                    borderColor: on ? `${f.color}66` : "var(--color-border)",
                    color: on ? f.color : "var(--color-text-muted)",
                  }}
                >
                  {f.label} · {p.time}
                  {(p.clientNote || pendingOf(p) > 0) && " ✎"}
                </button>
              );
            })}
          </div>
        )}

        <div className="p-5 space-y-4">
          {/* explicação do tema — é isso que o cliente aprova na fase cronograma */}
          {post.explanation && (
            <div className="rounded-xl border border-[var(--color-border)] bg-white/[0.02] p-4">
              <p className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5">
                Sobre esta postagem
              </p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{post.explanation}</p>
            </div>
          )}

          {/* mídia (ou placeholder do tipo, quando a arte ainda não existe) */}
          <div className="space-y-2">
            <div className="rounded-xl overflow-hidden bg-black/40 aspect-square flex items-center justify-center">
              {media[0] ? (
                <Thumb url={media[active]?.url ?? media[0].url} playable className="w-full h-full" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                  <FormatPlaceholder format={post.format} />
                  <p className="text-xs text-[var(--color-text-faint)] px-6 text-center">
                    A arte deste post ainda será produzida pela agência.
                  </p>
                </div>
              )}
            </div>
            {media.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {media.map((m, i) => (
                  <button
                    key={m.url + i}
                    onClick={() => setActive(i)}
                    className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 ${
                      i === active ? "border-[var(--color-accent)]" : "border-transparent opacity-70"
                    }`}
                  >
                    <Thumb url={m.url} className="w-full h-full" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <FormatBadge format={post.format} />
            <span className="flex items-center gap-1">
              {post.targets.map((t) => (
                <BrandBadge key={t} platform={t} size={16} />
              ))}
            </span>
          </div>

          {/* roteiro das telas (carrossel/reels ainda sem arte final) */}
          {post.slides.length > 0 && (
            <div className="rounded-xl border border-[var(--color-border)] bg-white/[0.02] overflow-hidden">
              <p className="px-4 py-2 text-xs font-medium text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                {post.format === "reels" ? "Telas do reels" : "Páginas do carrossel"}
              </p>
              <div className="divide-y divide-[var(--color-border)]">
                {post.slides.map((s, i) => (
                  <div key={i} className="px-4 py-2.5 flex gap-2.5">
                    <span className="shrink-0 text-[11px] font-semibold text-[var(--color-accent)] mt-0.5">
                      {i + 1}
                    </span>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{s}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* legendas: só quando o conteúdo já foi produzido (fase 2). Na fase
              cronograma o cliente aprova o tema; a legenda vem depois. */}
          {hasCaption && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--color-text-muted)]">Legendas</span>
                {!readOnly && (
                  <button
                    onClick={save}
                    disabled={busy !== ""}
                    className="text-xs font-medium text-[var(--color-accent)] hover:underline disabled:opacity-40"
                  >
                    {busy === "save" ? "Salvando..." : "Salvar alterações"}
                  </button>
                )}
              </div>

              {hasMeta && (
                <div>
                  <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)] mb-1.5">
                    <span className="flex items-center gap-1">
                      {post.targets.includes("facebook") && <BrandBadge platform="facebook" size={18} />}
                      {post.targets.includes("instagram") && <BrandBadge platform="instagram" size={18} />}
                    </span>
                    {post.targets.includes("facebook") && post.targets.includes("instagram")
                      ? "Facebook + Instagram (legenda única)"
                      : BRAND[post.targets.includes("facebook") ? "facebook" : "instagram"]?.label}
                  </span>
                  <textarea
                    value={shared}
                    onChange={(e) => setShared(e.target.value)}
                    rows={7}
                    readOnly={readOnly}
                    className="input resize-y min-h-24 text-sm leading-relaxed read-only:opacity-70"
                  />
                </div>
              )}

              {hasLinkedin && (
                <div>
                  <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)] mb-1.5">
                    <BrandBadge platform="linkedin" size={18} /> LinkedIn
                    {!liDirty && hasMeta && (
                      <span className="text-[var(--color-text-faint)] font-normal">· espelhando FB+IG</span>
                    )}
                  </span>
                  <textarea
                    value={caps.linkedin ?? shared}
                    onChange={(e) => setLinkedin(e.target.value)}
                    rows={5}
                    readOnly={readOnly}
                    className="input resize-y min-h-20 text-sm leading-relaxed read-only:opacity-70"
                  />
                </div>
              )}
            </div>
          )}

          {/* pedidos de ajuste formais (bloqueiam a aprovação até a equipe concluir) */}
          {post.adjustments.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--color-text-muted)]">Pedidos de ajuste</p>
              {post.adjustments.map((a) => (
                <div
                  key={a.id}
                  className={`rounded-xl border p-3 text-sm space-y-1.5 ${
                    a.status === "pendente"
                      ? "border-amber-500/30 bg-amber-500/[0.06]"
                      : "border-emerald-500/25 bg-emerald-500/[0.05]"
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{a.comment}</p>
                  {a.status === "pendente" ? (
                    <p className="text-[11px] text-amber-300 font-medium">
                      Aguardando a equipe concluir este ajuste
                    </p>
                  ) : (
                    <div className="text-[11px] text-emerald-300 font-medium">
                      Concluído ✓
                      {a.reply ? (
                        <span className="block font-normal text-emerald-200/80 mt-0.5">
                          Resposta: {a.reply}
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* pedir ajuste formal neste post */}
          {!readOnly && (
            <div className="rounded-xl border border-[var(--color-border)] bg-white/[0.02] p-4">
              {!adjustOpen ? (
                <button
                  onClick={() => setAdjustOpen(true)}
                  className="text-xs font-medium text-[var(--color-accent)] hover:underline"
                >
                  Solicitar ajuste nesta postagem
                </button>
              ) : (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-[var(--color-text-muted)]">
                    O que você quer mudar nesta postagem?
                  </label>
                  <textarea
                    value={adjustComment}
                    onChange={(e) => setAdjustComment(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    placeholder="Descreva o ajuste (mínimo 30 caracteres). Ex: trocar o tema por algo sobre resultados; não citar preço."
                    className="input resize-y min-h-20 text-sm"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className={`text-[11px] ${
                        adjustRemaining > 0 ? "text-[var(--color-text-faint)]" : "text-emerald-300"
                      }`}
                    >
                      {adjustRemaining > 0
                        ? `Faltam ${adjustRemaining} caracteres`
                        : "Pronto para enviar ✓"}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setAdjustOpen(false);
                          setAdjustComment("");
                        }}
                        className="text-xs text-[var(--color-text-muted)] hover:text-white"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={requestAdjust}
                        disabled={busy !== "" || adjustComment.trim().length < MIN_ADJUST}
                        className="btn-primary !py-1.5 !px-3.5 text-xs disabled:opacity-40"
                      >
                        {busy === "adjust" ? "Enviando..." : "Enviar pedido de ajuste"}
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-[var(--color-text-faint)]">
                    A aprovação do cronograma fica bloqueada até a equipe concluir seus ajustes.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* comentário livre (não bloqueia — observação para a agência) */}
          {!readOnly && (
            <div className="rounded-xl border border-[var(--color-border)] bg-white/[0.02] p-4">
              {!noteOpen ? (
                <button
                  onClick={() => setNoteOpen(true)}
                  className="text-xs text-[var(--color-text-muted)] hover:text-white hover:underline"
                >
                  Deixar uma observação livre neste post (não trava a aprovação)
                </button>
              ) : (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-[var(--color-text-muted)]">
                    Observação para a agência sobre este post
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    maxLength={1000}
                    placeholder="Ex: gostei do tema; se possível usar foto da equipe."
                    className="input resize-y min-h-16 text-sm"
                  />
                  <div className="flex items-center gap-3">
                    <button
                      onClick={saveNote}
                      disabled={busy !== ""}
                      className="btn-ghost !py-1.5 text-xs disabled:opacity-40"
                    >
                      {busy === "note" ? "Enviando..." : "Enviar observação"}
                    </button>
                    <span className="text-[11px] text-[var(--color-text-faint)]">
                      {note.length}/1000
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {readOnly && post.clientNote && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-4">
              <p className="text-xs font-medium text-amber-200/90 mb-1">Seu comentário</p>
              <p className="text-sm whitespace-pre-wrap">{post.clientNote}</p>
            </div>
          )}

          {msg && <p className="text-xs text-[var(--color-text-muted)]">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ cards ------------------------------ */

function GroupCard({
  group,
  seen,
  onOpen,
  compact,
}: {
  group: Group;
  seen: boolean;
  onOpen: () => void;
  compact: boolean;
}) {
  const primary = group.primary;
  const media = mediaOf(primary);
  const extras = group.posts.filter((p) => p.id !== primary.id);
  const preview = captionPreview(primary);
  const noted = group.posts.some((p) => p.clientNote);
  const pending = group.posts.reduce((n, p) => n + pendingOf(p), 0);
  const f = fmtOf(primary.format);

  return (
    <button
      onClick={onOpen}
      className="group relative w-full text-left rounded-lg overflow-hidden bg-white/[0.03] border transition-colors hover:border-[var(--color-accent)]"
      style={{
        borderColor: pending > 0 ? "#f59e0b88" : seen ? `${f.color}55` : "var(--color-border)",
      }}
    >
      {/* faixa de cor do tipo — diferencia Feed/Story/Carrossel/Reels de relance */}
      <span className="absolute left-0 top-0 bottom-0 w-[3px] z-10" style={{ background: f.color }} />

      <div className={compact ? "aspect-square" : "aspect-[4/3]"}>
        {media[0] ? (
          <Thumb url={media[0].url} className="w-full h-full group-hover:scale-105 transition-transform" />
        ) : (
          <FormatPlaceholder format={primary.format} compact={compact} />
        )}
      </div>

      <div className="px-2 py-1.5 space-y-1">
        <div className="flex items-center gap-1 flex-wrap">
          <FormatBadge format={primary.format} size={compact ? "xs" : "sm"} />
          {extras.map((p) => (
            <span
              key={p.id}
              className="text-[9px] font-semibold leading-none rounded px-1 py-0.5"
              style={{
                background: `${fmtOf(p.format).color}22`,
                color: fmtOf(p.format).color,
                border: `1px solid ${fmtOf(p.format).color}40`,
              }}
            >
              + {fmtOf(p.format).label} {p.time}
            </span>
          ))}
        </div>

        {/* o conteúdo que faltava: tema e prévia (legenda ou explicação) */}
        <p className={`font-medium leading-tight line-clamp-2 ${compact ? "text-[10px]" : "text-xs"}`}>
          {group.theme || "Sem tema"}
        </p>
        {!compact && preview && (
          <p className="text-[10px] leading-tight text-[var(--color-text-faint)] line-clamp-2">
            {preview}
          </p>
        )}

        <div className="flex items-center gap-1">
          {primary.targets.map((t) => (
            <BrandBadge key={t} platform={t} size={compact ? 11 : 13} />
          ))}
          <span className="ml-auto text-[9px] text-[var(--color-text-faint)]">{primary.time}</span>
        </div>
      </div>

      {/* marcações: ajuste pendente, comentado e visto */}
      <span className="absolute top-1 right-1 z-10 flex gap-1">
        {pending > 0 && (
          <span className="w-4 h-4 rounded-full bg-amber-400 text-black flex items-center justify-center text-[9px] font-bold">
            !
          </span>
        )}
        {noted && pending === 0 && (
          <span className="w-4 h-4 rounded-full bg-amber-400/70 text-black flex items-center justify-center text-[9px] font-bold">
            ✎
          </span>
        )}
        {seen && (
          <span className="w-4 h-4 rounded-full bg-emerald-400/90 text-black flex items-center justify-center">
            <Icon.check className="w-2.5 h-2.5" />
          </span>
        )}
      </span>
    </button>
  );
}

/* --------------------------------- view --------------------------------- */

export default function ApprovalView({
  token,
  clientName,
  clientLogoUrl,
  clientBrandColor,
  monthLabel,
  year,
  month,
  posts: initialPosts,
  readOnly = false,
  changesAsked = false,
  scheduleNote,
}: {
  token: string;
  clientName: string;
  clientLogoUrl: string | null;
  clientBrandColor: string | null;
  monthLabel: string;
  year: number;
  month: number;
  posts: Post[];
  readOnly?: boolean;
  changesAsked?: boolean;
  scheduleNote: string | null;
}) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [view, setView] = useState<"calendario" | "feed">("calendario");
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [askingChanges, setAskingChanges] = useState(false);
  const [changesNote, setChangesNote] = useState("");
  const [changesSent, setChangesSent] = useState(false);

  /* Antes da hidratação os handlers de clique ainda não existem — o primeiro
     toque logo após carregar era engolido em silêncio. A grade só fica
     clicável quando está pronta, e o cliente vê esse estado. */
  const ready = useHydrated();

  const groups = useMemo(() => groupPosts(posts), [posts]);

  const [seenStore] = useState(() => createSeenStore(`sf-approval-seen:${token}`));
  const seenList = useSyncExternalStore(
    seenStore.subscribe,
    seenStore.getSnapshot,
    seenStore.getServerSnapshot
  );
  const seen = useMemo(() => new Set(seenList), [seenList]);

  function openGroup(key: string) {
    setOpenKey(key);
    seenStore.add(key);
  }

  const open = openKey ? groups.find((g) => g.key === openKey) ?? null : null;

  function handleSaved(postId: string, captions: Record<string, string>) {
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, captions } : p)));
  }
  function handleNoted(postId: string, note: string | null) {
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, clientNote: note } : p)));
  }
  function handleAdjustmentAdded(postId: string, adjustment: Adjustment) {
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId ? { ...p, adjustments: [...p.adjustments, adjustment] } : p
      )
    );
  }

  // ajustes formais pendentes bloqueiam a aprovação até a equipe concluir
  const pendingCount = useMemo(() => posts.reduce((n, p) => n + pendingOf(p), 0), [posts]);

  // pré-visualização estilo feed: temas não-story com arte, mais recente primeiro
  const feedGroups = useMemo(
    () => groups.filter((g) => g.primary.format !== "story" && mediaOf(g.primary).length > 0),
    [groups]
  );

  async function approve() {
    setApproving(true);
    setError("");
    try {
      const r = await fetch(`/api/aprovar/${token}/approve`, { method: "POST" });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setError(
          typeof d?.error === "string" ? d.error : "Não foi possível aprovar. Tente novamente."
        );
        return;
      }
      setApproved(true);
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setApproving(false);
      setConfirming(false);
    }
  }

  async function requestChanges() {
    setApproving(true);
    setError("");
    try {
      const r = await fetch(`/api/aprovar/${token}/request-changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: changesNote }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setError(typeof d?.error === "string" ? d.error : "Não foi possível enviar. Tente novamente.");
        return;
      }
      setChangesSent(true);
      setAskingChanges(false);
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setApproving(false);
    }
  }

  const accent = clientBrandColor && /^#[0-9a-f]{6}$/i.test(clientBrandColor)
    ? clientBrandColor
    : "var(--color-accent)";

  const identity = (
    <div className="flex items-center justify-center gap-3 mb-6">
      {clientLogoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={clientLogoUrl}
          alt={clientName}
          className="w-10 h-10 rounded-xl object-cover border border-[var(--color-border)]"
        />
      ) : (
        <span
          className="w-10 h-10 rounded-xl flex items-center justify-center font-semibold text-sm"
          style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}55` }}
        >
          {clientName.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span className="font-semibold tracking-tight">{clientName}</span>
      <span className="text-[var(--color-text-faint)]">·</span>
      <span className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)]">
        <Logo size={18} />
        Social<span className="gradient-text -ml-1.5">Flow</span>
      </span>
    </div>
  );

  if (approved) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
        <div className="card p-8 max-w-md text-center">
          <h1 className="text-xl font-semibold mb-1">Aprovado ✓</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Obrigado! Seu cronograma de {monthLabel} foi aprovado. Agora a equipe produz as
            legendas e artes — você recebe toda semana as postagens completas da semana seguinte
            para revisão final.
          </p>
        </div>
      </div>
    );
  }

  if (changesSent) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
        <div className="card p-8 max-w-md text-center">
          <h1 className="text-xl font-semibold mb-1">Ajustes solicitados ✓</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            A agência recebeu seus comentários e vai revisar o cronograma de {monthLabel}. Nada será
            publicado até você aprovar.
          </p>
        </div>
      </div>
    );
  }

  // grade do mês (UTC para bater com monthRef)
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const byDay = new Map<number, Group[]>();
  for (const g of groups) {
    const arr = byDay.get(g.day) ?? [];
    arr.push(g);
    byDay.set(g.day, arr);
  }
  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const reviewed = groups.filter((g) => seen.has(g.key)).length;
  const pct = groups.length ? Math.round((reviewed / groups.length) * 100) : 0;
  const notedCount = posts.filter((p) => p.clientNote).length;

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8 sm:py-10">
      <div className="w-full max-w-3xl space-y-4">
        {identity}

        <div className="text-center mb-2">
          <h1 className="text-2xl font-semibold tracking-tight capitalize">{monthLabel}</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {readOnly
              ? "Este cronograma já foi aprovado — toque em um post para rever."
              : `${groups.length} ${groups.length === 1 ? "tema" : "temas"} · ${posts.length} ${posts.length === 1 ? "post" : "posts"}. Toque em um card para ver e comentar.`}
          </p>
        </div>

        {readOnly && (
          <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 text-center">
            Cronograma aprovado ✓ — as postagens completas chegam para sua revisão toda semana.
          </p>
        )}

        {!readOnly && changesAsked && (
          <div className="text-sm text-amber-200/90 bg-amber-500/[0.07] border border-amber-500/20 rounded-lg px-3 py-2">
            <p className="font-medium">Ajustes já solicitados</p>
            {scheduleNote && <p className="mt-1 whitespace-pre-wrap">{scheduleNote}</p>}
            <p className="mt-1 text-xs text-[var(--color-text-faint)]">
              A agência está revisando. Você pode continuar comentando ou aprovar quando estiver ok.
            </p>
          </div>
        )}

        {!readOnly && pendingCount > 0 && (
          <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-center">
            {pendingCount} pedido(s) de ajuste aguardando a equipe — a aprovação libera assim que
            forem concluídos.
          </p>
        )}

        {/* progresso da revisão */}
        {!readOnly && (
          <div className="card px-4 py-3">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-[var(--color-text-muted)]">
                {reviewed} de {groups.length} {groups.length === 1 ? "tema revisado" : "temas revisados"}
                {notedCount > 0 && (
                  <span className="text-amber-300/90">
                    {" "}· {notedCount} com comentário
                  </span>
                )}
              </span>
              <span className="text-[var(--color-text-faint)] tabular-nums">{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: accent }}
              />
            </div>
          </div>
        )}

        {/* alternância calendário / feed (feed só quando já há artes) */}
        {feedGroups.length > 0 && (
          <div className="flex justify-center">
            <div className="flex items-center rounded-lg border border-[var(--color-border)] overflow-hidden text-sm">
              <button
                onClick={() => setView("calendario")}
                className={`px-3.5 py-1.5 font-medium transition-colors ${
                  view === "calendario"
                    ? "bg-[var(--color-accent)] text-white"
                    : "text-[var(--color-text-muted)] hover:text-white"
                }`}
              >
                Calendário
              </button>
              <button
                onClick={() => setView("feed")}
                className={`px-3.5 py-1.5 font-medium transition-colors ${
                  view === "feed"
                    ? "bg-[var(--color-accent)] text-white"
                    : "text-[var(--color-text-muted)] hover:text-white"
                }`}
              >
                Ver como feed
              </button>
            </div>
          </div>
        )}

        {!ready && (
          <p className="text-xs text-center text-[var(--color-text-faint)]">Preparando cronograma…</p>
        )}

        {view === "feed" && feedGroups.length > 0 ? (
          /* pré-visualização estilo feed do Instagram: grade 3xN, mais recente primeiro */
          <div className={`card p-2 sm:p-3 ${ready ? "" : "opacity-50 pointer-events-none"}`}>
            <div className="grid grid-cols-3 gap-0.5 sm:gap-1">
              {[...feedGroups].reverse().map((g) => {
                const m = mediaOf(g.primary)[0];
                return (
                  <button
                    key={g.key}
                    onClick={() => openGroup(g.key)}
                    className="relative aspect-square overflow-hidden group"
                  >
                    <Thumb url={m.url} className="w-full h-full group-hover:opacity-80 transition-opacity" />
                    {g.primary.format === "carrossel" && (
                      <span className="absolute top-1.5 right-1.5 text-white drop-shadow">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h13a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Zm-3 9V4a1 1 0 0 1 1-1h12v2H6v11H4Z"/></svg>
                      </span>
                    )}
                    {g.primary.format === "reels" && (
                      <span className="absolute top-1.5 right-1.5 text-white drop-shadow">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7L8 5Z"/></svg>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            {/* ---------- lista (celular): o cliente abre isso do WhatsApp ---------- */}
            <div className={`sm:hidden space-y-3 ${ready ? "" : "opacity-50 pointer-events-none"}`}>
              {[...byDay.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([day, dayGroups]) => {
                  const weekday = WEEKDAYS[new Date(Date.UTC(year, month, day)).getUTCDay()];
                  return (
                    <div key={day} className="card p-3">
                      <p className="text-xs font-semibold text-[var(--color-text-muted)] mb-2">
                        {weekday}, {day} de {monthLabel}
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {dayGroups.map((g) => (
                          <GroupCard
                            key={g.key}
                            group={g}
                            seen={seen.has(g.key)}
                            onOpen={() => openGroup(g.key)}
                            compact={false}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* ---------- calendário (tablet/desktop) ---------- */}
            <div className={`hidden sm:block card p-4 ${ready ? "" : "opacity-50 pointer-events-none"}`}>
              <div className="grid grid-cols-7 gap-2 mb-1">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="text-center text-xs font-medium text-[var(--color-text-faint)] py-1">
                    {w}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-2">
                {cells.map((d, i) => {
                  if (d === null) return <div key={`e${i}`} />;
                  const dayGroups = byDay.get(d) ?? [];
                  return (
                    <div key={d} className="min-h-[3rem] flex flex-col gap-1">
                      <span className="text-xs text-[var(--color-text-faint)] leading-none pl-0.5">{d}</span>
                      {dayGroups.map((g) => (
                        <GroupCard
                          key={g.key}
                          group={g}
                          seen={seen.has(g.key)}
                          onOpen={() => openGroup(g.key)}
                          compact
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {!readOnly && (
          <div className="sticky bottom-4 pt-2 space-y-2">
            <button
              onClick={() => setAskingChanges(true)}
              disabled={approving || !ready}
              className="btn-ghost w-full !py-2.5 text-sm disabled:opacity-40"
            >
              Solicitar ajustes
            </button>
            <button
              onClick={() => setConfirming(true)}
              disabled={approving || !ready || pendingCount > 0}
              title={
                pendingCount > 0
                  ? "Aguardando a equipe concluir os ajustes solicitados"
                  : undefined
              }
              className="btn-primary w-full !py-3 text-base shadow-2xl disabled:opacity-40"
            >
              {pendingCount > 0
                ? `Aguardando ${pendingCount} ajuste(s) da equipe`
                : "Aprovar cronograma"}
            </button>
          </div>
        )}

        {open && (
          <PostModal
            token={token}
            group={open}
            onClose={() => setOpenKey(null)}
            onSaved={handleSaved}
            onNoted={handleNoted}
            onAdjustmentAdded={handleAdjustmentAdded}
            readOnly={readOnly}
          />
        )}

        {/* confirmação com resumo — aprovar deixou de ser 1 clique */}
        {confirming && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => setConfirming(false)}
          >
            <div
              className="card w-full max-w-md rounded-b-none sm:rounded-2xl p-6 animate-fade-up"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-semibold mb-1">Aprovar cronograma?</h2>
              <p className="text-sm text-[var(--color-text-muted)] mb-4">
                Depois de aprovado, a equipe produz o conteúdo completo e você revisa as postagens
                semana a semana antes da publicação.
              </p>

              <div className="rounded-xl border border-[var(--color-border)] bg-white/[0.02] divide-y divide-[var(--color-border)] mb-4 text-sm">
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-[var(--color-text-muted)]">Mês</span>
                  <span className="font-medium capitalize">{monthLabel}</span>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-[var(--color-text-muted)]">Temas</span>
                  <span className="font-medium">{groups.length}</span>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-[var(--color-text-muted)]">Posts</span>
                  <span className="font-medium">{posts.length}</span>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-[var(--color-text-muted)]">Revisados por você</span>
                  <span className="font-medium">
                    {reviewed} de {groups.length}
                  </span>
                </div>
              </div>

              {reviewed < groups.length && (
                <p className="text-xs text-amber-200/90 bg-amber-500/[0.07] border border-amber-500/20 rounded-lg px-3 py-2 mb-4">
                  Você ainda não abriu {groups.length - reviewed}{" "}
                  {groups.length - reviewed === 1 ? "tema" : "temas"}. Pode aprovar mesmo assim.
                </p>
              )}
              {notedCount > 0 && (
                <p className="text-xs text-amber-200/90 bg-amber-500/[0.07] border border-amber-500/20 rounded-lg px-3 py-2 mb-4">
                  Há {notedCount} {notedCount === 1 ? "post" : "posts"} com observação. Se aprovar
                  agora, o cronograma segue como está.
                </p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setConfirming(false)}
                  disabled={approving}
                  className="btn-ghost flex-1"
                >
                  Voltar
                </button>
                <button onClick={approve} disabled={approving} className="btn-primary flex-1">
                  {approving ? "Aprovando..." : "Confirmar aprovação"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* pedir ajustes com comentário geral */}
        {askingChanges && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => setAskingChanges(false)}
          >
            <div
              className="card w-full max-w-md rounded-b-none sm:rounded-2xl p-6 animate-fade-up"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-semibold mb-1">Solicitar ajustes</h2>
              <p className="text-sm text-[var(--color-text-muted)] mb-4">
                Conte o que precisa mudar. Nada será publicado até você aprovar.
                {notedCount > 0 && ` Seus ${notedCount} comentário(s) por post vão junto.`}
              </p>
              <textarea
                value={changesNote}
                onChange={(e) => setChangesNote(e.target.value)}
                rows={5}
                maxLength={2000}
                placeholder="Ex: trocar os temas da semana 2; usar fotos da equipe em vez de banco de imagens."
                className="input resize-y min-h-24 text-sm mb-4"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => setAskingChanges(false)}
                  disabled={approving}
                  className="btn-ghost flex-1"
                >
                  Cancelar
                </button>
                <button
                  onClick={requestChanges}
                  disabled={approving || (!changesNote.trim() && notedCount === 0)}
                  className="btn-primary flex-1 disabled:opacity-40"
                >
                  {approving ? "Enviando..." : "Enviar"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
