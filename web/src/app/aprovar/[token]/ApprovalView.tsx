"use client";

import { useState } from "react";
import { BrandBadge, BRAND } from "@/components/BrandIcons";

const MAX = 5;
const FMT: Record<string, string> = { feed: "Feed", story: "Story", carrossel: "Carrossel", reels: "Reels" };

type Post = {
  id: string;
  theme: string;
  format: string;
  mediaUrl: string | null;
  mediaItems: { url: string; type?: string }[] | null;
  captions: Record<string, string>;
  targets: string[];
  when: string;
  aiEditsUsed: number;
};

function isVid(u: string) {
  return /\.(mp4|mov|webm|m4v)$/i.test(u);
}

function PostCard({ token, post }: { token: string; post: Post }) {
  const [caps, setCaps] = useState<Record<string, string>>(post.captions);
  const [editsUsed, setEditsUsed] = useState(post.aiEditsUsed);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const media = post.mediaItems?.length
    ? post.mediaItems
    : post.mediaUrl
      ? [{ url: post.mediaUrl, type: undefined as string | undefined }]
      : [];

  async function save(net: string) {
    setBusy(net);
    setMsg("");
    const r = await fetch(`/api/aprovar/${token}/post/${post.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "edit", captions: { [net]: caps[net] ?? "" } }),
    });
    setBusy("");
    setMsg(r.ok ? "Salvo ✓" : "Erro ao salvar");
  }

  async function regen(net: string) {
    if (editsUsed >= MAX) return;
    setBusy(`ia-${net}`);
    setMsg("");
    const r = await fetch(`/api/aprovar/${token}/post/${post.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "regenerate" }),
    });
    const d = await r.json().catch(() => null);
    setBusy("");
    if (!r.ok) { setMsg(typeof d?.error === "string" ? d.error : "Erro IA"); return; }
    setCaps(d.captions ?? caps);
    setEditsUsed(d.aiEditsUsed ?? editsUsed + 1);
    setMsg("Nova versão gerada ✓");
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-col sm:flex-row">
        <div className="sm:w-48 shrink-0 bg-black/40 aspect-square sm:aspect-auto flex items-center justify-center">
          {media[0] ? (
            isVid(media[0].url) ? (
              <video src={media[0].url} controls className="w-full h-full object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media[0].url} alt="" className="w-full h-full object-cover" />
            )
          ) : (
            <span className="text-xs text-[var(--color-text-faint)] p-4">sem mídia ainda</span>
          )}
        </div>

        <div className="flex-1 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-medium">{post.theme || "Post"}</p>
              <p className="text-xs text-[var(--color-text-faint)]">
                {FMT[post.format] ?? post.format} · {post.when}
                {media.length > 1 ? ` · ${media.length} mídias` : ""}
              </p>
            </div>
            <span className="text-xs text-[var(--color-text-muted)]">{editsUsed}/{MAX} IA</span>
          </div>

          {post.targets.map((net) => (
            <div key={net}>
              <div className="flex items-center justify-between mb-1">
                <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)]">
                  <BrandBadge platform={net} size={18} /> {BRAND[net]?.label ?? net}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => regen(net)}
                    disabled={busy !== "" || editsUsed >= MAX}
                    className="text-xs text-[var(--color-accent)] hover:underline disabled:opacity-40"
                  >
                    {busy === `ia-${net}` ? "Gerando..." : "Gerar IA"}
                  </button>
                  <button
                    onClick={() => save(net)}
                    disabled={busy !== ""}
                    className="text-xs text-[var(--color-text-muted)] hover:text-white disabled:opacity-40"
                  >
                    {busy === net ? "..." : "Salvar"}
                  </button>
                </div>
              </div>
              <textarea
                value={caps[net] ?? ""}
                onChange={(e) => setCaps((p) => ({ ...p, [net]: e.target.value }))}
                rows={3}
                className="input resize-none text-sm"
              />
            </div>
          ))}
          {msg && <p className="text-xs text-[var(--color-text-muted)]">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

export default function ApprovalView({
  token,
  clientName,
  monthLabel,
  posts,
}: {
  token: string;
  clientName: string;
  monthLabel: string;
  posts: Post[];
}) {
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

  return (
    <div className="w-full max-w-3xl space-y-4">
      <div className="text-center mb-2">
        <h1 className="text-2xl font-semibold tracking-tight">Cronograma de {monthLabel}</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Olá, {clientName}! Revise os {posts.length} posts, ajuste o que quiser e aprove.
        </p>
      </div>

      {posts.map((p) => (
        <PostCard key={p.id} token={token} post={p} />
      ))}

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
    </div>
  );
}
