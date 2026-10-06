"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { BrandBadge, BRAND } from "@/components/BrandIcons";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { Field, Textarea } from "@/components/Field";
import { Icon } from "@/components/Icons";
import { EmptyState, ToneBadge } from "@/components/ui";
import { formatLabel, formatMeta, type PostFormat } from "@/lib/formats";

// pedido de ajuste precisa dizer O QUE mudar (mesmo mínimo da API)
const MIN_ADJUST = 30;

/** Cor do formato (tokens format-*, DESIGN a.6) no espaço da arte. Classes estáticas para o Tailwind. */
const FORMAT_CLASS: Record<PostFormat, { wash: string; icon: string; text: string }> = {
  feed: { wash: "bg-format-feed-bg", icon: "text-format-feed", text: "text-format-feed-fg" },
  carrossel: { wash: "bg-format-carrossel-bg", icon: "text-format-carrossel", text: "text-format-carrossel-fg" },
  reels: { wash: "bg-format-reels-bg", icon: "text-format-reels", text: "text-format-reels-fg" },
  story: { wash: "bg-format-story-bg", icon: "text-format-story", text: "text-format-story-fg" },
};
const fmtClass = (f: string) => FORMAT_CLASS[formatMeta(f).id];

type Adjustment = {
  id: string;
  comment: string;
  status: string; // pendente | resolvido
  reply: string | null;
};

type Post = {
  id: string;
  theme: string;
  format: string;
  /** legado (o importador grava só este) — vale quando a rede não tem `captions` (N-18) */
  caption: string | null;
  captions: Record<string, string>;
  mediaUrl: string | null;
  mediaItems: { url: string; type?: string }[] | null;
  slides: string[];
  targets: string[];
  /** "sex, 16/10 às 18:00" */
  when: string;
  approved: boolean;
  /** "qui, 15/10" */
  deadlineLabel: string;
  overdue: boolean;
  adjustments: Adjustment[];
};

const isVid = (u: string) => /\.(mp4|mov|webm|m4v)$/i.test(u);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pendingOf = (p: Post) => p.adjustments.filter((a) => a.status === "pendente").length;

/** Legenda que o cliente vê em cada rede: `captions[rede] ?? caption`, a mesma regra do publicador (N-18). */
function captionFor(post: Post, net: string): string {
  return post.captions[net] ?? post.caption ?? "";
}

/** "Legenda efetiva" do post (captions por rede ou o `caption` legado). */
function captionText(post: Post): string {
  return (
    [post.captions.instagram, post.captions.facebook, post.captions.linkedin, post.caption].find(
      (v): v is string => typeof v === "string" && v.trim().length > 0
    ) ?? ""
  );
}

/** "Instagram e Facebook" (texto para leitor de tela; os selos são decorativos). */
function networksText(targets: string[]): string {
  const names = targets.map((t) => BRAND[t]?.label ?? t);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}` : (names[0] ?? "");
}

function Networks({ targets }: { targets: string[] }) {
  if (targets.length === 0) return null;
  return (
    <span className="inline-flex items-center">
      <span aria-hidden="true" className="flex items-center gap-1">
        {targets.map((t) => (
          <BrandBadge key={t} platform={t} size={20} />
        ))}
      </span>
      <span className="sr-only">Redes: {networksText(targets)}</span>
    </span>
  );
}

/** Situação da postagem: um selo por estado, texto ≥ 14 px (DESIGN h.2). */
function StateBadge({ post }: { post: Post }) {
  if (post.approved) {
    return (
      <ToneBadge tone="success" size="md" icon={<Icon.check />}>
        Aprovada
      </ToneBadge>
    );
  }
  if (pendingOf(post) > 0) {
    return (
      <ToneBadge tone="warning" size="md" icon={<Icon.edit />}>
        Ajuste em andamento
      </ToneBadge>
    );
  }
  return post.overdue ? (
    <ToneBadge tone="danger" size="md" icon={<Icon.alert />}>
      Prazo vencido em {post.deadlineLabel}
    </ToneBadge>
  ) : (
    <ToneBadge tone="info" size="md" icon={<Icon.clock />}>
      Responder até {post.deadlineLabel}
    </ToneBadge>
  );
}

/* ------------------------------- mídia ------------------------------- */

function Media({ post, label }: { post: Post; label: string }) {
  const items = post.mediaItems?.length ? post.mediaItems : post.mediaUrl ? [{ url: post.mediaUrl }] : [];
  const [active, setActive] = useState(0);
  const [broken, setBroken] = useState<string[]>([]);
  const c = fmtClass(post.format);
  const cur = items.length ? items[Math.min(active, items.length - 1)] : null;
  const showArt = cur !== null && !broken.includes(cur.url);
  // feed e carrossel em 4:5; reels e story em 9:16 (arte 4:5, RA A-008)
  const ratio =
    post.format === "story" || post.format === "reels"
      ? "aspect-9/16 max-w-[calc(60dvh*9/16)]"
      : "aspect-4/5 max-w-[calc(60dvh*4/5)]";
  const artName = `Arte da postagem${post.theme ? `: ${post.theme}` : ""}${
    items.length > 1 ? ` (mídia ${Math.min(active, items.length - 1) + 1} de ${items.length})` : ""
  }`;
  const markBroken = (url: string) => setBroken((b) => (b.includes(url) ? b : [...b, url]));

  return (
    <div className="grid gap-2">
      <div className={`mx-auto w-full overflow-hidden rounded-card ${ratio} ${showArt ? "bg-sunken" : c.wash}`}>
        {showArt && cur ? (
          isVid(cur.url) ? (
            <video
              key={cur.url}
              src={cur.url}
              controls
              playsInline
              preload="metadata"
              aria-label={artName}
              onError={() => markBroken(cur.url)}
              className="size-full object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={cur.url}
              src={cur.url}
              alt={artName}
              loading="lazy"
              onError={() => markBroken(cur.url)}
              className="size-full object-cover"
            />
          )
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center">
            <span aria-hidden="true" className={`inline-flex size-6 [&>svg]:size-full ${c.icon}`}>
              <Icon.calendar />
            </span>
            <p className={`text-sm ${c.text}`}>
              {cur ? "Arte indisponível no momento. Recarregue a página; se continuar, avise a agência." : "A arte desta postagem ainda não está disponível."}
            </p>
          </div>
        )}
      </div>
      {items.length > 1 && (
        <div className="flex gap-2 overflow-x-auto p-1">
          {items.map((m, i) => (
            <button
              key={m.url + i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`Mídia ${i + 1} de ${items.length}: ${label}`}
              aria-pressed={i === active}
              className={`size-14 shrink-0 overflow-hidden rounded-control border-2 ${
                i === active ? "border-selected" : "border-line"
              } ${broken.includes(m.url) ? c.wash : "bg-sunken"}`}
            >
              {broken.includes(m.url) ? null : isVid(m.url) ? (
                <video src={m.url} muted playsInline preload="metadata" className="size-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt="" loading="lazy" className="size-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- legenda ------------------------------- */

function Caption({ post }: { post: Post }) {
  const hasMeta = post.targets.includes("instagram") || post.targets.includes("facebook");
  const hasLinkedin = post.targets.includes("linkedin");
  const metaNet = post.targets.includes("instagram") ? "instagram" : post.targets.includes("facebook") ? "facebook" : null;
  const shared = metaNet ? captionFor(post, metaNet) : "";
  const linkedin = captionFor(post, "linkedin");
  const showLinkedin = hasLinkedin && (!hasMeta || linkedin !== shared);
  const metaLabel =
    post.targets.includes("facebook") && post.targets.includes("instagram")
      ? "Facebook + Instagram"
      : (BRAND[metaNet ?? ""]?.label ?? "");

  if (!captionText(post)) return null;

  const block = (text: string) => (
    <p className="whitespace-pre-wrap rounded-card bg-sunken p-4 text-sm leading-relaxed text-fg">{text}</p>
  );

  return (
    <div className="grid gap-3">
      <h3 className="text-base font-semibold text-fg">Legenda</h3>
      {hasMeta && (
        <div className="grid gap-1.5">
          {(hasLinkedin || post.targets.length > 1) && <p className="text-sm text-fg-muted">{metaLabel}</p>}
          {block(shared || "Sem legenda para estas redes.")}
        </div>
      )}
      {showLinkedin && (
        <div className="grid gap-1.5">
          <p className="text-sm text-fg-muted">LinkedIn</p>
          {block(linkedin || "Sem legenda para o LinkedIn.")}
        </div>
      )}
      {hasLinkedin && hasMeta && !showLinkedin && <p className="text-sm text-fg-muted">O LinkedIn usa a mesma legenda.</p>}
      {!hasMeta && !hasLinkedin && block(captionText(post))}
    </div>
  );
}

/* ------------------------------ cartão ------------------------------ */

function PostCard({
  token,
  post,
  label,
  onChange,
}: {
  token: string;
  post: Post;
  /** nome único da postagem nesta semana (tema; repetido → com formato e data), para os nomes acessíveis (U-11) */
  label: string;
  onChange: (p: Post) => void;
}) {
  const uid = useId();
  const [showForm, setShowForm] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<"" | "approve" | "adjust">("");
  const [done, setDone] = useState("");
  const [error, setError] = useState("");

  const pending = pendingOf(post);
  const resolved = post.adjustments.length - pending;
  // regra do cliente: aprovada não pede ajuste; com ajuste aberto não aprova até a equipe concluir
  const canAnswer = !post.approved && pending === 0;
  const remaining = MIN_ADJUST - comment.trim().length;

  // foco: abrir o pedido leva à caixa de texto; cancelar devolve ao "Pedir ajuste" (o botão some enquanto o
  // formulário está aberto, então o foco não pode ficar no vazio)
  const adjustBtnRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<"" | "textarea" | "adjust">("");
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = "";
    if (target === "textarea") {
      // o formulário inteiro (caixa + Cancelar/Enviar) entra na tela, não só a parte visível da caixa
      textareaRef.current?.focus({ preventScroll: true });
      formRef.current?.scrollIntoView({ block: "nearest" });
    } else if (target === "adjust") adjustBtnRef.current?.focus();
  }, [showForm]);

  function cancelAdjust() {
    focusNext.current = "adjust";
    setShowForm(false);
    setComment("");
    setError("");
  }

  async function act(action: "approve" | "adjust") {
    if (busy) return;
    if (action === "adjust" && remaining > 0) return;
    setBusy(action);
    setDone("");
    setError("");
    try {
      const r = await fetch(`/api/aprovar-semana/${token}/post/${post.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "approve" ? { action } : { action, comment: comment.trim() }),
      });
      const d = await r.json().catch(() => null);
      // aprovada em outra aba (ou outro aparelho): o servidor recusa o ajuste e o cartão passa a "aprovado"
      const alreadyApproved = r.status === 409 && d?.code === "POST_ALREADY_APPROVED";
      if (!r.ok) {
        if (alreadyApproved) {
          onChange({ ...post, approved: true });
          setShowForm(false);
          setComment("");
        }
        setError(
          typeof d?.error === "string"
            ? d.error
            : alreadyApproved
              ? "Esta postagem já foi aprovada. Para mudar algo, fale com a agência."
              : action === "approve"
                ? "Não foi possível aprovar a postagem. Tente novamente."
                : "Não foi possível enviar o pedido de ajuste. Tente novamente."
        );
        return;
      }
      if (action === "approve") {
        onChange({ ...post, approved: true });
        setDone("Postagem aprovada. Obrigado!");
      } else {
        const a = d?.adjustment;
        const adjustment: Adjustment = {
          id: typeof a?.id === "string" ? a.id : `novo-${post.adjustments.length}`,
          comment: typeof a?.comment === "string" ? a.comment : comment.trim(),
          status: "pendente",
          reply: null,
        };
        onChange({ ...post, approved: false, adjustments: [...post.adjustments, adjustment] });
        setComment("");
        setShowForm(false);
        setDone("Pedido de ajuste enviado. A equipe foi avisada.");
      }
    } catch {
      setError("Falha de conexão. Verifique a internet e tente novamente.");
    } finally {
      setBusy("");
    }
  }

  return (
    <article aria-labelledby={`${uid}-titulo`} className="card overflow-hidden">
      {/* cabeçalho: tema, formato e data, situação e redes */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1 basis-56">
          <h2 id={`${uid}-titulo`} className="text-base font-semibold text-fg">
            {post.theme || "Postagem sem tema"}
          </h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            {formatLabel(post.format)} · {post.when}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StateBadge post={post} />
          <Networks targets={post.targets} />
        </div>
      </div>

      <div className="grid gap-5 p-4 sm:p-5">
        <Media post={post} label={label} />

        {/* roteiro das telas (carrossel/reels) */}
        {post.slides.length > 0 && (
          <div className="overflow-hidden rounded-card border border-line">
            <h3 className="border-b border-line px-4 py-2 text-sm font-semibold text-fg-muted">
              {post.format === "reels" ? "Telas do reels" : "Páginas do carrossel"}
            </h3>
            <ol className="divide-y divide-line">
              {post.slides.map((s, i) => (
                <li key={i} className="flex gap-3 px-4 py-2.5 text-sm">
                  <span className="shrink-0 font-semibold text-link">{i + 1}</span>
                  <p className="whitespace-pre-wrap leading-relaxed text-fg">{s}</p>
                </li>
              ))}
            </ol>
          </div>
        )}

        <Caption post={post} />

        {/* histórico de pedidos de ajuste */}
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

        {/* resposta do cliente: o que cada ação faz está UMA vez no topo da página (U-10); aqui só o estado,
            os dois botões e uma linha curta. A região e os botões levam o tema no nome acessível (U-11). */}
        <section aria-label={`Sua resposta: ${label}`} className="grid gap-3 border-t border-line pt-4">
          <h3 className="text-base font-semibold text-fg">Sua resposta</h3>

          {post.approved ? (
            <p className="text-sm text-fg-muted">
              Você aprovou esta postagem. Por este link não é mais possível pedir ajuste; se precisar mudar algo, fale
              com a agência.
            </p>
          ) : pending > 0 ? (
            <p className="text-sm font-medium text-warning-fg">
              Você pediu um ajuste nesta postagem. Enquanto a equipe não concluir, não é possível aprovar nem pedir
              outro ajuste. Quando ela concluir, o ajuste feito aparece aqui e você poderá responder de novo.
            </p>
          ) : resolved > 0 ? (
            <p className="text-sm font-medium text-fg">
              A equipe concluiu o seu ajuste. Revise a postagem de novo e responda.
            </p>
          ) : null}

          {done && (
            <Callout tone="success" live="polite">
              {done}
            </Callout>
          )}
          {error && (
            <Callout tone="danger" live="assertive">
              {error}
            </Callout>
          )}

          {canAnswer && !showForm && (
            <div className="grid gap-2">
              <p id={`${uid}-ajuda`} className="text-sm text-fg-muted">
                Depois de aprovar, não dá mais para pedir ajuste nesta postagem.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button
                  variant="secondary"
                  size="lg"
                  leadingIcon={<Icon.edit />}
                  ref={adjustBtnRef}
                  aria-label={`Pedir ajuste: ${label}`}
                  onClick={() => {
                    setDone("");
                    setError("");
                    focusNext.current = "textarea";
                    setShowForm(true);
                  }}
                  disabled={busy !== ""}
                >
                  Pedir ajuste
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  leadingIcon={<Icon.check />}
                  aria-label={busy === "approve" ? undefined : `Aprovar postagem: ${label}`}
                  aria-describedby={`${uid}-ajuda`}
                  onClick={() => act("approve")}
                  loading={busy === "approve"}
                  loadingText="Aprovando…"
                  disabled={busy !== ""}
                >
                  Aprovar postagem
                </Button>
              </div>
            </div>
          )}

          {canAnswer && showForm && (
            <div ref={formRef} className="grid gap-3 rounded-card border border-line bg-surface p-4">
              <Field
                label="O que você quer mudar nesta postagem?"
                help={
                  <span className="text-sm">
                    {remaining > 0
                      ? `Faltam ${plural(remaining, "caractere", "caracteres")} (mínimo de ${MIN_ADJUST}).`
                      : "Pronto para enviar."}
                  </span>
                }
              >
                <Textarea
                  ref={textareaRef}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={4}
                  minLength={MIN_ADJUST}
                  maxLength={2000}
                  placeholder="Ex.: trocar a foto da capa; corrigir o horário citado na legenda."
                />
              </Field>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button variant="secondary" size="lg" onClick={cancelAdjust} disabled={busy !== ""}>
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  aria-label={busy === "adjust" ? undefined : `Enviar pedido de ajuste: ${label}`}
                  onClick={() => act("adjust")}
                  loading={busy === "adjust"}
                  loadingText="Enviando…"
                  disabled={busy !== "" || remaining > 0}
                >
                  Enviar pedido
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </article>
  );
}

/* --------------------------------- view --------------------------------- */

export default function WeeklyView({
  token,
  clientName,
  clientLogoUrl,
  weekRange,
  posts: initialPosts,
}: {
  token: string;
  clientName: string;
  clientLogoUrl: string | null;
  /** "12 a 18 de outubro" */
  weekRange: string;
  posts: Post[];
}) {
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  // respondida = aprovada ou com pedido de ajuste aberto
  const answered = useMemo(() => posts.filter((p) => p.approved || pendingOf(p) > 0).length, [posts]);
  const pct = posts.length ? Math.round((answered / posts.length) * 100) : 0;
  // nome de cada postagem nos nomes acessíveis: o tema; se o tema se repete na semana (ex.: reels + story),
  // entra o formato e a data, para nenhuma região ou botão ficar com nome igual (U-11)
  const labels = useMemo(() => {
    const themeOf = (p: Post) => p.theme || "Postagem sem tema";
    const count = new Map<string, number>();
    for (const p of initialPosts) count.set(themeOf(p), (count.get(themeOf(p)) ?? 0) + 1);
    return new Map(
      initialPosts.map((p) => [
        p.id,
        (count.get(themeOf(p)) ?? 0) > 1 ? `${themeOf(p)} (${formatLabel(p.format)}, ${p.when})` : themeOf(p),
      ])
    );
  }, [initialPosts]);

  function handleChange(updated: Post) {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-10 pt-6">
      <div className="grid gap-4">
        {/* identidade do cliente + título (irmão do link mensal) */}
        <div>
          <div className="flex items-center gap-3">
            <Avatar name={clientName} src={clientLogoUrl} size="lg" shape="square" />
            <span className="text-base font-semibold text-fg">{clientName}</span>
          </div>
          <h1 className="mt-4 font-display text-3xl font-semibold tracking-display text-fg">Postagens da semana</h1>
          <p className="mt-1 text-base text-fg-muted">
            Semana de {weekRange}. Responda até o prazo de cada postagem.
          </p>
          {/* o que cada resposta faz: uma vez aqui, não em cada cartão (U-10) */}
          {posts.length > 0 && (
            <ul className="mt-3 grid gap-1 text-sm text-fg-muted">
              <li>
                <span className="font-semibold text-fg">Aprovar postagem:</span> confirma o texto e a arte. Depois
                disso, não dá mais para pedir ajuste por este link.
              </li>
              <li>
                <span className="font-semibold text-fg">Pedir ajuste:</span> devolve a postagem para a equipe. Você só
                poderá aprovar depois que a equipe concluir o ajuste.
              </li>
            </ul>
          )}
        </div>

        {posts.length > 0 && (
          <div className="card p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-fg">
                {answered} de {plural(posts.length, "postagem respondida", "postagens respondidas")}
              </span>
              <span className="tabular-nums text-fg-muted">{pct}%</span>
            </div>
            <div
              role="progressbar"
              aria-label="Postagens respondidas"
              aria-valuemin={0}
              aria-valuemax={posts.length}
              aria-valuenow={answered}
              className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-bg"
            >
              <div
                className="h-full rounded-full bg-selected transition-[width] duration-(--sf-dur-slow)"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {posts.map((p) => (
          <PostCard
            key={p.id}
            token={token}
            post={p}
            label={labels.get(p.id) ?? (p.theme || "Postagem sem tema")}
            onChange={handleChange}
          />
        ))}

        {posts.length === 0 && (
          <EmptyState
            headingLevel={2}
            title="Nenhuma postagem para revisar"
            description="Este link não tem postagens no momento. Se você esperava ver alguma, fale com a agência."
          />
        )}
      </div>
    </div>
  );
}
