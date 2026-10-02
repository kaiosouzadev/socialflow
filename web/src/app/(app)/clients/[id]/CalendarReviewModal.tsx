"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AssistantPanel } from "@/components/AssistantPanel";
import { BrandBadge, BRAND } from "@/components/BrandIcons";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { DateTimePicker } from "@/components/DatePickers";
import { ConfirmDialog, Dialog } from "@/components/Dialog";
import { Field, Input, Select, Textarea } from "@/components/Field";
import { Icon } from "@/components/Icons";
import { MediaField } from "@/components/MediaField";
import { SlidesEditor } from "@/components/SlidesEditor";
import { FormatBadge, ToneBadge } from "@/components/ui";
import { buildMonthFileNames, canonicalMonthFolderName, parseMonthKey, type MonthFileName } from "@/lib/drive-layout";
import { FORMAT_OPTIONS } from "@/lib/formats";
import { formatMonthLabel, spLocalInputFromISO, spLocalInputToISO } from "@/lib/format-date";
import { toUserMessage } from "@/lib/user-facing-error";

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

/** Post já salvo do cliente: entra na numeração das artes do mês, como no sync. */
type SavedPost = { id: string; format: string; at: number };

/** O commit gravou, mas o Drive falhou: a equipe precisa ver o aviso antes de sair. */
type Saved = { created: number; duplicates: number; driveWarning: string };

const STORY_DELAY_MS = 15 * 60_000;
const SAVE_ERROR = "Não foi possível salvar o cronograma. Tente de novo em instantes.";
const CONNECTION_ERROR = "Falha de conexão ao salvar. Verifique a internet e tente de novo.";

let uidSeq = 0;

const pad2 = (n: number) => String(n).padStart(2, "0");
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Instante (ms) de um "YYYY-MM-DDTHH:MM" lido como horário de São Paulo; null se inválido. */
function spLocalToMs(local: string): number | null {
  try {
    const ms = Date.parse(spLocalInputToISO(local));
    return Number.isNaN(ms) ? null : ms;
  } catch {
    return null;
  }
}

/** Mês civil de SP ("2026-11") de um instante. */
const spMonthOf = (ms: number) => spLocalInputFromISO(new Date(ms)).slice(0, 7);

/** "2026-11" → "2026/11 - Novembro" (pasta do mês dentro da pasta do cliente). */
function monthFolderPath(monthKey: string): string | null {
  try {
    const { year, month } = parseMonthKey(monthKey);
    return `${year}/${canonicalMonthFolderName(month)}`;
  } catch {
    return null;
  }
}

/** Nome da arte do post no Drive, por formato (docs/08-DRIVE-ESTRUTURA.md): story "Nstory.jpg", "Nstory2.jpg"… */
function artName(format: string, name: MonthFileName): string {
  const n = name.index;
  if (format === "story") return `${name.fileStem}.jpg`;
  if (format === "carrossel") return `${n}/ (pasta com os slides)`;
  if (format === "reels") return `${n}.mp4`;
  return `${n}.jpg`;
}

/**
 * Caminho das artes de cada post da revisão, com os mesmos nomes do sync
 * (`buildMonthFileNames`): todos os posts do cliente no mês, em ordem de data,
 * com o story junto 15 min depois do post. Posts já salvos com o mesmo
 * horário e formato contam uma vez só (o commit não os duplica).
 */
function artPaths(posts: ReviewPost[], saved: SavedPost[]) {
  type Entry = { id: string; format: string; at: number; rank: number };
  const fresh: Entry[] = [];
  posts.forEach((p, i) => {
    const at = spLocalToMs(p.scheduledLocal);
    if (at === null) return;
    fresh.push({ id: p.uid, format: p.format, at, rank: 1 + i * 2 });
    if (p.withStory && p.format !== "story") {
      fresh.push({ id: `${p.uid}:story`, format: "story", at: at + STORY_DELAY_MS, rank: 2 + i * 2 });
    }
  });
  const taken = new Set(fresh.map((e) => `${e.at}:${e.format}`));
  const entries = [
    ...saved.filter((s) => !taken.has(`${s.at}:${s.format}`)).map((s) => ({ ...s, rank: 0 })),
    ...fresh,
  ].sort((a, b) => a.at - b.at || a.rank - b.rank);

  const byMonth = new Map<string, Entry[]>();
  for (const e of entries) {
    const key = spMonthOf(e.at);
    byMonth.set(key, [...(byMonth.get(key) ?? []), e]);
  }
  const paths = new Map<string, string>();
  for (const [key, list] of byMonth) {
    const folder = monthFolderPath(key);
    if (!folder) continue;
    const names = buildMonthFileNames(list);
    for (const e of list) {
      const name = names.get(e.id);
      if (name) paths.set(e.id, `${folder}/${artName(e.format, name)}`);
    }
  }
  return paths;
}

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
  /** descartar a revisão (nada foi salvo) */
  onClose: () => void;
  /** o cronograma foi salvo; `openCalendar` = ir para o calendário do mês */
  onCommitted: (opts: { openCalendar: boolean }) => void;
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
  // alguma edição feita pela equipe (muda o texto da confirmação de descarte)
  const [edited, setEdited] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [savedPosts, setSavedPosts] = useState<SavedPost[]>([]);
  const calendarButtonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  // posts que o cliente já tem: a numeração das artes (N.jpg, Nstory.jpg) conta todos
  // os posts do mês. Sem eles (falha de rede), numera só os desta revisão.
  useEffect(() => {
    let alive = true;
    fetch(`/api/posts?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        if (!alive || !Array.isArray(data)) return;
        const list: SavedPost[] = [];
        for (const p of data as { id?: unknown; format?: unknown; scheduledAt?: unknown }[]) {
          const at = typeof p.scheduledAt === "string" ? Date.parse(p.scheduledAt) : NaN;
          if (typeof p.id === "string" && typeof p.format === "string" && !Number.isNaN(at)) {
            list.push({ id: p.id, format: p.format, at });
          }
        }
        setSavedPosts(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [clientId]);

  // salvo com aviso do Drive: o foco vai para a próxima ação
  useEffect(() => {
    if (saved) calendarButtonRef.current?.focus();
  }, [saved]);

  const platforms = availablePlatforms.length ? availablePlatforms : ["instagram", "facebook"];
  const withArt = posts.filter((p) => p.mediaUrl.trim()).length;
  const monthLabel = formatMonthLabel(month);
  const paths = useMemo(() => artPaths(posts, savedPosts), [posts, savedPosts]);

  /** Pedido de fechar (Esc, X, fundo, Cancelar): nunca descarta posts gerados sem confirmar. */
  function requestClose() {
    if (busy) return;
    if (saved) {
      onCommitted({ openCalendar: false });
      return;
    }
    if (posts.length === 0) {
      onClose();
      return;
    }
    setConfirmingDiscard(true);
  }

  function update(uid: string, patch: Partial<ReviewPost>) {
    setEdited(true);
    setPosts((prev) => prev.map((p) => (p.uid === uid ? { ...p, ...patch } : p)));
  }
  // legenda única FB+IG (LinkedIn espelha até ser editado)
  function updateShared(uid: string, text: string) {
    setEdited(true);
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
    setEdited(true);
    setLiDirty((d) => ({ ...d, [uid]: true }));
    setPosts((prev) =>
      prev.map((p) => (p.uid === uid ? { ...p, captions: { ...p.captions, linkedin: text } } : p))
    );
  }
  function toggleTarget(uid: string, platform: string) {
    setEdited(true);
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
          setError(toUserMessage(data, "Não foi possível refazer a postagem agora. Tente de novo em instantes."));
          return;
        }
        const g: Record<string, string> = data?.captions ?? {};
        const shared = g.instagram ?? g.facebook ?? "";
        setLiDirty((d) => ({ ...d, [uid]: !!g.linkedin && g.linkedin !== shared }));
        update(uid, {
          captions: { instagram: shared, facebook: shared, linkedin: g.linkedin ?? shared },
          ...(Array.isArray(data?.slides) && data.slides.length ? { slides: data.slides } : {}),
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
        setError(toUserMessage(data, "Não foi possível gerar uma nova ideia agora. Tente de novo em instantes."));
        return;
      }
      update(uid, {
        theme: typeof data?.theme === "string" ? data.theme : post.theme,
        format: typeof data?.format === "string" ? data.format : post.format,
        explanation: typeof data?.explanation === "string" ? data.explanation : "",
        captions: {},
        slides: [],
        mediaUrl: "",
      });
    } catch {
      setError("Falha de conexão com a IA. Verifique a internet e tente de novo.");
    } finally {
      setRegenerating((r) => ({ ...r, [uid]: false }));
    }
  }

  function removePost(uid: string) {
    setEdited(true);
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
    setEdited(true);
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
              ...(slides.length && (p.format === "carrossel" || p.format === "reels") ? { slides } : {}),
            },
          ];
          if (p.withStory && p.format !== "story") {
            const storyIso = new Date(new Date(baseIso).getTime() + STORY_DELAY_MS).toISOString();
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
        setError(toUserMessage(data, SAVE_ERROR));
        return;
      }
      // Drive falhou (S16): o cronograma está salvo, mas a pasta do mês não foi preparada
      const warning = typeof data?.driveWarning === "string" ? data.driveWarning.trim() : "";
      if (warning) {
        setSaved({
          created: typeof data?.created === "number" ? data.created : 0,
          duplicates: typeof data?.duplicates === "number" ? data.duplicates : 0,
          driveWarning: warning,
        });
        return;
      }
      onCommitted({ openCalendar: true });
    } catch {
      setError(CONNECTION_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const assistantPost = assistantUid ? posts.find((p) => p.uid === assistantUid) : undefined;

  if (saved) {
    return (
      <Dialog
        open
        onClose={requestClose}
        size="md"
        title="Cronograma salvo"
        description={`${clientName} · ${monthLabel}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => onCommitted({ openCalendar: false })}>
              Fechar
            </Button>
            <Button ref={calendarButtonRef} variant="primary" onClick={() => onCommitted({ openCalendar: true })}>
              Ver no calendário
            </Button>
          </>
        }
      >
        <div className="grid gap-3 pb-2">
          <Callout tone="success">
            {saved.created} {plural(saved.created, "post salvo", "posts salvos")} como rascunho.
            {saved.duplicates > 0 &&
              ` ${saved.duplicates} já ${plural(saved.duplicates, "estava salvo e não foi duplicado", "estavam salvos e não foram duplicados")}.`}
          </Callout>
          <Callout tone="warning" title="Pastas do Google Drive não preparadas" live="polite">
            {saved.driveWarning}
          </Callout>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={requestClose}
      size="lg"
      busy={busy}
      error={error}
      title="Revisar cronograma"
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            {clientName} · {monthLabel} · {posts.length} {plural(posts.length, "post", "posts")}
          </span>
          <ToneBadge tone={withArt === posts.length && posts.length > 0 ? "success" : "warning"}>
            {withArt}/{posts.length} com arte
          </ToneBadge>
        </span>
      }
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={requestClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            leadingIcon={<Icon.check />}
            loading={busy}
            loadingText="Salvando…"
            disabled={posts.length === 0}
            onClick={approve}
          >
            Aprovar e salvar ({posts.length})
          </Button>
        </>
      }
    >
      <div className="grid gap-3 pb-3">
        <Callout tone="info">
          O cliente aprova <strong>título + explicação</strong> de cada postagem. Ajuste o que precisar e salve:
          legendas e slides completos são gerados depois que o cronograma for aprovado. As artes no Drive seguem a
          ordem das datas de todos os posts do mês.
        </Callout>

        {posts.length === 0 && (
          <p className="py-8 text-center text-sm text-fg-muted">
            Nenhuma postagem. Adicione uma abaixo ou cancele e gere de novo.
          </p>
        )}

        <ol id={listId} aria-label="Postagens do cronograma" className="grid gap-3">
          {posts.map((p, i) => {
            const hasArt = !!p.mediaUrl.trim();
            const open = !!expanded[p.uid];
            const number = String(i + 1).padStart(2, "0");
            const titleLabel = p.theme.trim() || `postagem ${number}`;
            const artPath = paths.get(p.uid);
            const storyPath = paths.get(`${p.uid}:story`);
            const captionsId = `${listId}-${p.uid}-legendas`;
            const storyHelpId = `${listId}-${p.uid}-story`;
            return (
              <li key={p.uid} className="grid gap-3 rounded-card border border-line bg-surface p-3 sm:p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-fg-muted">
                    <span className="sr-only">Postagem </span>
                    {number}
                  </span>
                  <FormatBadge format={p.format} />
                  <ToneBadge tone={hasArt ? "success" : "warning"}>{hasArt ? "Com arte" : "Sem arte"}</ToneBadge>
                  <div className="ml-auto flex flex-wrap gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      leadingIcon={<Icon.refresh />}
                      loading={!!regenerating[p.uid]}
                      loadingText="Gerando…"
                      disabled={busy}
                      title="Substituir por um novo post gerado pela IA"
                      onClick={() => substitute(p.uid)}
                    >
                      Substituir
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      leadingIcon={<Icon.zap />}
                      disabled={busy}
                      title="Abrir o assistente de IA para este post"
                      aria-expanded={assistantUid === p.uid}
                      onClick={() => setAssistantUid(p.uid)}
                    >
                      Assistente
                    </Button>
                    <Button
                      iconOnly
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      aria-label={`Excluir ${titleLabel}`}
                      title="Remover este post do cronograma"
                      onClick={() => removePost(p.uid)}
                    >
                      <Icon.trash />
                    </Button>
                  </div>
                </div>

                <Field label="Título da postagem">
                  <Input
                    value={p.theme}
                    onChange={(e) => update(p.uid, { theme: e.target.value })}
                    placeholder="Ex.: 3 dicas para começar o mês"
                    className="font-medium"
                  />
                </Field>

                <Field label="Explicação para o cliente" help="Aparece no link de aprovação.">
                  <Textarea
                    value={p.explanation}
                    onChange={(e) => update(p.uid, { explanation: e.target.value })}
                    rows={2}
                    placeholder="Breve explicação do tema…"
                  />
                </Field>

                <div className="grid items-start gap-3 sm:grid-cols-2">
                  <Field label="Data da postagem">
                    <DateTimePicker
                      defaultValue={p.scheduledLocal}
                      onChange={(v) => update(p.uid, { scheduledLocal: v })}
                    />
                  </Field>
                  <div className="grid content-start gap-2">
                    <Field label="Tipo de postagem">
                      <Select
                        value={p.format}
                        onChange={(e) =>
                          update(p.uid, {
                            format: e.target.value,
                            ...(e.target.value === "story" ? { withStory: false } : {}),
                          })
                        }
                      >
                        {FORMAT_OPTIONS.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {p.format !== "story" && (
                      <div>
                        <label className="flex min-h-10 cursor-pointer select-none items-center gap-2 text-sm text-fg sm:min-h-8">
                          <input
                            type="checkbox"
                            checked={p.withStory}
                            onChange={(e) => update(p.uid, { withStory: e.target.checked })}
                            aria-describedby={p.withStory && storyPath ? storyHelpId : undefined}
                            className="size-4 shrink-0 accent-primary"
                          />
                          Story junto (sai 15 min depois)
                        </label>
                        {p.withStory && storyPath && (
                          <p id={storyHelpId} className="text-xs text-fg-muted">
                            Arte do story no Drive: <span className="font-mono">{storyPath}</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <Field
                  label="Arte (URL da mídia)"
                  help={
                    artPath ? (
                      <>
                        No Drive: <span className="font-mono">{artPath}</span>
                      </>
                    ) : undefined
                  }
                >
                  <MediaField
                    value={p.mediaUrl}
                    onChange={(url) => update(p.uid, { mediaUrl: url })}
                    clientId={clientId}
                    compact
                  />
                </Field>

                <div className="flex flex-wrap items-center gap-2">
                  <div role="group" aria-label={`Redes de ${titleLabel}`} className="flex flex-wrap gap-2">
                    {platforms.map((pl) => {
                      const on = p.targets.includes(pl);
                      return (
                        <button
                          key={pl}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleTarget(p.uid, pl)}
                          className={`inline-flex min-h-10 items-center gap-1.5 rounded-control border pl-1.5 pr-3 text-sm font-medium transition-colors duration-(--sf-dur-fast) sm:min-h-8 ${
                            on
                              ? "border-selected bg-selected text-on-selected"
                              : "border-line-strong bg-surface text-fg-muted hover:bg-hover hover:text-fg"
                          }`}
                        >
                          <BrandBadge platform={pl} size={20} />
                          {BRAND[pl]?.label ?? pl}
                        </button>
                      );
                    })}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    aria-expanded={open}
                    aria-controls={open ? captionsId : undefined}
                    onClick={() => setExpanded((e) => ({ ...e, [p.uid]: !open }))}
                  >
                    {open ? "Ocultar legendas" : "Editar legendas"}
                  </Button>
                </div>

                {open && (
                  <div id={captionsId} className="grid gap-3">
                    {(p.format === "carrossel" || p.format === "reels") && (
                      <SlidesEditor format={p.format} slides={p.slides} onChange={(slides) => update(p.uid, { slides })} />
                    )}
                    {p.targets.length === 0 && (
                      <p className="text-sm text-warning-fg">Selecione uma rede para editar a legenda.</p>
                    )}
                    {(p.targets.includes("instagram") || p.targets.includes("facebook")) && (
                      <Field
                        label={
                          <span className="inline-flex items-center gap-1.5">
                            <span aria-hidden="true" className="inline-flex items-center gap-1">
                              <BrandBadge platform="facebook" size={16} />
                              <BrandBadge platform="instagram" size={16} />
                            </span>
                            Facebook + Instagram (legenda única)
                          </span>
                        }
                      >
                        <Textarea
                          value={p.captions.instagram ?? p.captions.facebook ?? ""}
                          onChange={(e) => updateShared(p.uid, e.target.value)}
                          rows={7}
                          className="leading-relaxed"
                          placeholder="Legenda para Facebook e Instagram"
                        />
                      </Field>
                    )}
                    {p.targets.includes("linkedin") && (
                      <Field
                        label={
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span aria-hidden="true" className="inline-flex">
                              <BrandBadge platform="linkedin" size={16} />
                            </span>
                            LinkedIn
                            {!liDirty[p.uid] && <span className="font-normal text-fg-muted">· espelhando FB+IG</span>}
                          </span>
                        }
                      >
                        <Textarea
                          value={p.captions.linkedin ?? p.captions.instagram ?? p.captions.facebook ?? ""}
                          onChange={(e) => updateLinkedin(p.uid, e.target.value)}
                          rows={5}
                          className="leading-relaxed"
                          placeholder="Legenda para LinkedIn (por padrão igual à de FB+IG)"
                        />
                      </Field>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {/* nova postagem manual no cronograma */}
        <Button fullWidth leadingIcon={<Icon.plus />} disabled={busy} onClick={addPost} className="border-dashed">
          Adicionar postagem
        </Button>
      </div>

      {/* assistente de IA do post escolhido: painel lateral dentro do diálogo (Esc fecha só ele) */}
      {assistantPost && (
        <div className="pointer-events-none fixed inset-y-0 right-0 z-10 flex w-full max-w-md flex-col justify-center p-4">
          <AssistantPanel
            key={assistantPost.uid}
            className="pointer-events-auto max-h-full shadow-raised"
            clientId={clientId}
            subtitle={assistantPost.theme.trim() || "Post sem título"}
            onClose={() => setAssistantUid(null)}
            getPost={() => {
              const p = posts.find((x) => x.uid === assistantPost.uid);
              return {
                theme: p?.theme,
                format: p?.format,
                targets: p?.targets,
                caption: p?.captions.instagram ?? p?.captions.facebook ?? "",
                scheduledAt: p?.scheduledLocal,
                slides: p?.slides.filter((s) => s.trim()),
              };
            }}
            onApplyCaption={(text) => updateShared(assistantPost.uid, text)}
            onApplyTitle={(title) => update(assistantPost.uid, { theme: title })}
          />
        </div>
      )}

      <ConfirmDialog
        open={confirmingDiscard}
        tone="danger"
        title={edited ? "Descartar o cronograma e as suas edições?" : "Descartar o cronograma gerado?"}
        consequences={[
          `${posts.length} ${plural(posts.length, "postagem não é salva", "postagens não são salvas")}${edited ? ", com as edições feitas aqui" : ""}.`,
          "Para ter o cronograma de novo, será preciso gerar outra vez com a IA.",
        ]}
        cancelLabel="Continuar revisando"
        confirmLabel="Descartar cronograma"
        onCancel={() => setConfirmingDiscard(false)}
        onConfirm={() => {
          setConfirmingDiscard(false);
          onClose();
        }}
      />
    </Dialog>
  );
}
