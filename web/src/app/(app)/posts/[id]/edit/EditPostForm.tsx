"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PlatformChip, StatusBadge } from "@/components/ui";
import { Button, buttonClasses } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { Field, Input, Select, Textarea } from "@/components/Field";
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
import { POST_STATUS, labelOf } from "@/lib/status-meta";
import { PUBLISH_BLOCKED } from "@/lib/publish-policy";

type Post = {
  id: string;
  clientName: string;
  clientId: string;
  /** false = cliente só produção: o post nunca entra na fila */
  agencyPublishes: boolean;
  theme: string;
  caption: string;
  captions: Record<string, string>;
  mediaUrl: string;
  format: string;
  scheduledAt: string;
  targets: string[];
  status: string;
  slides: string[];
  /** "" = sem redatora */
  writerId: string;
  internalNote: string;
};

type Writer = { id: string; name: string };

/** Mesmo limite do PATCH /api/posts/[id]. */
const INTERNAL_NOTE_MAX = 2000;

/** Redes padrão de cliente só produção — a mesma regra do Novo post. */
const PRODUCTION_ONLY_TARGETS = ["instagram", "facebook"];

const PLATFORM_ORDER = ["instagram", "facebook", "linkedin"];

/**
 * Redes oferecidas. Cliente que publica: as das contas ativas. Só produção não
 * depende de conta (RC Risco 8): Instagram + Facebook + contas + as do próprio post.
 */
function offeredPlatforms(post: Post, accountPlatforms: string[]): string[] {
  if (post.agencyPublishes) return accountPlatforms;
  const all = new Set([...PRODUCTION_ONLY_TARGETS, ...accountPlatforms, ...post.targets]);
  return [...PLATFORM_ORDER.filter((p) => all.has(p)), ...[...all].filter((p) => !PLATFORM_ORDER.includes(p))];
}

/** Por que um post fora de rascunho/agendado/falhou não pode ser editado (A-045: rótulo em pt-BR). */
function lockedText(status: string): string {
  if (status === "published") return "Este post já foi publicado e não pode mais ser editado.";
  if (status === "publishing") return "Este post está sendo publicado agora e não pode ser editado.";
  return `Este post está como “${labelOf(POST_STATUS, status)}” e não pode ser editado.`;
}

export default function EditPostForm({
  post,
  accountPlatforms,
  writers,
}: {
  post: Post;
  /** redes das contas ativas do cliente */
  accountPlatforms: string[];
  /** usuárias para o campo "Redatora" (só id e nome) */
  writers: Writer[];
}) {
  const router = useRouter();
  const ids = useId();
  const availablePlatforms = offeredPlatforms(post, accountPlatforms);
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
  const [writerId, setWriterId] = useState(post.writerId);
  const [internalNote, setInternalNote] = useState(post.internalNote);
  const [error, setError] = useState<string | null>(null);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editable =
    post.status === "scheduled" || post.status === "failed" || post.status === "draft";
  const productionOnly = !post.agencyPublishes;
  const hasSlides = format === "carrossel" || format === "reels";

  function toggle(p: string) {
    setTargetsError(null);
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
    if (saving) return;
    setError(null);
    if (targets.length === 0) {
      setTargetsError("Selecione ao menos uma rede social.");
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
      writerId: writerId || null,
      internalNote,
    };

    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        // N-14: só mostra `error` do servidor quando é texto (o 400 do zod é objeto)
        setError(
          typeof d?.error === "string"
            ? d.error
            : d?.code === PUBLISH_BLOCKED.code
              ? PUBLISH_BLOCKED.message
              : "Não foi possível salvar o post. Confira os campos e tente de novo."
        );
        return;
      }
      router.push("/posts");
      router.refresh();
    } catch {
      setError("Falha de conexão ao salvar. Verifique a internet e tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  if (!editable) {
    return (
      <div className="card grid gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-fg-muted">Status</span>
          <StatusBadge status={post.status} size="md" />
        </div>
        <p className="text-sm text-fg">{lockedText(post.status)}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href={`/posts/${post.id}`} className={buttonClasses({ variant: "primary" })}>
            Ver o post
          </Link>
          <Link href="/posts" className={buttonClasses({ variant: "secondary" })}>
            Voltar para Posts
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-5">
      <form onSubmit={handleSubmit} noValidate className="grid gap-6 xl:col-span-3">
        {productionOnly && (
          <Callout tone="info">
            Este cliente é só produção: o post é salvo como rascunho e nunca entra na fila.
          </Callout>
        )}
        {!productionOnly && post.status === "failed" && (
          <Callout tone="warning" title="Este post falhou ao publicar">
            Salvar as alterações não o coloca de volta na fila. Depois de corrigir, use “Reenviar” na página do post.
          </Callout>
        )}

        <section aria-labelledby={`${ids}-conteudo`} className="card grid gap-5 p-4 sm:p-6">
          <h2 id={`${ids}-conteudo`} className="sr-only">
            Conteúdo do post
          </h2>

          <Field label="Cliente">
            <Input value={post.clientName} readOnly />
          </Field>

          <Field
            kind="group"
            label="Redes sociais"
            help={productionOnly ? "Onde o post vai sair (a agência não publica)." : undefined}
            error={targetsError}
          >
            {availablePlatforms.length === 0 ? (
              <Callout tone="warning">
                O cliente não tem contas ativas no momento.{" "}
                <Link href={`/clients/${post.clientId}/accounts/new`}>Adicionar uma conta</Link>.
              </Callout>
            ) : (
              <div className="flex flex-wrap gap-2">
                {availablePlatforms.map((p) => {
                  const on = targets.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(p)}
                      className={`inline-flex min-h-11 items-center gap-2 rounded-control border px-4 text-sm font-medium transition-colors duration-(--sf-dur-fast) sm:min-h-10 ${
                        on
                          ? "border-link bg-hover text-fg"
                          : "border-line-strong bg-surface text-fg-muted hover:bg-hover hover:text-fg"
                      }`}
                    >
                      <PlatformChip platform={p} />
                      {BRAND[p]?.label ?? p}
                      {on && <Icon.check className="size-4 text-link" />}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>

          <Field kind="group" label="Tipo de postagem">
            <FormatPicker value={format} onChange={setFormat} />
          </Field>

          <Field label="Título da postagem">
            <Input
              name="theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              placeholder="Ex.: Lançamento do produto X"
            />
          </Field>

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

          <Field
            label={productionOnly ? "Data prevista" : "Agendar para"}
            required
            help={productionOnly ? "Organiza a produção. O post não é agendado nem publicado." : undefined}
          >
            <DateTimePicker
              name="scheduledAt"
              defaultValue={spLocalInputFromISO(post.scheduledAt)}
              onChange={setScheduledLocal}
              required
            />
          </Field>
        </section>

        {/* dados da equipe: só nas telas internas, nunca nos links públicos */}
        <section aria-labelledby={`${ids}-equipe`} className="card grid gap-5 p-4 sm:p-6">
          <div>
            <h2 id={`${ids}-equipe`} className="text-base font-semibold text-fg">
              Equipe
            </h2>
            <p className="mt-0.5 text-sm text-fg-muted">Só a equipe vê. Nada daqui aparece no link do cliente.</p>
          </div>

          <Field label="Redatora" optional>
            <Select value={writerId} onChange={(e) => setWriterId(e.target.value)}>
              <option value="">Sem redatora</option>
              {writers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Nota interna"
            optional
            help="Recado para a equipe sobre este post (ex.: “não fazer capa”, “aguardando foto do cliente”)."
          >
            <Textarea
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              maxLength={INTERNAL_NOTE_MAX}
              showCount
              rows={3}
            />
          </Field>
        </section>

        {error && (
          <Callout tone="danger" live="assertive">
            {error}
          </Callout>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Link href="/posts" className={buttonClasses({ variant: "secondary" })}>
            Cancelar
          </Link>
          <Button
            type="submit"
            variant="primary"
            leadingIcon={<Icon.check />}
            loading={saving}
            loadingText="Salvando…"
          >
            Salvar alterações
          </Button>
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
