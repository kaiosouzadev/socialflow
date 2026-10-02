"use client";

import { useState, useEffect, useId, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PageHeader, PlatformChip } from "@/components/ui";
import { Button, Spinner, buttonClasses } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { Dialog } from "@/components/Dialog";
import { Field, Input, Select } from "@/components/Field";
import { Icon } from "@/components/Icons";
import { CaptionFields } from "@/components/CaptionFields";
import { DateTimePicker } from "@/components/DatePickers";
import { FormatPicker } from "@/components/FormatPicker";
import { SlidesEditor } from "@/components/SlidesEditor";
import { MediaField } from "@/components/MediaField";
import { PostPreview } from "@/components/PostPreview";
import { spLocalInputToISO } from "@/lib/format-date";
import { addDaysKey, spDateKey } from "@/lib/date-range";
import { PUBLISH_BLOCKED } from "@/lib/publish-policy";

type Client = { id: string; name: string };
type Account = { id: string; platform: string; status: string };
/** Dados do cliente escolhido, marcados com o id para derivar "carregando" sem setState no efeito. */
type ClientInfo =
  | { clientId: string; ok: true; accounts: Account[]; plan: string; agencyPublishes: boolean }
  | { clientId: string; ok: false };
type PostStatus = "scheduled" | "draft";

/** Agendar para daqui a poucos minutos é quase sempre engano: abaixo disso, pede confirmação. */
const IMMINENT_MINUTES = 30;

/** Data padrão de um post novo: amanhã, no horário usado no cronograma (A18). */
const DEFAULT_POST_TIME = "18:00";

/** Redes padrão de cliente só produção — a mesma regra de ai/calendar e basic-plan sem contas. */
const PRODUCTION_ONLY_TARGETS = ["instagram", "facebook"];

const PLATFORM_ORDER = ["instagram", "facebook", "linkedin"];

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
};

/** "AAAA-MM-DDTHH:mm" de amanhã às 18:00 no fuso de São Paulo. */
function defaultScheduledLocal(): string {
  return `${addDaysKey(spDateKey(), 1)}T${DEFAULT_POST_TIME}`;
}

/** Minutos daqui até `v` (negativo = data no passado). */
function minutesFromNow(v: string): number {
  if (!v) return Number.POSITIVE_INFINITY;
  return (new Date(spLocalInputToISO(v)).getTime() - Date.now()) / 60000;
}

function uniquePlatforms(accounts: Account[]): string[] {
  return Array.from(new Set(accounts.map((a) => a.platform)));
}

/** Redes oferecidas: as das contas ativas; só produção não depende de conta (RC Risco 8). */
function offeredPlatforms(info: Extract<ClientInfo, { ok: true }>): string[] {
  const fromAccounts = uniquePlatforms(info.accounts);
  if (info.agencyPublishes) return fromAccounts;
  const all = new Set([...PRODUCTION_ONLY_TARGETS, ...fromAccounts]);
  return [...PLATFORM_ORDER.filter((p) => all.has(p)), ...[...all].filter((p) => !PLATFORM_ORDER.includes(p))];
}

function StepHeading({ n, id, title, hint }: { n: number; id: string; title: string; hint?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-full bg-selected text-xs font-semibold text-on-selected"
      >
        {n}
      </span>
      <h2 id={id} className="text-base font-semibold text-fg">
        {title}
      </h2>
      {hint && <span className="text-xs text-fg-muted">{hint}</span>}
    </div>
  );
}

function NewPostForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselected = searchParams.get("clientId") ?? "";
  const ids = useId();
  const stepIds = {
    client: `${ids}-cliente`,
    networks: `${ids}-redes`,
    content: `${ids}-conteudo`,
    date: `${ids}-data`,
  };
  const backRef = useRef<HTMLButtonElement>(null);

  // null = carregando a lista
  const [clients, setClients] = useState<Client[] | null>(null);
  const [clientsFailed, setClientsFailed] = useState(false);
  const [clientId, setClientId] = useState(preselected);

  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [targets, setTargets] = useState<string[]>([]);

  const [theme, setTheme] = useState("");
  const [format, setFormat] = useState("feed");
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [slides, setSlides] = useState<string[]>([]);
  const [mediaUrl, setMediaUrl] = useState("");

  const [scheduledLocal, setScheduledLocal] = useState(defaultScheduledLocal);
  // null = ainda não mexeram na data (a padrão está a ~1 dia): nada de "Faltam ~0 min" na abertura (A-011)
  const [minutesUntil, setMinutesUntil] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<PostStatus | null>(null);
  const [confirmingImminent, setConfirmingImminent] = useState(false);

  // conteúdo digitado para um cliente não pode vazar para outro — reset
  // síncrono na troca (padrão prev-state durante o render, como CalendarFilters)
  const [prevClientId, setPrevClientId] = useState(clientId);
  if (clientId !== prevClientId) {
    setPrevClientId(clientId);
    setCaptions({});
    setTheme("");
    setSlides([]);
    setError(null);
    setTargetsError(null);
  }

  // load clients once
  useEffect(() => {
    let cancelled = false;
    fetch("/api/clients")
      .then(async (r) => {
        const d: unknown = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(d)) throw new Error("lista de clientes indisponível");
        return d as Client[];
      })
      .then((list) => {
        if (!cancelled) setClients(list.map((c) => ({ id: c.id, name: c.name })));
      })
      .catch(() => {
        if (cancelled) return;
        setClients([]);
        setClientsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ao escolher o cliente: contas ativas + "a agência publica?" → redes padrão
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    fetch(`/api/clients/${clientId}`)
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || typeof d !== "object") throw new Error("cliente indisponível");
        return d as { socialAccounts?: Account[]; plan?: string; agencyPublishes?: boolean };
      })
      .then((data) => {
        if (cancelled) return;
        const accounts = (Array.isArray(data.socialAccounts) ? data.socialAccounts : []).filter(
          (a) => a.status === "active"
        );
        const agencyPublishes = data.agencyPublishes !== false;
        setClientInfo({ clientId, ok: true, accounts, plan: data.plan ?? "", agencyPublishes });
        // cliente que publica: todas as redes com conta ativa; só produção: Instagram + Facebook
        setTargets(agencyPublishes ? uniquePlatforms(accounts) : PRODUCTION_ONLY_TARGETS);
      })
      .catch(() => {
        if (!cancelled) setClientInfo({ clientId, ok: false });
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, reloadKey]);

  // derivados: só valem se os dados forem do cliente atual
  const info = clientInfo?.clientId === clientId ? clientInfo : null;
  const loadingClient = !!clientId && !info;
  const loaded = info?.ok ? info : null;
  const productionOnly = loaded ? !loaded.agencyPublishes : false;
  const availablePlatforms = loaded ? offeredPlatforms(loaded) : [];
  const contentReady = availablePlatforms.length > 0;
  const needsClientApproval = !productionOnly && loaded?.plan === "aprovacao_cliente";
  const primaryStatus: PostStatus = productionOnly ? "draft" : "scheduled";
  const clientName = clients?.find((c) => c.id === clientId)?.name ?? "Cliente";

  function retryClient() {
    setClientInfo(null);
    setReloadKey((k) => k + 1);
  }

  function toggleTarget(p: string) {
    setTargetsError(null);
    setTargets((prev) => (prev.includes(p) ? prev.filter((t) => t !== p) : [...prev, p]));
  }

  function handleScheduledChange(v: string) {
    setScheduledLocal(v);
    setDateError(null);
    setMinutesUntil(v ? minutesFromNow(v) : null);
  }

  /** Erros de preenchimento ficam junto do campo; devolve false se algo falta. */
  function validate(): boolean {
    let ok = true;
    if (targets.length === 0) {
      setTargetsError("Selecione ao menos uma rede social.");
      ok = false;
    }
    if (!scheduledLocal) {
      setDateError("Escolha a data e o horário.");
      ok = false;
    }
    return ok;
  }

  async function create(status: PostStatus, fromDialog = false) {
    setError(null);
    setDialogError(null);
    if (!clientId || !validate()) return;

    setSubmitting(status);
    const captionsForTargets = Object.fromEntries(
      targets.map((t) => [t, captions[t] ?? ""]).filter(([, v]) => v)
    );
    const hasSlides = format === "carrossel" || format === "reels";
    const data = {
      clientId,
      theme,
      format,
      captions: captionsForTargets,
      mediaUrl,
      scheduledAt: spLocalInputToISO(scheduledLocal),
      targets,
      status,
      slides: hasSlides ? slides.filter((s) => s.trim()).map((text) => ({ text })) : undefined,
    };

    let message: string;
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        // segue "carregando" até a navegação trocar de tela (evita clique duplo)
        router.push(status === "draft" ? "/posts?status=draft" : "/posts");
        router.refresh();
        return;
      }
      const d = await res.json().catch(() => null);
      // 409 CLIENT_NO_PUBLISH: o cliente virou "só produção" depois que a tela carregou
      if (res.status === 409 && d?.code === PUBLISH_BLOCKED.code) {
        setSubmitting(null);
        setConfirmingImminent(false);
        setClientInfo((prev) =>
          prev?.ok && prev.clientId === clientId ? { ...prev, agencyPublishes: false } : prev
        );
        setError(
          `${typeof d.error === "string" ? d.error : PUBLISH_BLOCKED.message} Use “Salvar post” para guardar como rascunho.`
        );
        return;
      }
      // N-14: só mostra `error` do servidor quando é texto (o 400 do zod é objeto)
      message =
        typeof d?.error === "string" ? d.error : "Não foi possível criar o post. Confira os campos e tente de novo.";
    } catch {
      message = "Falha de conexão ao criar o post. Verifique a internet e tente de novo.";
    }
    setSubmitting(null);
    // erro de uma ação do diálogo fica DENTRO dele (A-040)
    if (fromDialog) setDialogError(message);
    else setError(message);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || !contentReady) return;
    // só produção: a ação primária grava rascunho, nunca agenda
    if (productionOnly) {
      void create("draft");
      return;
    }
    if (!validate()) return;
    // recalcula na hora do envio: o formulário pode ter ficado aberto um tempo
    const mins = minutesFromNow(scheduledLocal);
    setMinutesUntil(mins);
    // agendamento quase imediato passa por confirmação antes de entrar na fila
    if (mins < IMMINENT_MINUTES) {
      setDialogError(null);
      setConfirmingImminent(true);
      return;
    }
    void create("scheduled");
  }

  const isImminent = !productionOnly && minutesUntil !== null && minutesUntil < IMMINENT_MINUTES;
  const minutesText = minutesUntil === null ? 0 : Math.max(0, Math.round(minutesUntil));

  // aviso do passo 3 quando o conteúdo ainda não pode ser escrito
  const contentBlockedText = !clientId
    ? "Escolha o cliente para escrever o conteúdo."
    : loadingClient
      ? "Carregando o cliente…"
      : !loaded
        ? "Não foi possível carregar o cliente. Tente de novo no passo 2."
        : "Conecte uma conta social do cliente para escrever o conteúdo.";

  return (
    <div className="page page--narrow animate-fade-up">
      <PageHeader title="Novo post" back="/posts" backLabel="Voltar para Posts" />

      <form onSubmit={handleSubmit} noValidate className="grid gap-6">
        {/* Passo 1 — Cliente (obrigatório, primeiro) */}
        <section aria-labelledby={stepIds.client} className="card p-4 sm:p-5">
          <StepHeading n={1} id={stepIds.client} title="Cliente" />
          <Field label="Cliente do post" labelHidden required>
            <Select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              loading={clients === null}
              placeholderOption="Selecione um cliente"
            >
              {(clients ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {clientsFailed && (
            <Callout tone="danger" className="mt-3">
              Não foi possível carregar a lista de clientes. Recarregue a página para tentar de novo.
            </Callout>
          )}
          {productionOnly && (
            <Callout tone="info" className="mt-3">
              Este cliente é só produção: o post é salvo como rascunho e nunca entra na fila.
            </Callout>
          )}
        </section>

        {/* Passo 2 — Redes (das contas do cliente; só produção não depende de conta) */}
        <section aria-labelledby={stepIds.networks} className="card p-4 sm:p-5">
          <StepHeading
            n={2}
            id={stepIds.networks}
            title="Redes sociais"
            hint={
              loaded
                ? productionOnly
                  ? "onde o post vai sair (a agência não publica)"
                  : "definidas pelas contas do cliente"
                : undefined
            }
          />

          {!clientId ? (
            <p className="text-sm text-fg-muted">Selecione um cliente para ver as redes disponíveis.</p>
          ) : loadingClient ? (
            <p aria-busy="true" className="flex items-center gap-2 text-sm text-fg-muted">
              <Spinner />
              Carregando o cliente…
            </p>
          ) : !loaded ? (
            <Callout
              tone="danger"
              title="Não foi possível carregar o cliente."
              action={
                <Button size="sm" onClick={retryClient}>
                  Tentar de novo
                </Button>
              }
            >
              Confira a conexão e tente de novo.
            </Callout>
          ) : availablePlatforms.length === 0 ? (
            <Callout tone="warning">
              Este cliente não tem contas ativas conectadas.{" "}
              <Link href={`/clients/${clientId}/accounts/new`}>Adicionar uma conta</Link> antes de agendar.
            </Callout>
          ) : (
            <>
              <div role="group" aria-labelledby={stepIds.networks} className="flex flex-wrap gap-2">
                {availablePlatforms.map((p) => {
                  const on = targets.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleTarget(p)}
                      className={`inline-flex min-h-11 items-center gap-2 rounded-control border px-4 text-sm font-medium transition-colors duration-(--sf-dur-fast) sm:min-h-10 ${
                        on
                          ? "border-link bg-hover text-fg"
                          : "border-line-strong bg-surface text-fg-muted hover:bg-hover hover:text-fg"
                      }`}
                    >
                      <PlatformChip platform={p} />
                      {PLATFORM_LABEL[p] ?? p}
                      {on && <Icon.check className="size-4 text-link" />}
                    </button>
                  );
                })}
              </div>
              {targetsError && (
                <p role="alert" className="mt-2 flex items-start gap-1 text-xs font-medium text-danger-fg">
                  <Icon.alert className="mt-px size-3.5 shrink-0 text-danger-solid" />
                  {targetsError}
                </p>
              )}
            </>
          )}
        </section>

        {/* Passo 3 — Conteúdo */}
        <section aria-labelledby={stepIds.content} className="card p-4 sm:p-5">
          <StepHeading n={3} id={stepIds.content} title="Conteúdo" />

          {!contentReady ? (
            <p className="text-sm text-fg-muted">{contentBlockedText}</p>
          ) : (
            <div className="grid gap-5">
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

              {(format === "carrossel" || format === "reels") && (
                <SlidesEditor format={format} slides={slides} onChange={setSlides} />
              )}

              <CaptionFields
                key={clientId}
                clientId={clientId}
                theme={theme}
                targets={targets}
                captions={captions}
                setCaptions={setCaptions}
                aiDisabled={!clientId}
              />

              <div>
                <MediaField value={mediaUrl} onChange={setMediaUrl} clientId={clientId} />
                {!mediaUrl && !productionOnly && (
                  <p className="mt-1.5 text-xs text-warning-fg">
                    Sem mídia a publicação falha no Instagram e no Facebook. Você pode salvar como rascunho e
                    adicionar a arte depois.
                  </p>
                )}
              </div>

              {/* prévia de como o post vai aparecer */}
              {(mediaUrl || captions.instagram || captions.facebook) && (
                <PostPreview
                  mediaUrl={mediaUrl}
                  caption={captions.instagram ?? captions.facebook ?? ""}
                  clientName={clientName}
                  targets={targets}
                  format={format}
                />
              )}
            </div>
          )}
        </section>

        {/* Passo 4 — Data: sempre visível; padrão amanhã às 18:00 (A-011, A18) */}
        <section aria-labelledby={stepIds.date} className="card p-4 sm:p-5">
          <StepHeading n={4} id={stepIds.date} title="Data" />
          <Field
            label={productionOnly ? "Data prevista" : "Agendar para"}
            required
            error={dateError}
            help={
              productionOnly ? (
                "Organiza a produção. O post não é agendado nem publicado."
              ) : isImminent ? (
                <span className="font-medium text-warning-fg">
                  {minutesUntil !== null && minutesUntil < 0
                    ? "Essa data já passou: o post entra na fila assim que for criado."
                    : `Faltam ~${minutesText} min. Vamos pedir confirmação antes de agendar.`}
                </span>
              ) : undefined
            }
          >
            <DateTimePicker
              name="scheduledAt"
              defaultValue={scheduledLocal}
              onChange={handleScheduledChange}
              required
            />
          </Field>
        </section>

        {/* o cliente é do plano com aprovação: agendar aqui pula o cronograma */}
        {needsClientApproval && (
          <Callout tone="warning" title="Este cliente é do plano “com aprovação”">
            Agendar por aqui publica <strong>sem</strong> passar pela aprovação dele. Para seguir o fluxo normal,
            salve como rascunho e envie pelo cronograma em <Link href="/aprovacoes">Aprovações</Link>.
          </Callout>
        )}

        {error && (
          <Callout tone="danger" live="assertive">
            {error}
          </Callout>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Link href="/posts" className={buttonClasses({ variant: "secondary" })}>
            Cancelar
          </Link>
          {!productionOnly && (
            <Button
              variant="secondary"
              leadingIcon={<Icon.edit />}
              onClick={() => void create("draft")}
              disabled={!contentReady || submitting === "scheduled"}
              loading={submitting === "draft"}
              loadingText="Salvando…"
              title="Cria o post fora da fila: nada é publicado até alguém aprovar"
            >
              Salvar rascunho
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            leadingIcon={productionOnly ? <Icon.check /> : <Icon.send />}
            disabled={!contentReady || (submitting !== null && submitting !== primaryStatus)}
            loading={submitting === primaryStatus}
            loadingText={productionOnly ? "Salvando…" : "Agendando…"}
          >
            {productionOnly ? "Salvar post" : "Agendar post"}
          </Button>
        </div>
      </form>

      {/* confirmação de agendamento iminente (A-039: Dialog com foco, Tab preso e Esc) */}
      <Dialog
        open={confirmingImminent}
        onClose={() => setConfirmingImminent(false)}
        title="Publicar agora?"
        description={
          minutesUntil !== null && minutesUntil < 0
            ? "A data escolhida já passou: o post entra na fila assim que for criado e vai para as redes do cliente."
            : `Faltam cerca de ${minutesText} ${minutesText === 1 ? "minuto" : "minutos"} para a data escolhida. O post vai para as redes do cliente em seguida.`
        }
        busy={submitting !== null}
        error={dialogError}
        initialFocusRef={backRef}
        footer={
          <>
            <Button ref={backRef} variant="secondary" onClick={() => setConfirmingImminent(false)} disabled={submitting !== null}>
              Voltar
            </Button>
            <Button
              variant="secondary"
              onClick={() => void create("draft", true)}
              disabled={submitting === "scheduled"}
              loading={submitting === "draft"}
              loadingText="Salvando…"
            >
              Salvar rascunho
            </Button>
            <Button
              variant="primary"
              onClick={() => void create("scheduled", true)}
              disabled={submitting === "draft"}
              loading={submitting === "scheduled"}
              loadingText="Agendando…"
            >
              Agendar assim
            </Button>
          </>
        }
      >
        {!mediaUrl && (
          <Callout tone="danger" title="Este post não tem mídia">
            A publicação vai falhar. Melhor salvar como rascunho e adicionar a arte depois.
          </Callout>
        )}
      </Dialog>
    </div>
  );
}

export default function NewPostPage() {
  return (
    <Suspense>
      <NewPostForm />
    </Suspense>
  );
}
