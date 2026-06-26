"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PlatformChip } from "@/components/ui";
import { Icon } from "@/components/Icons";
import { BRAND } from "@/components/BrandIcons";
import { CaptionFields } from "@/components/CaptionFields";
import { DateTimePicker } from "@/components/DatePickers";
import { FormatPicker } from "@/components/FormatPicker";
import { spLocalInputFromISO, spLocalInputToISO } from "@/lib/format-date";

type Post = {
  id: string;
  clientName: string;
  clientId: string;
  theme: string;
  caption: string;
  captions: Record<string, string>;
  mediaUrl: string;
  format: string;
  scheduledAt: string;
  targets: string[];
  status: string;
};


export default function EditPostForm({
  post,
  availablePlatforms,
}: {
  post: Post;
  availablePlatforms: string[];
}) {
  const router = useRouter();
  const [targets, setTargets] = useState<string[]>(
    post.targets.filter((t) => availablePlatforms.includes(t))
  );
  const [theme, setTheme] = useState(post.theme);
  const [format, setFormat] = useState(post.format || "feed");
  const [captions, setCaptions] = useState<Record<string, string>>(() => {
    if (post.captions && Object.keys(post.captions).length) return post.captions;
    // back-compat: usa a legenda única como base da primeira rede
    if (post.caption && post.targets[0]) return { [post.targets[0]]: post.caption };
    return {};
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const editable =
    post.status === "scheduled" || post.status === "failed" || post.status === "draft";

  function toggle(p: string) {
    setTargets((prev) => (prev.includes(p) ? prev.filter((t) => t !== p) : [...prev, p]));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (targets.length === 0) {
      setError("Selecione ao menos uma rede social.");
      return;
    }
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const captionsForTargets = Object.fromEntries(
      targets.map((t) => [t, captions[t] ?? ""]).filter(([, v]) => v)
    );
    const data = {
      theme,
      format,
      captions: captionsForTargets,
      mediaUrl: form.get("mediaUrl") as string,
      scheduledAt: spLocalInputToISO(form.get("scheduledAt") as string),
      targets,
    };

    const res = await fetch(`/api/posts/${post.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Não foi possível salvar o post.");
      return;
    }
    router.push("/posts");
    router.refresh();
  }

  if (!editable) {
    return (
      <div className="card p-6">
        <p className="text-sm text-[var(--color-text-muted)]">
          Este post está com status <span className="font-medium">{post.status}</span> e não pode
          mais ser editado.
        </p>
        <Link href="/posts" className="btn-ghost mt-4">
          Voltar
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="card p-6 space-y-5">
        <div>
          <label className="label">Cliente</label>
          <div className="input flex items-center !cursor-default text-[var(--color-text-muted)]">
            {post.clientName}
          </div>
        </div>

        <div>
          <label className="label">Redes sociais</label>
          {availablePlatforms.length === 0 ? (
            <p className="text-sm text-amber-300">
              O cliente não tem contas ativas no momento.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availablePlatforms.map((p) => {
                const on = targets.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => toggle(p)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                      on
                        ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-white"
                        : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)]"
                    }`}
                  >
                    <PlatformChip platform={p} />
                    {BRAND[p]?.label ?? p}
                    {on && <Icon.check className="w-4 h-4 text-[var(--color-accent)]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <label className="label">Formato</label>
          <FormatPicker value={format} onChange={setFormat} />
        </div>

        <div>
          <label className="label">Tema</label>
          <input
            name="theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            className="input"
          />
        </div>

        <CaptionFields
          clientId={post.clientId}
          theme={theme}
          targets={targets}
          captions={captions}
          setCaptions={setCaptions}
        />

        <div>
          <label className="label">URL da mídia</label>
          <input name="mediaUrl" type="url" defaultValue={post.mediaUrl} className="input" />
        </div>

        <div>
          <label className="label">Agendar para</label>
          <DateTimePicker
            name="scheduledAt"
            defaultValue={spLocalInputFromISO(post.scheduledAt)}
            required
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <Link href="/posts" className="btn-ghost flex-1">
          Cancelar
        </Link>
        <button type="submit" disabled={saving} className="btn-primary flex-1">
          <Icon.check className="w-4 h-4" />
          {saving ? "Salvando..." : "Salvar alterações"}
        </button>
      </div>
    </form>
  );
}
