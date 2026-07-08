"use client";

import { useEffect, useState } from "react";
import { BrandBadge, BRAND } from "@/components/BrandIcons";
import { Icon } from "@/components/Icons";

const MAX = 5;
const FMT: Record<string, string> = { feed: "Feed", story: "Story", carrossel: "Carrossel", reels: "Reels" };
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

type Post = {
  id: string;
  theme: string;
  format: string;
  mediaUrl: string | null;
  mediaItems: { url: string; type?: string }[] | null;
  captions: Record<string, string>;
  targets: string[];
  when: string;
  day: number;
  time: string;
  aiEditsUsed: number;
};

function isVid(u: string) {
  return /\.(mp4|mov|webm|m4v)$/i.test(u);
}

function mediaOf(post: Post) {
  return post.mediaItems?.length
    ? post.mediaItems
    : post.mediaUrl
      ? [{ url: post.mediaUrl, type: undefined as string | undefined }]
      : [];
}

function Thumb({ url, className = "" }: { url: string; className?: string }) {
  if (isVid(url)) {
    return <video src={url} muted className={`object-cover ${className}`} />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className={`object-cover ${className}`} />;
}

/* --------------------------- modal de detalhe --------------------------- */

function PostModal({
  token,
  post,
  onClose,
}: {
  token: string;
  post: Post;
  onClose: () => void;
}) {
  const media = mediaOf(post);
  const [active, setActive] = useState(0);
  const [caps, setCaps] = useState<Record<string, string>>(post.captions);
  const [editsUsed, setEditsUsed] = useState(post.aiEditsUsed);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

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
    const captions: Record<string, string> = {};
    for (const t of post.targets) captions[t] = caps[t] ?? "";
    const r = await fetch(`/api/aprovar/${token}/post/${post.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "edit", captions }),
    });
    setBusy("");
    setMsg(r.ok ? "Salvo ✓" : "Erro ao salvar");
  }

  async function regen() {
    if (editsUsed >= MAX) return;
    setBusy("ia");
    setMsg("");
    const r = await fetch(`/api/aprovar/${token}/post/${post.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "regenerate" }),
    });
    const d = await r.json().catch(() => null);
    setBusy("");
    if (!r.ok) { setMsg(typeof d?.error === "string" ? d.error : "Erro IA"); return; }
    const next: Record<string, string> = d.captions ?? caps;
    setCaps(next);
    setLiDirty(
      typeof next.linkedin === "string" &&
        next.linkedin !== (next.instagram ?? next.facebook ?? "")
    );
    setEditsUsed(d.aiEditsUsed ?? editsUsed + 1);
    setMsg("Nova versão gerada ✓");
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
            <p className="text-xs text-[var(--color-text-faint)]">
              {FMT[post.format] ?? post.format} · dia {post.day} · {post.time}
            </p>
          </div>
          <span className="text-[11px] text-[var(--color-text-muted)] shrink-0">{editsUsed}/{MAX} IA</span>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 p-1.5 rounded-lg hover:bg-white/10 text-[var(--color-text-muted)]"
          >
            <Icon.x className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* mídia */}
          {media[0] && (
            <div className="space-y-2">
              <div className="rounded-xl overflow-hidden bg-black/40 aspect-square flex items-center justify-center">
                <Thumb url={media[active]?.url ?? media[0].url} className="w-full h-full" />
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
          )}

          {/* legendas: FB+IG compartilham um campo; LinkedIn é próprio */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--color-text-muted)]">Legendas</span>
              <div className="flex gap-3">
                <button
                  onClick={regen}
                  disabled={busy !== "" || editsUsed >= MAX}
                  className="flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline disabled:opacity-40"
                >
                  <Icon.zap className="w-3.5 h-3.5" />
                  {busy === "ia" ? "Gerando..." : "Gerar IA"}
                </button>
                <button
                  onClick={save}
                  disabled={busy !== ""}
                  className="text-xs text-[var(--color-text-muted)] hover:text-white disabled:opacity-40"
                >
                  {busy === "save" ? "..." : "Salvar"}
                </button>
              </div>
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
                  rows={4}
                  className="input resize-none text-sm"
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
                  rows={4}
                  className="input resize-none text-sm"
                />
              </div>
            )}
          </div>
          {msg && <p className="text-xs text-[var(--color-text-muted)]">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ célula do dia ------------------------------ */

function DayCell({ post, onOpen }: { post: Post; onOpen: () => void }) {
  const media = mediaOf(post);
  return (
    <button
      onClick={onOpen}
      className="group w-full text-left rounded-lg overflow-hidden bg-black/30 border border-[var(--color-border)] hover:border-[var(--color-accent)] transition-colors"
    >
      <div className="aspect-square bg-black/40 flex items-center justify-center">
        {media[0] ? (
          <Thumb url={media[0].url} className="w-full h-full group-hover:scale-105 transition-transform" />
        ) : (
          <span className="text-[9px] text-[var(--color-text-faint)]">sem mídia</span>
        )}
      </div>
      <div className="px-1.5 py-1 flex items-center gap-1">
        {post.targets.map((t) => (
          <BrandBadge key={t} platform={t} size={13} />
        ))}
        <span className="ml-auto text-[9px] text-[var(--color-text-faint)] hidden sm:inline">{post.time}</span>
      </div>
    </button>
  );
}

/* --------------------------------- view --------------------------------- */

export default function ApprovalView({
  token,
  clientName,
  monthLabel,
  year,
  month,
  posts,
}: {
  token: string;
  clientName: string;
  monthLabel: string;
  year: number;
  month: number;
  posts: Post[];
}) {
  const [open, setOpen] = useState<Post | null>(null);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState("");

  async function approve() {
    setApproving(true);
    setError("");
    const r = await fetch(`/api/aprovar/${token}/approve`, { method: "POST" });
    setApproving(false);
    if (!r.ok) { setError("Não foi possível aprovar. Tente novamente."); return; }
    setApproved(true);
  }

  if (approved) {
    return (
      <div className="card p-8 max-w-md text-center">
        <h1 className="text-xl font-semibold mb-1">Aprovado ✓</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Obrigado! Seu cronograma de {monthLabel} foi aprovado e entrará na fila de publicação.
        </p>
      </div>
    );
  }

  // grade do mês (UTC para bater com monthRef)
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const byDay = new Map<number, Post[]>();
  for (const p of posts) {
    const arr = byDay.get(p.day) ?? [];
    arr.push(p);
    byDay.set(p.day, arr);
  }
  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="w-full max-w-3xl space-y-4">
      <div className="text-center mb-2">
        <h1 className="text-2xl font-semibold tracking-tight capitalize">{monthLabel}</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Olá, {clientName}! Toque em um post para ver e ajustar. {posts.length} posts no mês.
        </p>
      </div>

      <div className="card p-3 sm:p-4">
        <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-center text-[10px] sm:text-xs font-medium text-[var(--color-text-faint)] py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {cells.map((d, i) => {
            if (d === null) return <div key={`e${i}`} />;
            const dayPosts = byDay.get(d) ?? [];
            return (
              <div key={d} className="min-h-[3rem] flex flex-col gap-1">
                <span className="text-[10px] sm:text-xs text-[var(--color-text-faint)] leading-none pl-0.5">{d}</span>
                {dayPosts.map((p) => (
                  <DayCell key={p.id} post={p} onOpen={() => setOpen(p)} />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="sticky bottom-4 pt-2">
        <button onClick={approve} disabled={approving} className="btn-primary w-full !py-3 text-base shadow-2xl">
          {approving ? "Aprovando..." : "Aprovar cronograma"}
        </button>
      </div>

      {open && <PostModal token={token} post={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
