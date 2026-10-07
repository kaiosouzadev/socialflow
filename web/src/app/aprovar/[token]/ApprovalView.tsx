"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Avatar } from "@/components/Avatar";
import { BrandBadge, BRAND } from "@/components/BrandIcons";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { ConfirmDialog, Dialog } from "@/components/Dialog";
import { Field, Textarea } from "@/components/Field";
import { Icon } from "@/components/Icons";
import { SegmentedControl } from "@/components/Toggle";
import { FormatBadge } from "@/components/ui";
import { formatLabel, formatMeta, type PostFormat } from "@/lib/formats";
import type { InstagramProfilePreview } from "@/lib/ig-profile";
import type { MonthlyAdjustment, MonthlyApprovalPost } from "@/lib/monthly-approval";
import InstagramFeedPreview, { type PlannedFeedTile } from "./InstagramFeedPreview";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const WEEKDAYS_LONG = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];
const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
// pedido de ajuste formal precisa dizer O QUE mudar
const MIN_ADJUST = 30;

/** Cada formato tem cor própria (tokens format-*, DESIGN a.6): é o que diferencia
 *  os cards quando ainda não existe arte. Classes estáticas para o Tailwind. */
const FORMAT_CLASS: Record<PostFormat, { stripe: string; wash: string; icon: string; text: string }> = {
  feed: { stripe: "bg-format-feed", wash: "bg-format-feed-bg", icon: "text-format-feed", text: "text-format-feed-fg" },
  carrossel: {
    stripe: "bg-format-carrossel",
    wash: "bg-format-carrossel-bg",
    icon: "text-format-carrossel",
    text: "text-format-carrossel-fg",
  },
  reels: { stripe: "bg-format-reels", wash: "bg-format-reels-bg", icon: "text-format-reels", text: "text-format-reels-fg" },
  story: { stripe: "bg-format-story", wash: "bg-format-story-bg", icon: "text-format-story", text: "text-format-story-fg" },
};
const fmtClass = (f: string) => FORMAT_CLASS[formatMeta(f).id];

type Adjustment = MonthlyAdjustment;

/** Fase cronograma: o cliente vê tema, explicação, data/hora, formato, redes e arte —
 *  sem legenda e sem slides (a legenda é revisada no link semanal; lib/monthly-approval). */
type Post = MonthlyApprovalPost;

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
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pad2 = (n: number) => String(n).padStart(2, "0");

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

const MOBILE_QUERY = "(max-width: 639.98px)";

function subscribeMobile(cb: () => void) {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const isMobileNow = () => window.matchMedia(MOBILE_QUERY).matches;
const notMobileOnServer = () => false;

/** Abaixo de `sm` (folha inferior): o modal do post ganha o rodapé "Fechar". */
function useIsMobile() {
  return useSyncExternalStore(subscribeMobile, isMobileNow, notMobileOnServer);
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

/** "Instagram e Facebook" (texto para leitor de tela; os selos são decorativos). */
function networksText(targets: string[]): string {
  const names = targets.map((t) => BRAND[t]?.label ?? t);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}` : (names[0] ?? "");
}

function Networks({ targets, size }: { targets: string[]; size: number }) {
  if (targets.length === 0) return null;
  return (
    <>
      <span aria-hidden="true" className="flex items-center gap-1">
        {targets.map((t) => (
          <BrandBadge key={t} platform={t} size={size} />
        ))}
      </span>
      <span className="sr-only">{networksText(targets)}</span>
    </>
  );
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

/** Placeholder por formato — substitui o retângulo preto "sem mídia". */
function FormatPlaceholder({ format, compact = false }: { format: string; compact?: boolean }) {
  const c = fmtClass(format);
  return (
    <div aria-hidden="true" className={`flex size-full flex-col items-center justify-center gap-1 ${c.wash}`}>
      <span className={`inline-flex ${compact ? "size-4" : "size-5"} [&>svg]:size-full ${c.icon}`}>
        <Icon.calendar />
      </span>
      {!compact && <span className={`text-xs font-semibold ${c.text}`}>{formatLabel(format)}</span>}
    </div>
  );
}

/* --------------------------- modal de detalhe --------------------------- */

/** Sem "editar a legenda": no link mensal o cliente não vê legenda (revisa no link semanal). */
type Choice = "adjust" | "note";

/** Escolha do modal do post (DESIGN h.1): título + efeito sobre a aprovação, ≥ 14 px. */
function ChoiceButton({
  icon,
  title,
  effect,
  expanded,
  controls,
  onToggle,
}: {
  icon: React.ReactNode;
  title: string;
  effect: string;
  expanded: boolean;
  controls: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      className={`flex min-h-16 w-full items-start gap-3 rounded-card border bg-surface p-4 text-left transition-colors duration-(--sf-dur-fast) hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
        expanded ? "border-selected" : "border-line-strong"
      }`}
    >
      <span aria-hidden="true" className="mt-0.5 inline-flex size-5 shrink-0 text-fg-muted [&>svg]:size-full">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-base font-semibold text-fg">{title}</span>
        <span className="mt-0.5 block text-sm text-fg-muted">{effect}</span>
      </span>
    </button>
  );
}

/** Rodapé das escolhas abertas: [Cancelar] [ação]; no celular, empilhados com a ação em cima. */
function ChoiceActions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>;
}

function PostModal({
  token,
  group,
  onClose,
  onNoted,
  onAdjustmentAdded,
  readOnly = false,
}: {
  token: string;
  group: Group;
  onClose: () => void;
  onNoted: (postId: string, note: string | null) => void;
  onAdjustmentAdded: (postId: string, adjustment: Adjustment) => void;
  readOnly?: boolean;
}) {
  const uid = useId();
  const isMobile = useIsMobile();
  const topRef = useRef<HTMLDivElement>(null);
  const [postId, setPostId] = useState(group.primary.id);
  const post = group.posts.find((p) => p.id === postId) ?? group.primary;

  const media = mediaOf(post);

  const [active, setActive] = useState(0);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [note, setNote] = useState(post.clientNote ?? "");
  const [adjustComment, setAdjustComment] = useState("");
  const [busy, setBusy] = useState<"" | "note" | "adjust">("");
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  // trocar de post dentro do grupo recarrega os campos do post escolhido
  const [prevPostId, setPrevPostId] = useState(postId);
  if (postId !== prevPostId) {
    setPrevPostId(postId);
    setNote(post.clientNote ?? "");
    setAdjustComment("");
    setChoice(null);
    setActive(0);
    setDone("");
    setError("");
  }

  function toggle(c: Choice) {
    setDone("");
    setError("");
    setChoice((cur) => (cur === c ? null : c));
  }
  function cancelChoice() {
    if (choice === "note") setNote(post.clientNote ?? "");
    if (choice === "adjust") setAdjustComment("");
    setChoice(null);
    setError("");
  }

  async function saveNote() {
    setBusy("note");
    setDone("");
    setError("");
    try {
      const r = await fetch(`/api/aprovar/${token}/post/${post.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "note", clientNote: note }),
      });
      if (r.ok) {
        onNoted(post.id, note.trim() || null);
        setChoice(null);
        setDone(note.trim() ? "Observação enviada. A equipe vai ver." : "Observação removida.");
      } else {
        const d = await r.json().catch(() => null);
        setError(typeof d?.error === "string" ? d.error : "Não foi possível enviar a observação. Tente novamente.");
      }
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setBusy("");
    }
  }

  const adjustRemaining = MIN_ADJUST - adjustComment.trim().length;

  async function requestAdjust() {
    if (adjustComment.trim().length < MIN_ADJUST || busy) return;
    setBusy("adjust");
    setDone("");
    setError("");
    try {
      const r = await fetch(`/api/aprovar/${token}/post/${post.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "adjust", comment: adjustComment.trim() }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setError(typeof d?.error === "string" ? d.error : "Não foi possível enviar o pedido de ajuste. Tente novamente.");
        return;
      }
      onAdjustmentAdded(post.id, d.adjustment);
      setAdjustComment("");
      setChoice(null);
      setDone("Pedido de ajuste enviado. A equipe foi avisada.");
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setBusy("");
    }
  }

  const pendingHere = pendingOf(post);
  const resolvedHere = post.adjustments.length - pendingHere;
  const panelId = (c: Choice) => `${uid}-${c}`;
  const ratio =
    post.format === "story" || post.format === "reels"
      ? "aspect-9/16 max-w-[calc(60dvh*9/16)]"
      : "aspect-4/5 max-w-[calc(60dvh*4/5)]";

  return (
    <Dialog
      open
      onClose={onClose}
      title={post.theme || "Post sem tema"}
      description={post.fullWhen}
      size="md"
      busy={busy !== ""}
      error={error || null}
      initialFocusRef={topRef}
      footer={
        isMobile ? (
          <Button variant="secondary" size="lg" fullWidth onClick={onClose} disabled={busy !== ""}>
            Fechar
          </Button>
        ) : undefined
      }
    >
      {/* foco inicial no topo: o cliente começa lendo, não no fim da rolagem */}
      <div ref={topRef} tabIndex={-1} className="-mt-2 grid gap-5 pb-4 pt-2 outline-none">
        {/* seletor quando o tema tem Feed + Story (alvos de 44 px em todas as larguras) */}
        {group.posts.length > 1 && (
          <div className="[&_[role=radio]]:h-11">
            <SegmentedControl
              aria-label="Formato"
              fullWidth
              value={post.id}
              onChange={setPostId}
              options={group.posts.map((p) => ({ value: p.id, label: `${formatLabel(p.format)} · ${p.time}` }))}
            />
          </div>
        )}

        {/* explicação do tema — é isso que o cliente aprova na fase cronograma */}
        {post.explanation && (
          <div className="rounded-card bg-sunken p-4 text-sm">
            <p className="font-semibold text-fg-muted">Sobre esta postagem</p>
            <p className="mt-1 whitespace-pre-wrap leading-relaxed text-fg">{post.explanation}</p>
          </div>
        )}

        {/* mídia na proporção do formato (ou placeholder, quando a arte ainda não existe) */}
        <div className="grid gap-2">
          <div className={`mx-auto w-full overflow-hidden rounded-card ${ratio} ${media[0] ? "bg-sunken" : fmtClass(post.format).wash}`}>
            {media[0] ? (
              <Thumb url={media[active]?.url ?? media[0].url} playable className="size-full" />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center">
                <span aria-hidden="true" className={`inline-flex size-6 [&>svg]:size-full ${fmtClass(post.format).icon}`}>
                  <Icon.calendar />
                </span>
                <p className={`text-sm ${fmtClass(post.format).text}`}>
                  A arte deste post ainda será produzida pela agência.
                </p>
              </div>
            )}
          </div>
          {media.length > 1 && (
            <div className="flex gap-2 overflow-x-auto p-1">
              {media.map((m, i) => (
                <button
                  key={m.url + i}
                  type="button"
                  onClick={() => setActive(i)}
                  aria-label={`Mídia ${i + 1} de ${media.length}`}
                  aria-pressed={i === active}
                  className={`size-14 shrink-0 overflow-hidden rounded-control border-2 ${
                    i === active ? "border-selected" : "border-line"
                  }`}
                >
                  <Thumb url={m.url} className="size-full" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FormatBadge format={post.format} />
          <Networks targets={post.targets} size={20} />
        </div>

        {/* sem legenda e sem roteiro das telas aqui: o cliente revisa o texto completo no link semanal */}

        {/* pedidos de ajuste formais (bloqueiam a aprovação até a equipe concluir) */}
        {post.adjustments.length > 0 && (
          <div className="grid gap-2">
            <h3 className="text-base font-semibold text-fg">Pedidos de ajuste</h3>
            {post.adjustments.map((a) =>
              a.status === "pendente" ? (
                <Callout key={a.id} tone="warning" title="Aguardando a equipe concluir este ajuste">
                  <p className="whitespace-pre-wrap">{a.comment}</p>
                </Callout>
              ) : (
                <Callout key={a.id} tone="success" title="Ajuste concluído pela equipe">
                  <p className="whitespace-pre-wrap">{a.comment}</p>
                  {a.reply ? (
                    <p className="mt-1 whitespace-pre-wrap">
                      <span className="font-semibold">Resposta da equipe:</span> {a.reply}
                    </p>
                  ) : null}
                </Callout>
              )
            )}
          </div>
        )}

        {readOnly ? (
          <>
            {post.clientNote && (
              <div className="rounded-card bg-sunken p-4 text-sm">
                <p className="font-semibold text-fg-muted">Sua observação</p>
                <p className="mt-1 whitespace-pre-wrap text-fg">{post.clientNote}</p>
              </div>
            )}
            <Callout tone="success" title="Cronograma já aprovado">
              Por este link não é mais possível pedir ajustes nem deixar observações. Se precisar mudar algo, fale
              com a agência.
            </Callout>
          </>
        ) : (
          <section aria-labelledby={`${uid}-acoes`} className="grid gap-3">
            <div>
              <h3 id={`${uid}-acoes`} className="text-base font-semibold text-fg">
                O que você quer fazer com este post?
              </h3>
              {pendingHere > 0 ? (
                <p className="mt-1 text-sm text-warning-fg">
                  Este post tem {pendingHere === 1 ? "um ajuste aberto" : `${pendingHere} ajustes abertos`}. Enquanto a
                  equipe não concluir, o cronograma não pode ser aprovado.
                </p>
              ) : resolvedHere > 0 ? (
                <p className="mt-1 text-sm text-fg-muted">
                  A equipe concluiu o ajuste deste post. Ele não impede mais a aprovação do cronograma.
                </p>
              ) : null}
            </div>

            {done && (
              <Callout tone="success" live="polite">
                {done}
              </Callout>
            )}

            {post.clientNote && choice !== "note" && (
              <div className="rounded-card bg-sunken p-4 text-sm">
                <p className="font-semibold text-fg-muted">Sua observação</p>
                <p className="mt-1 whitespace-pre-wrap text-fg">{post.clientNote}</p>
              </div>
            )}

            <div className="grid gap-2">
              <ChoiceButton
                icon={<Icon.edit />}
                title={pendingHere > 0 ? "Pedir outro ajuste neste post" : "Pedir ajuste neste post"}
                effect="A equipe refaz este post. Enquanto o ajuste estiver aberto, o cronograma não pode ser aprovado."
                expanded={choice === "adjust"}
                controls={panelId("adjust")}
                onToggle={() => toggle("adjust")}
              />
              {choice === "adjust" && (
                <div id={panelId("adjust")} className="grid gap-3 rounded-card border border-line bg-surface p-4">
                  <Field
                    label="O que você quer mudar?"
                    help={
                      <span className="text-sm">
                        {adjustRemaining > 0
                          ? `Faltam ${plural(adjustRemaining, "caractere", "caracteres")} (mínimo de ${MIN_ADJUST}).`
                          : "Pronto para enviar."}
                      </span>
                    }
                  >
                    <Textarea
                      value={adjustComment}
                      onChange={(e) => setAdjustComment(e.target.value)}
                      rows={4}
                      minLength={MIN_ADJUST}
                      maxLength={2000}
                      placeholder="Ex.: trocar o tema por algo sobre resultados; não citar preço."
                    />
                  </Field>
                  <ChoiceActions>
                    <Button variant="secondary" size="lg" onClick={cancelChoice} disabled={busy !== ""}>
                      Cancelar
                    </Button>
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={requestAdjust}
                      loading={busy === "adjust"}
                      loadingText="Enviando…"
                      disabled={busy !== "" || adjustRemaining > 0}
                    >
                      Enviar pedido de ajuste
                    </Button>
                  </ChoiceActions>
                </div>
              )}

              <ChoiceButton
                icon={<Icon.message />}
                title={post.clientNote ? "Editar sua observação" : "Deixar uma observação"}
                effect="Um recado para a equipe. Não impede a aprovação."
                expanded={choice === "note"}
                controls={panelId("note")}
                onToggle={() => toggle("note")}
              />
              {choice === "note" && (
                <div id={panelId("note")} className="grid gap-3 rounded-card border border-line bg-surface p-4">
                  <Field label="Observação para a agência">
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={3}
                      maxLength={1000}
                      showCount
                      placeholder="Ex.: gostei do tema; se possível, usar foto da equipe."
                    />
                  </Field>
                  <ChoiceActions>
                    <Button variant="secondary" size="lg" onClick={cancelChoice} disabled={busy !== ""}>
                      Cancelar
                    </Button>
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={saveNote}
                      loading={busy === "note"}
                      loadingText="Enviando…"
                      disabled={busy !== "" || (!note.trim() && !post.clientNote)}
                    >
                      {!note.trim() && post.clientNote ? "Remover observação" : "Enviar observação"}
                    </Button>
                  </ChoiceActions>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </Dialog>
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
  // fase cronograma: a prévia do card é a explicação do tema (nunca a legenda)
  const preview = primary.explanation.trim();
  const noted = group.posts.some((p) => p.clientNote);
  const pending = group.posts.reduce((n, p) => n + pendingOf(p), 0);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group relative w-full overflow-hidden rounded-control border bg-surface text-left transition-colors duration-(--sf-dur-fast) hover:border-line-strong ${
        pending > 0 ? "border-warning-solid" : "border-line"
      }`}
    >
      {/* faixa de cor do formato — diferencia Feed/Story/Carrossel/Reels de relance */}
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 z-10 w-0.75 ${fmtClass(primary.format).stripe}`} />

      <div className={compact ? "aspect-square" : "aspect-4/3"}>
        {media[0] ? (
          <Thumb url={media[0].url} className="size-full transition-transform group-hover:scale-105" />
        ) : (
          <FormatPlaceholder format={primary.format} compact={compact} />
        )}
      </div>

      <div className={`grid gap-1 ${compact ? "px-1.5 py-1.5" : "px-3 py-2"}`}>
        <div className="flex flex-wrap items-center gap-1">
          <FormatBadge format={primary.format} />
          {extras.map((p) => (
            <span key={p.id} className="text-xs text-fg-muted">
              + {formatLabel(p.format)} {p.time}
            </span>
          ))}
        </div>

        {/* tema e prévia (explicação) */}
        <p className={`line-clamp-2 font-semibold leading-snug text-fg ${compact ? "text-xs" : "text-sm"}`}>
          {group.theme || "Sem tema"}
        </p>
        {!compact && preview && <p className="line-clamp-2 text-xs leading-snug text-fg-muted">{preview}</p>}

        <div className="flex items-center gap-1 text-xs text-fg-muted">
          <Networks targets={primary.targets} size={compact ? 14 : 16} />
          <span className="ml-auto tabular-nums">{primary.time}</span>
        </div>
      </div>

      {/* selos: ajuste pendente, comentado e revisado (texto para leitor de tela dentro do botão) */}
      <span className="absolute right-1 top-1 z-10 flex gap-1">
        {pending > 0 && (
          <span className="inline-grid size-5 place-items-center rounded-full bg-warning-solid text-on-solid">
            <Icon.edit className="size-3" />
            <span className="sr-only">, ajuste pendente</span>
          </span>
        )}
        {noted && pending === 0 && (
          <span className="inline-grid size-5 place-items-center rounded-full bg-brand-solid text-on-solid">
            <Icon.message className="size-3" />
            <span className="sr-only">, com comentário</span>
          </span>
        )}
        {seen && (
          <span className="inline-grid size-5 place-items-center rounded-full bg-success-solid text-on-solid">
            <Icon.check className="size-3" />
            <span className="sr-only">, revisado</span>
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
  monthTitle,
  monthText,
  year,
  month,
  posts: initialPosts,
  readOnly = false,
  changesAsked = false,
  scheduleNote,
  igProfile,
  plannedFeedCount,
}: {
  token: string;
  clientName: string;
  clientLogoUrl: string | null;
  /** "Outubro de 2026" (títulos) */
  monthTitle: string;
  /** "outubro de 2026" (meio de frase) */
  monthText: string;
  year: number;
  month: number;
  posts: Post[];
  readOnly?: boolean;
  changesAsked?: boolean;
  scheduleNote: string | null;
  /** perfil do Instagram (ou do cadastro) para "Ver como feed"; null quando não há arte de feed */
  igProfile: Promise<InstagramProfilePreview> | null;
  /** posts de feed deste cronograma ainda não publicados (somam no nº de posts do perfil) */
  plannedFeedCount: number;
}) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [view, setView] = useState<"calendario" | "feed">("calendario");
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [approveError, setApproveError] = useState("");
  const [askingChanges, setAskingChanges] = useState(false);
  const [changesNote, setChangesNote] = useState("");
  const [changesError, setChangesError] = useState("");
  const [changesSent, setChangesSent] = useState(false);
  const statusId = useId();
  const pageRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

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

  // A-003: a barra é fixa e opaca; o conteúdo reserva a altura REAL dela (a linha de
  // status quebra em 2 linhas no celular), para o último card nunca ficar por trás.
  // U-12 (WCAG 2.4.11): a mesma altura vira scroll-padding-bottom do documento enquanto
  // a barra existe — ao navegar com Tab, o navegador rola o item com foco para cima da
  // barra em vez de deixá-lo coberto. Sai junto com a barra (aprovado/ajustes enviados).
  const hasBar = !readOnly && !approved && !changesSent;
  useEffect(() => {
    const bar = barRef.current;
    const page = pageRef.current;
    if (!hasBar || !bar || !page) return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(bar.getBoundingClientRect().height);
      page.style.setProperty("--bar-h", `${h}px`);
      // + 8 px: o anel de foco (2 px + afastamento) também fica fora da barra
      root.style.setProperty("scroll-padding-bottom", `${h + 8}px`);
    });
    ro.observe(bar);
    return () => {
      ro.disconnect();
      root.style.removeProperty("scroll-padding-bottom");
    };
  }, [hasBar]);

  async function approve() {
    setApproving(true);
    setApproveError("");
    try {
      const r = await fetch(`/api/aprovar/${token}/approve`, { method: "POST" });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setApproveError(
          typeof d?.error === "string" ? d.error : "Não foi possível aprovar. Tente novamente."
        );
        return;
      }
      setConfirming(false);
      setApproved(true);
    } catch {
      setApproveError("Falha de conexão. Tente novamente.");
    } finally {
      setApproving(false);
    }
  }

  async function requestChanges() {
    setApproving(true);
    setChangesError("");
    try {
      const r = await fetch(`/api/aprovar/${token}/request-changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: changesNote }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setChangesError(typeof d?.error === "string" ? d.error : "Não foi possível enviar. Tente novamente.");
        return;
      }
      setAskingChanges(false);
      setChangesSent(true);
    } catch {
      setChangesError("Falha de conexão. Tente novamente.");
    } finally {
      setApproving(false);
    }
  }

  const finalScreen = (title: string, text: string) => (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="card mx-auto max-w-md p-8 text-center">
        <span aria-hidden="true" className="mx-auto mb-3 inline-flex size-8 text-success-solid [&>svg]:size-full">
          <Icon.check />
        </span>
        <h1 className="font-display text-2xl font-semibold tracking-display text-fg">{title}</h1>
        <p className="mt-3 text-base text-fg-muted">{text}</p>
      </div>
    </div>
  );

  if (approved) {
    return finalScreen(
      "Cronograma aprovado",
      `Obrigado! Seu cronograma de ${monthText} foi aprovado. Agora a equipe produz as legendas e artes — você recebe toda semana as postagens completas da semana seguinte para revisão final.`
    );
  }

  if (changesSent) {
    return finalScreen(
      "Pedido de ajustes enviado",
      `A agência recebeu seus comentários e vai revisar o cronograma de ${monthText}. Nada será publicado até você aprovar.`
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
  const dayTitle = (day: number) =>
    `${WEEKDAYS_LONG[new Date(Date.UTC(year, month, day)).getUTCDay()]}, ${day} de ${MONTHS[month]}`;
  const shortDate = (day: number) => `${pad2(day)}/${pad2(month + 1)}`;

  const reviewed = groups.filter((g) => seen.has(g.key)).length;
  const pct = groups.length ? Math.round((reviewed / groups.length) * 100) : 0;
  const notedCount = posts.filter((p) => p.clientNote).length;
  const unopened = groups.length - reviewed;

  const statusLine =
    pendingCount > 0 ? (
      <p id={statusId} className="mb-2 text-sm font-medium text-warning-fg">
        Aguardando {plural(pendingCount, "ajuste", "ajustes")} da equipe — a aprovação libera quando{" "}
        {pendingCount === 1 ? "ele for concluído" : "forem concluídos"}.
      </p>
    ) : (
      <p id={statusId} className="mb-2 text-sm text-fg-muted">
        {reviewed < groups.length
          ? `Você revisou ${reviewed} de ${plural(groups.length, "tema", "temas")}.`
          : "Você revisou todos os temas."}
      </p>
    );

  const interactive = ready ? "" : "pointer-events-none opacity-60";

  // "Ver como feed": só quando já há arte de feed (como antes) e o perfil foi pedido no servidor
  const feedProfile = feedGroups.length > 0 ? igProfile : null;
  const showFeed = view === "feed" && feedProfile !== null;
  // grade do perfil: os planejados que vão para o feed (com ou sem arte), do mais tardio para o
  // mais cedo — o mais novo fica no canto superior esquerdo, como no Instagram
  const plannedTiles: PlannedFeedTile[] = showFeed
    ? groups
        .filter((g) => g.primary.format !== "story")
        .reverse()
        .map((g) => {
          const m = mediaOf(g.primary)[0];
          const fmt = formatMeta(g.primary.format).id;
          return {
            key: g.key,
            label: `Planejado para ${shortDate(g.day)}: ${g.theme || "Sem tema"}${fmt === "feed" ? "" : ` · ${formatLabel(fmt)}`}`,
            format: fmt,
            media: m ? <Thumb url={m.url} className="size-full" /> : <FormatPlaceholder format={g.primary.format} />,
          };
        })
    : [];

  return (
    <div
      ref={pageRef}
      className={`w-full pt-6 ${hasBar ? "pb-[calc(var(--bar-h,104px)+24px)]" : "pb-10"}`}
    >
      {/* a coluna da página continua em max-w-3xl; só a prévia do feed usa a largura do perfil */}
      <div className="mx-auto grid w-full max-w-3xl gap-4 px-4">
        {/* identidade do cliente + título */}
        <div>
          <div className="flex items-center gap-3">
            <Avatar name={clientName} src={clientLogoUrl} size="lg" shape="square" />
            <span className="text-base font-semibold text-fg">{clientName}</span>
          </div>
          <h1 className="mt-4 font-display text-3xl font-semibold tracking-display text-fg">
            Cronograma de {monthTitle}
          </h1>
          <p className="mt-1 text-base text-fg-muted">
            {readOnly
              ? "Este cronograma já foi aprovado. Toque em um tema para rever."
              : `${plural(groups.length, "tema", "temas")} · ${plural(posts.length, "post", "posts")}. Toque em um tema para ver e comentar.`}
          </p>
        </div>

        {/* situação: no máximo 1 aviso, nesta prioridade (DESIGN h.1) */}
        {readOnly ? (
          <Callout tone="success" title="Cronograma aprovado">
            As postagens completas chegam para sua revisão toda semana. Por este link não é mais possível pedir
            ajustes.
          </Callout>
        ) : pendingCount > 0 ? (
          <Callout tone="warning" title={`${plural(pendingCount, "ajuste", "ajustes")} aguardando a equipe`}>
            Você poderá aprovar o cronograma assim que a equipe concluir os ajustes pedidos. Enquanto isso, pode
            continuar revisando e comentando.
          </Callout>
        ) : changesAsked ? (
          <Callout tone="warning" title="Ajustes já pedidos">
            {scheduleNote && <p className="whitespace-pre-wrap">{scheduleNote}</p>}
            <p className={scheduleNote ? "mt-1" : undefined}>
              A agência está revisando. Você pode continuar comentando ou aprovar quando estiver tudo certo.
            </p>
          </Callout>
        ) : null}

        {/* progresso da revisão */}
        {!readOnly && (
          <div className="card p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-fg">
                {reviewed} de {plural(groups.length, "tema revisado", "temas revisados")}
                {notedCount > 0 && ` · ${notedCount} com comentário`}
              </span>
              <span className="tabular-nums text-fg-muted">{pct}%</span>
            </div>
            <div
              role="progressbar"
              aria-label="Temas revisados"
              aria-valuemin={0}
              aria-valuemax={groups.length}
              aria-valuenow={reviewed}
              className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-bg"
            >
              <div
                className="h-full rounded-full bg-selected transition-[width] duration-(--sf-dur-slow)"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* alternância calendário / feed (feed só quando já há artes) — 44 px no celular [A-033] */}
        {feedProfile !== null && (
          <div className="flex justify-center">
            <SegmentedControl
              aria-label="Modo de exibição"
              value={view}
              onChange={setView}
              options={[
                { value: "calendario", label: "Calendário" },
                { value: "feed", label: "Ver como feed" },
              ]}
            />
          </div>
        )}

        {!ready && <p className="text-center text-sm text-fg-muted">Preparando o cronograma…</p>}

        {!showFeed && (
          <>
            {/* ---------- lista (celular): o cliente abre isso do WhatsApp ---------- */}
            <div className={`grid gap-3 sm:hidden ${interactive}`}>
              {[...byDay.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([day, dayGroups]) => (
                  <section key={day} className="card p-3">
                    <h2 className="mb-2 text-sm font-semibold text-fg-muted">{dayTitle(day)}</h2>
                    {/* 1 tema → cartão em largura total [A-017] */}
                    <div className={`grid gap-2 ${dayGroups.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
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
                  </section>
                ))}
            </div>

            {/* ---------- calendário (tablet/desktop) ---------- */}
            <div className={`card hidden p-4 sm:block ${interactive}`}>
              <div aria-hidden="true" className="mb-1 grid grid-cols-7 gap-2">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="py-1 text-center text-xs font-medium text-fg-muted">
                    {w}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-2">
                {cells.map((d, i) => {
                  if (d === null) return <div key={`e${i}`} />;
                  const dayGroups = byDay.get(d) ?? [];
                  return (
                    <div key={d} className="flex min-h-12 min-w-0 flex-col gap-1">
                      <span className="pl-0.5 text-xs leading-none text-fg-muted">{d}</span>
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
      </div>

      {/* "Ver como feed": o perfil do Instagram como vai ficar (a grade só com os planejados deste cronograma) */}
      {showFeed && feedProfile && (
        <InstagramFeedPreview
          profile={feedProfile}
          clientName={clientName}
          clientLogoUrl={clientLogoUrl}
          planned={plannedTiles}
          plannedCount={plannedFeedCount}
          onOpen={openGroup}
          className={`mt-6 ${interactive}`}
        />
      )}

      {/* A-003: barra fixa OPACA (bg-raised) — nada passa legível por trás */}
      {hasBar && (
        <div
          ref={barRef}
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-raised shadow-bar"
        >
          <div className="mx-auto max-w-3xl px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
            {statusLine}
            {/* no celular o primário ocupa o resto da linha: "Aprovar cronograma" cabe em 1 linha a 390 px */}
            <div className="flex gap-2 sm:justify-end">
              <Button
                variant="secondary"
                size="lg"
                className="shrink-0 max-sm:px-3"
                onClick={() => {
                  setChangesError("");
                  setAskingChanges(true);
                }}
                disabled={approving || !ready}
              >
                Pedir ajustes
              </Button>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                className="min-w-0 flex-1 max-sm:px-3 sm:w-auto sm:flex-none"
                onClick={() => {
                  setApproveError("");
                  setConfirming(true);
                }}
                disabled={approving || !ready || pendingCount > 0}
                aria-describedby={statusId}
              >
                Aprovar cronograma
              </Button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <PostModal
          key={open.key}
          token={token}
          group={open}
          onClose={() => setOpenKey(null)}
          onNoted={handleNoted}
          onAdjustmentAdded={handleAdjustmentAdded}
          readOnly={readOnly}
        />
      )}

      {/* confirmação com resumo — aprovar não é 1 clique */}
      <ConfirmDialog
        open={confirming}
        title="Aprovar cronograma?"
        description="Depois de aprovado, a equipe produz o conteúdo completo e você revisa as postagens semana a semana antes da publicação. Por este link, não será mais possível pedir ajustes."
        cancelLabel="Voltar"
        confirmLabel="Confirmar aprovação"
        busy={approving}
        busyLabel="Aprovando…"
        error={approveError || null}
        confirmDisabled={pendingCount > 0}
        onConfirm={approve}
        onCancel={() => {
          setConfirming(false);
          setApproveError("");
        }}
      >
        <dl className="divide-y divide-line rounded-card border border-line bg-sunken">
          <div className="flex justify-between gap-3 px-4 py-2.5">
            <dt className="text-fg-muted">Mês</dt>
            <dd className="font-medium">{monthTitle}</dd>
          </div>
          <div className="flex justify-between gap-3 px-4 py-2.5">
            <dt className="text-fg-muted">Temas</dt>
            <dd className="font-medium">{groups.length}</dd>
          </div>
          <div className="flex justify-between gap-3 px-4 py-2.5">
            <dt className="text-fg-muted">Posts</dt>
            <dd className="font-medium">{posts.length}</dd>
          </div>
          <div className="flex justify-between gap-3 px-4 py-2.5">
            <dt className="text-fg-muted">Revisados por você</dt>
            <dd className="font-medium">
              {reviewed} de {groups.length}
            </dd>
          </div>
        </dl>
        {unopened > 0 && (
          <Callout tone="warning">
            Você ainda não abriu {plural(unopened, "tema", "temas")}. Pode aprovar mesmo assim.
          </Callout>
        )}
        {notedCount > 0 && (
          <Callout tone="warning">
            Há {plural(notedCount, "post", "posts")} com observação. Se aprovar agora, o cronograma segue como está.
          </Callout>
        )}
      </ConfirmDialog>

      {/* pedir ajustes com comentário geral */}
      <Dialog
        open={askingChanges}
        onClose={() => setAskingChanges(false)}
        title="Pedir ajustes no cronograma"
        description="Conte o que precisa mudar. Nada será publicado até você aprovar, e você ainda pode aprovar depois."
        size="sm"
        busy={approving}
        error={changesError || null}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAskingChanges(false)} disabled={approving}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={requestChanges}
              loading={approving}
              loadingText="Enviando…"
              disabled={!changesNote.trim() && notedCount === 0}
            >
              Enviar pedido
            </Button>
          </>
        }
      >
        <div className="pb-2">
          <Field
            label="O que precisa mudar?"
            help={
              notedCount > 0 ? (
                <span className="text-sm">
                  {notedCount === 1
                    ? "Sua observação no post vai junto."
                    : `Suas ${notedCount} observações por post vão junto.`}
                </span>
              ) : undefined
            }
          >
            <Textarea
              value={changesNote}
              onChange={(e) => setChangesNote(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder="Ex.: trocar os temas da semana 2; usar fotos da equipe em vez de banco de imagens."
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
