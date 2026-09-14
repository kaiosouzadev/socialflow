"use client";

import { useMemo, useState } from "react";
import { BrandBadge } from "@/components/BrandIcons";
import { Icon } from "@/components/Icons";

const FMT: Record<string, string> = { feed: "Feed", story: "Story", carrossel: "Carrossel", reels: "Reels" };
const MIN_ADJUST = 30;

type Adjustment = { id: string; comment: string; status: string; reply: string | null };

type Post = {
  id: string;
  theme: string;
  explanation: string;
  format: string;
  caption: string;
  mediaUrl: string | null;
  mediaItems: { url: string; type?: string }[] | null;
  slides: string[];
  targets: string[];
  when: string;
  day: number;
  time: string;
  approved: boolean;
  deadlineLabel: string;
  overdue: boolean;
  adjustments: Adjustment[];
};

const isVid = (u: string) => /\.(mp4|mov|webm|m4v)$/i.test(u);

function Media({ post }: { post: Post }) {
  const items = post.mediaItems?.length
    ? post.mediaItems
    : post.mediaUrl
      ? [{ url: post.mediaUrl }]
      : [];
  const [active, setActive] = useState(0);
  if (items.length === 0) return null;
  const cur = items[Math.min(active, items.length - 1)];
  return (
    <div className="space-y-2">
      <div className="rounded-xl overflow-hidden bg-black/40 aspect-square flex items-center justify-center">
        {isVid(cur.url) ? (
          <video src={cur.url} controls playsInline preload="metadata" className="w-full h-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cur.url} alt="" loading="lazy" className="w-full h-full object-cover" />
        )}
      </div>
      {items.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {items.map((m, i) => (
            <button
              key={m.url + i}
              onClick={() => setActive(i)}
              className={`shrink-0 w-12 h-12 rounded-lg overflow-hidden border-2 ${
                i === active ? "border-[var(--color-accent)]" : "border-transparent opacity-70"
              }`}
            >
              {isVid(m.url) ? (
                <video src={m.url} muted preload="metadata" className="w-full h-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt="" loading="lazy" className="w-full h-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PostCard({
  token,
  post,
  onChange,
}: {
  token: string;
  post: Post;
  onChange: (p: Post) => void;
}) {
  const [comment, setComment] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const pending = post.adjustments.some((a) => a.status === "pendente");
  const remaining = MIN_ADJUST - comment.trim().length;

  async function act(action: "approve" | "adjust") {
    setBusy(action);
    setMsg("");
    try {
      const r = await fetch(`/api/aprovar-semana/${token}/post/${post.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "approve" ? { action } : { action, comment: comment.trim() }
        ),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg(typeof d?.error === "string" ? d.error : "Não foi possível enviar. Tente novamente.");
        return;
      }
      if (action === "approve") {
        onChange({ ...post, approved: true });
        setMsg("Postagem aprovada ✓");
      } else {
        onChange({ ...post, approved: false, adjustments: [...post.adjustments, d.adjustment] });
        setComment("");
        setShowForm(false);
        setMsg("Pedido de ajuste enviado ✓ — a equipe foi avisada.");
      }
    } catch {
      setMsg("Falha de conexão. Tente novamente.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="card overflow-hidden">
      {/* cabeçalho do post */}
      <div className="px-5 py-3.5 border-b border-[var(--color-border)] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold truncate">{post.theme || "Post"}</p>
          <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
            {FMT[post.format] ?? post.format} · {post.when}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {post.approved ? (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border text-emerald-300 bg-emerald-500/10 border-emerald-500/25">
              Aprovada ✓
            </span>
          ) : pending ? (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border text-amber-300 bg-amber-500/10 border-amber-500/25">
              Ajuste em andamento
            </span>
          ) : (
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                post.overdue
                  ? "text-red-300 bg-red-500/10 border-red-500/25"
                  : "text-sky-300 bg-sky-500/10 border-sky-500/25"
              }`}
            >
              Responder até {post.deadlineLabel}
            </span>
          )}
          <div className="flex gap-1">
            {post.targets.map((t) => (
              <BrandBadge key={t} platform={t} size={16} />
            ))}
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <Media post={post} />

        {post.slides.length > 0 && (
          <div className="rounded-xl border border-[var(--color-border)] bg-white/[0.02] overflow-hidden">
            <p className="px-4 py-2 text-xs font-medium text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
              {post.format === "reels" ? "Telas do reels" : "Páginas do carrossel"}
            </p>
            <div className="divide-y divide-[var(--color-border)]">
              {post.slides.map((s, i) => (
                <div key={i} className="px-4 py-2 flex gap-2.5">
                  <span className="shrink-0 text-[11px] font-semibold text-[var(--color-accent)] mt-0.5">{i + 1}</span>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{s}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {post.caption && (
          <div>
            <p className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5">Legenda</p>
            <p className="text-sm whitespace-pre-wrap leading-relaxed rounded-xl border border-[var(--color-border)] bg-white/[0.02] p-4">
              {post.caption}
            </p>
          </div>
        )}

        {post.adjustments.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--color-text-muted)]">Pedidos de ajuste</p>
            {post.adjustments.map((a) => (
              <div
                key={a.id}
                className={`rounded-xl border p-3 text-sm space-y-1 ${
                  a.status === "pendente"
                    ? "border-amber-500/30 bg-amber-500/[0.06]"
                    : "border-emerald-500/25 bg-emerald-500/[0.05]"
                }`}
              >
                <p className="whitespace-pre-wrap leading-relaxed">{a.comment}</p>
                {a.status === "pendente" ? (
                  <p className="text-[11px] text-amber-300 font-medium">Aguardando a equipe</p>
                ) : (
                  <p className="text-[11px] text-emerald-300 font-medium">
                    Concluído ✓{a.reply ? ` — ${a.reply}` : ""}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ações */}
        {!post.approved && !pending && (
          <div className="space-y-2 pt-1">
            {!showForm ? (
              <div className="flex gap-2">
                <button
                  onClick={() => act("approve")}
                  disabled={busy !== ""}
                  className="btn-primary flex-1 !py-2.5"
                >
                  <Icon.check className="w-4 h-4" />
                  {busy === "approve" ? "Aprovando..." : "Aprovar postagem"}
                </button>
                <button
                  onClick={() => setShowForm(true)}
                  disabled={busy !== ""}
                  className="btn-ghost flex-1 !py-2.5"
                >
                  <Icon.edit className="w-4 h-4" />
                  Pedir ajuste
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  className="input resize-y min-h-20 text-sm leading-relaxed"
                  placeholder="Descreva o que mudar nesta postagem (mínimo 30 caracteres)…"
                />
                <div className="flex items-center justify-between gap-3">
                  <span className={`text-[11px] ${remaining > 0 ? "text-[var(--color-text-faint)]" : "text-emerald-300"}`}>
                    {remaining > 0 ? `Faltam ${remaining} caracteres` : "Pronto para enviar ✓"}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setShowForm(false); setComment(""); }}
                      className="text-xs text-[var(--color-text-muted)] hover:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => act("adjust")}
                      disabled={busy !== "" || comment.trim().length < MIN_ADJUST}
                      className="btn-primary !py-1.5 !px-3.5 text-xs disabled:opacity-40"
                    >
                      {busy === "adjust" ? "Enviando..." : "Enviar pedido"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {msg && <p className="text-xs text-[var(--color-text-muted)]">{msg}</p>}
      </div>
    </div>
  );
}

export default function WeeklyView({
  token,
  clientName,
  weekLabel,
  posts: initialPosts,
}: {
  token: string;
  clientName: string;
  weekLabel: string;
  posts: Post[];
}) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const done = useMemo(
    () => posts.filter((p) => p.approved || p.adjustments.some((a) => a.status === "pendente")).length,
    [posts]
  );

  function handleChange(updated: Post) {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  return (
    <div className="w-full max-w-xl space-y-4">
      <div className="text-center mb-2">
        <h1 className="text-2xl font-semibold tracking-tight">Postagens da semana</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Olá, {clientName}! Semana de {weekLabel}. Aprove ou peça ajustes em cada postagem —
          cada uma tem um prazo de resposta.
        </p>
        <p className="text-xs text-[var(--color-text-faint)] mt-1.5">
          {done}/{posts.length} respondida(s)
        </p>
      </div>

      {posts.map((p) => (
        <PostCard key={p.id} token={token} post={p} onChange={handleChange} />
      ))}

      {posts.length === 0 && (
        <div className="card p-8 text-center text-sm text-[var(--color-text-muted)]">
          Nenhuma postagem nesta revisão.
        </div>
      )}
    </div>
  );
}
