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
import { SlidesEditor } from "@/components/SlidesEditor";
import { AssistantPanel } from "@/components/AssistantPanel";
import { MediaField } from "@/components/MediaField";
import { PostPreview } from "@/components/PostPreview";
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
  slides: string[];
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
  const [slides, setSlides] = useState<string[]>(post.slides);
  const [mediaUrl, setMediaUrl] = useState(post.mediaUrl);
  const [scheduledLocal, setScheduledLocal] = useState(() =>
    spLocalInputFromISO(post.scheduledAt)
  );
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
  const hasSlides = format === "carrossel" || format === "reels";

  function toggle(p: string) {
    setTargets((prev) => (prev.includes(p) ? prev.filter((t) => t !== p) : [...prev, p]));
  }

  // o assistente aplica a legenda única FB+IG (LinkedIn segue espelhando se não editado)
  function applyAssistantCaption(text: string) {
    setCaptions((prev) => {
      const liMirrored =
        !prev.linkedin || prev.linkedin === (prev.instagram ?? prev.facebook ?? "");
      return {
        ...prev,
        instagram: text,
        facebook: text,
        ...(liMirrored ? { linkedin: text } : {}),
      };
    });
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
      scheduledAt: spLocalInputToISO(scheduledLocal),
      targets,
      slides: hasSlides ? slides.filter((s) => s.trim()).map((text) => ({ text })) : [],
    };

    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setError(
          typeof d?.error === "string" ? d.error : "Não foi possível salvar o post."
        );
        return;
      }
      router.push("/posts");
      router.refresh();
    } catch {
      setError("Falha de conexão ao salvar. Tente novamente.");
    } finally {
      setSaving(false);
    }
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
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
      <form onSubmit={handleSubmit} className="space-y-6 xl:col-span-3">
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
            <label className="label">Tipo de postagem</label>
            <FormatPicker value={format} onChange={setFormat} />
          </div>

          <div>
            <label className="label">Título da postagem</label>
            <input
              name="theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="input"
            />
          </div>

          {hasSlides && (
            <SlidesEditor format={format} slides={slides} onChange={setSlides} />
          )}

          <CaptionFields
            clientId={post.clientId}
            theme={theme}
            targets={targets}
            captions={captions}
            setCaptions={setCaptions}
          />

          <div>
            <MediaField value={mediaUrl} onChange={setMediaUrl} clientId={post.clientId} />
            {/* o submit continua lendo o FormData, então o valor vai num hidden */}
            <input type="hidden" name="mediaUrl" value={mediaUrl} />
          </div>

          {(mediaUrl || captions.instagram || captions.facebook) && (
            <PostPreview
              mediaUrl={mediaUrl}
              caption={captions.instagram ?? captions.facebook ?? ""}
              clientName={post.clientName}
              targets={targets}
              format={format}
            />
          )}

          <div>
            <label className="label">Agendar para</label>
            <DateTimePicker
              name="scheduledAt"
              defaultValue={spLocalInputFromISO(post.scheduledAt)}
              onChange={setScheduledLocal}
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

      <AssistantPanel
        className="xl:col-span-2 xl:sticky xl:top-6"
        clientId={post.clientId}
        getPost={() => ({
          theme,
          format,
          targets,
          caption: captions.instagram ?? captions.facebook ?? captions.linkedin ?? "",
          scheduledAt: scheduledLocal,
          slides: slides.filter((s) => s.trim()),
        })}
        onApplyCaption={applyAssistantCaption}
        onApplyTitle={setTheme}
      />
    </div>
  );
}
