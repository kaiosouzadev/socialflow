"use client";

/*
 * Catálogo vivo do design system e bancada do Tester (A19), aberto por /design-system.
 * Componente de cliente (as demonstrações têm estado). Quem decide o acesso é o page.tsx
 * (servidor): só administradoras, e em produção a página nem existe (404). Não há dado real
 * aqui: só exemplos.
 */

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { Button, buttonClasses, Spinner, type ButtonVariant } from "@/components/Button";
import { Callout, type CalloutTone } from "@/components/Callout";
import { ConfirmDialog, Dialog } from "@/components/Dialog";
import { Field, Input, Select, Textarea } from "@/components/Field";
import { Icon } from "@/components/Icons";
import { Popover } from "@/components/Popover";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Toast, type ToastState } from "@/components/Toast";
import { SegmentedControl, Switch } from "@/components/Toggle";
import { EmptyState, FormatBadge, PageHeader, StatusBadge, ToneBadge, type StatusKind } from "@/components/ui";
import { clientColor } from "@/lib/client-color";
import { FORMAT, FORMAT_OPTIONS, POST_FORMATS, type PostFormat } from "@/lib/formats";
import { STAGES } from "@/lib/production";
import {
  ACCOUNT_STATUSES,
  CLIENT_STATUSES,
  labelOf,
  PENDING_KINDS,
  PLAN,
  PLANS,
  POST_STATUS,
  POST_STATUSES,
  SCHEDULE_STATUSES,
  SEGMENTS,
  TIERS,
  type Tone,
} from "@/lib/status-meta";

export default function DesignSystemCatalog() {
  return <Catalog />;
}

const SECTIONS = [
  { id: "botoes", title: "Button" },
  { id: "campos", title: "Campos" },
  { id: "alternancia", title: "Switch e Segmented" },
  { id: "avisos", title: "Callout" },
  { id: "avatares", title: "Avatar" },
  { id: "selos", title: "Badges" },
  { id: "vazios", title: "EmptyState" },
  { id: "toast", title: "Toast" },
  { id: "dialogos", title: "Dialog" },
  { id: "popover", title: "Popover" },
] as const;

function Catalog() {
  const [toast, setToast] = useState<ToastState>(null);

  return (
    <div className="page">
      <PageHeader
        title="Design system"
        subtitle="Catálogo vivo dos componentes do sistema, nos estados que as telas usam."
        back="/"
        backLabel="Voltar ao dashboard"
        badges={
          <>
            <ToneBadge tone="accent">Só administradores</ToneBadge>
            <ToneBadge tone="neutral" icon={<Icon.eyeOff />}>
              Fora do menu
            </ToneBadge>
          </>
        }
        action={<ThemeToggle variant="labeled" />}
      />

      <nav aria-label="Seções do catálogo" className="mb-6 flex flex-wrap gap-1">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className={buttonClasses({ variant: "ghost", size: "sm" })}>
            {s.title}
          </a>
        ))}
      </nav>

      <div className="grid gap-6">
        <ButtonsSection />
        <FieldsSection />
        <TogglesSection />
        <CalloutsSection />
        <AvatarsSection />
        <BadgesSection />
        <EmptyStatesSection />
        <ToastsSection notify={setToast} />
        <DialogsSection notify={setToast} />
        <PopoverSection notify={setToast} />
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className="card scroll-mt-20 p-4 sm:p-5">
      <h2 id={`${id}-titulo`} className="font-display text-xl font-semibold tracking-title">
        {title}
      </h2>
      {description && <p className="mt-1 max-w-prose text-sm text-fg-muted">{description}</p>}
      <div className="mt-4 grid gap-5">{children}</div>
    </section>
  );
}

function Group({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-overline text-fg-muted">{title}</h3>
      <div className={className || "flex flex-wrap items-center gap-2"}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Button
 * ------------------------------------------------------------------ */

const VARIANTS: { id: ButtonVariant; label: string }[] = [
  { id: "primary", label: "Primária" },
  { id: "secondary", label: "Secundária" },
  { id: "ghost", label: "Fantasma" },
  { id: "danger", label: "Perigo" },
];

function ButtonsSection() {
  const [saving, setSaving] = useState(false);

  function save() {
    setSaving(true);
    setTimeout(() => setSaving(false), 1500);
  }

  return (
    <Section
      id="botoes"
      title="Button"
      description="Variantes × estados. Hover, foco e pressionado aparecem ao interagir. Altura mínima: sm 40/32, md 44/40 e lg 48 px (abaixo/acima de 640 px)."
    >
      {VARIANTS.map((v) => (
        <Group key={v.id} title={v.label}>
          <Button variant={v.id}>Salvar rascunho</Button>
          <Button variant={v.id} disabled>
            Desabilitado
          </Button>
          <Button variant={v.id} loading loadingText="Salvando…">
            Salvar rascunho
          </Button>
          <Button variant={v.id} iconOnly aria-label="Editar post">
            <Icon.edit />
          </Button>
          <Button variant={v.id} iconOnly aria-label="Editar post" loading>
            <Icon.edit />
          </Button>
        </Group>
      ))}

      <Group title="Tamanhos">
        <Button variant="primary" size="sm">
          Pequeno
        </Button>
        <Button variant="primary" size="md">
          Médio
        </Button>
        <Button variant="primary" size="lg">
          Grande
        </Button>
        <Button size="sm" iconOnly aria-label="Excluir post">
          <Icon.trash />
        </Button>
        <Button size="md" iconOnly aria-label="Excluir post">
          <Icon.trash />
        </Button>
        <Button size="lg" iconOnly aria-label="Excluir post">
          <Icon.trash />
        </Button>
      </Group>

      <Group title="Ícones, carregando de verdade e link">
        <Button variant="primary" leadingIcon={<Icon.plus />}>
          Novo post
        </Button>
        <Button trailingIcon={<Icon.arrowRight />}>Continuar</Button>
        <Button variant="primary" leadingIcon={<Icon.check />} loading={saving} loadingText="Salvando…" onClick={save}>
          Salvar cliente
        </Button>
        <Link href="/posts/new" className={buttonClasses({ variant: "secondary" })}>
          Link com cara de botão
        </Link>
      </Group>

      <Group title="Largura total" className="grid max-w-sm gap-2">
        <Button variant="primary" fullWidth>
          Enviar ao cliente
        </Button>
        <Button fullWidth>Botão de largura total com um texto maior, que pode quebrar em duas linhas</Button>
      </Group>

      <Group title="Spinner">
        <Spinner />
        <Spinner size={20} label="Carregando a lista de exemplo" />
      </Group>

      <TypeTest />
    </Section>
  );
}

/**
 * Teste de tipo do S12 (A-014): botão só com ícone SEM aria-label não compila.
 * Se o erro deixasse de existir, o próprio @ts-expect-error quebraria o tsc.
 * Fica oculto (hidden): é só para o compilador.
 */
function TypeTest() {
  return (
    <div hidden>
      {/* @ts-expect-error falta aria-label: botão só com ícone exige nome acessível (A-014) */}
      <Button iconOnly><Icon.x /></Button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Field, Input, Textarea, Select
 * ------------------------------------------------------------------ */

function FieldsSection() {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <Section
      id="campos"
      title="Field, Input, Textarea e Select"
      description="Clicar no rótulo foca o controle. Ajuda e erro chegam ao leitor de tela por aria-describedby; o erro marca aria-invalid."
    >
      <form noValidate onSubmit={(e) => e.preventDefault()} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome do cliente" help="Como aparece nos cronogramas e no link de aprovação.">
          <Input name="nome" placeholder="Ex.: Padaria Central" autoComplete="off" />
        </Field>
        <Field label="E-mail principal" required error="'contato@' não é um e-mail válido.">
          <Input name="email" type="email" defaultValue="contato@" autoComplete="off" />
        </Field>
        <Field label="Buscar posts" labelHidden help="Rótulo só para leitor de tela (labelHidden) e ícone à esquerda.">
          <Input type="search" placeholder="Buscar por tema ou cliente" leadingIcon={<Icon.search />} />
        </Field>
        <Field label="Senha do Instagram" help="Fica criptografada no banco.">
          <Input
            type={showPassword ? "text" : "password"}
            defaultValue="senha-de-exemplo"
            autoComplete="off"
            trailingSlot={
              <Button
                iconOnly
                variant="ghost"
                size="sm"
                aria-label="Mostrar senha"
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <Icon.eyeOff /> : <Icon.eye />}
              </Button>
            }
          />
        </Field>
        <Field label="ID da conta na rede" help="Somente leitura: vem da conexão com a Meta.">
          <Input readOnly defaultValue="17841400000000000" className="font-mono" />
        </Field>
        <Field label="Limite diário de posts" optional help="Tamanho sm (32 px acima de 640 px).">
          <Input type="number" size="sm" min={1} max={50} defaultValue={25} inputMode="numeric" />
        </Field>
        <Field label="Campo desabilitado">
          <Input disabled defaultValue="Não editável agora" />
        </Field>
        <Field label="Plano">
          <Select name="plano" placeholderOption="Selecione…" defaultValue="">
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {labelOf(PLAN, p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Redatora" help="Select carregando as opções.">
          <Select loading />
        </Field>
        <Field label="Segmento" error="Escolha um segmento.">
          <Select placeholderOption="Selecione…" defaultValue="">
            {SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Legenda" help="Até 280 caracteres." className="sm:col-span-2">
          <Textarea
            maxLength={280}
            showCount
            defaultValue="Outubro chegou com novidade no forno: pão de fermentação natural todo sábado."
          />
        </Field>
        <Field label="LinkedIn" kind="group" help="Checkbox nativo dentro de um rótulo de 44/40 px.">
          <label className="flex min-h-11 items-center gap-3 text-sm sm:min-h-10">
            <input type="checkbox" defaultChecked className="size-4.5 rounded-chip accent-selected" />
            Repostar os posts na Company Page
          </label>
        </Field>
      </form>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Switch e SegmentedControl
 * ------------------------------------------------------------------ */

const PERIODS = [
  { value: "semana", label: "Semana" },
  { value: "mes", label: "Mês" },
] as const;

function TogglesSection() {
  const [digest, setDigest] = useState(false);
  const [publishes, setPublishes] = useState(true);
  const [savingSwitch, setSavingSwitch] = useState(false);
  const [savedValue, setSavedValue] = useState(true);
  const [compact, setCompact] = useState(true);
  const [terms, setTerms] = useState(false);
  const [view, setView] = useState<"calendario" | "feed" | "lista">("calendario");
  const [period, setPeriod] = useState<"semana" | "mes">("mes");
  const [layout, setLayout] = useState<"grade" | "lista">("grade");
  const [preview, setPreview] = useState<"claro" | "escuro" | "sistema">("sistema");
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [publica, setPublica] = useState<"sim" | "nao" | "">("");

  function toggleWithSave(next: boolean) {
    setSavingSwitch(true);
    setTimeout(() => {
      setSavedValue(next);
      setSavingSwitch(false);
    }, 1200);
  }

  function changePeriodWithSave(next: "semana" | "mes") {
    setSavingPeriod(true);
    setTimeout(() => {
      setPeriod(next);
      setSavingPeriod(false);
    }, 1200);
  }

  return (
    <Section
      id="alternancia"
      title="Switch e SegmentedControl"
      description="O estado nunca depende só da cor: o Switch mostra Sim/Não e a opção escolhida fica preenchida. No SegmentedControl, um único Tab e as setas trocam a opção."
    >
      <Group title="Switch" className="grid gap-1 sm:grid-cols-2">
        <Switch label="Receber resumo diário" checked={digest} onCheckedChange={setDigest} />
        <Switch
          label="Agendar posts?"
          stateLabels={{ on: "Sim", off: "Não" }}
          checked={publishes}
          onCheckedChange={setPublishes}
        />
        <Switch label="Desligado e desabilitado" checked={false} disabled onCheckedChange={() => {}} />
        <Switch label="Ligado e desabilitado" checked disabled onCheckedChange={() => {}} />
        <Switch
          label="Salva ao alternar"
          stateLabels={{ on: "Sim", off: "Não" }}
          checked={savedValue}
          loading={savingSwitch}
          onCheckedChange={toggleWithSave}
        />
        <Switch size="sm" label="Compacto (sm)" checked={compact} onCheckedChange={setCompact} />
        <Switch
          aria-label="Notificar a redatora"
          stateLabels={{ on: "Notificar", off: "Não notificar" }}
          checked={digest}
          onCheckedChange={setDigest}
        />
      </Group>

      <Field label="Aceito os termos de uso" error={terms ? null : "Ative para continuar."}>
        <Switch aria-label="Aceito os termos de uso" checked={terms} onCheckedChange={setTerms} />
      </Field>

      <Group title="SegmentedControl">
        <SegmentedControl
          aria-label="Visualização"
          value={view}
          onChange={setView}
          options={[
            { value: "calendario", label: "Calendário" },
            { value: "feed", label: "Feed" },
            { value: "lista", label: "Lista", disabled: true },
          ]}
        />
        <SegmentedControl aria-label="Período" size="sm" value={period} onChange={setPeriod} options={PERIODS} />
        <SegmentedControl
          aria-label="Layout"
          value={layout}
          onChange={setLayout}
          options={[
            { value: "grade", label: "Grade", icon: <Icon.grid />, hideLabel: true },
            { value: "lista", label: "Lista", icon: <Icon.list />, hideLabel: true },
          ]}
        />
        <SegmentedControl aria-label="Período (desabilitado)" disabled value="mes" onChange={() => {}} options={PERIODS} />
        <SegmentedControl
          aria-label="Período (salva ao trocar)"
          loading={savingPeriod}
          value={period}
          onChange={changePeriodWithSave}
          options={PERIODS}
        />
      </Group>

      <Group title="Largura total" className="max-w-md">
        <SegmentedControl
          fullWidth
          aria-label="Tema da prévia"
          value={preview}
          onChange={setPreview}
          options={[
            { value: "claro", label: "Claro", icon: <Icon.sun /> },
            { value: "escuro", label: "Escuro", icon: <Icon.moon /> },
            { value: "sistema", label: "Sistema", icon: <Icon.monitor /> },
          ]}
        />
      </Group>

      <Field
        kind="group"
        id="ds-publica"
        label="Agendar os posts deste cliente?"
        help="Sim: os posts são agendados e publicados automaticamente pelo sistema nas redes do cliente. Não: só produção — os posts nunca entram na fila de publicação."
        error={publica === "" ? "Escolha Sim ou Não." : null}
      >
        <SegmentedControl
          aria-labelledby="ds-publica-label"
          value={publica}
          onChange={setPublica}
          options={[
            { value: "sim", label: "Sim" },
            { value: "nao", label: "Não" },
          ]}
        />
      </Field>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Callout
 * ------------------------------------------------------------------ */

const CALLOUTS: { tone: CalloutTone; title: string; body: string }[] = [
  { tone: "info", title: "O token é criptografado", body: "Ninguém da equipe vê o valor depois de salvo." },
  { tone: "success", title: "Cronograma enviado", body: "O cliente recebeu o link de aprovação de outubro." },
  { tone: "warning", title: "3 posts sem arte", body: "Eles saem da fila se a arte não chegar até quinta-feira." },
  { tone: "danger", title: "Não foi possível sincronizar", body: "O Drive não respondeu. Nada foi alterado." },
];

const TONE_NAME: Record<CalloutTone, string> = {
  info: "informação",
  success: "sucesso",
  warning: "atenção",
  danger: "perigo",
};

function CalloutsSection() {
  const [dismissed, setDismissed] = useState<CalloutTone[]>([]);

  return (
    <Section
      id="avisos"
      title="Callout"
      description="Aviso informativo é info, não warning. Erro que surge de uma ação usa live=assertive (role=alert)."
    >
      <div className="grid gap-3 lg:grid-cols-2">
        {CALLOUTS.map((c) => (
          <Callout key={c.tone} tone={c.tone} title={c.title}>
            {c.body}
          </Callout>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Callout
          tone="danger"
          title="Não foi possível contar os posts agendados"
          action={
            <Button size="sm" leadingIcon={<Icon.refresh />}>
              Tentar de novo
            </Button>
          }
        >
          A confirmação fica desabilitada até a contagem carregar.
        </Callout>
        <Callout tone="info" icon={false}>
          Sem ícone e com um <a href="#avisos">link interno</a> sublinhado.
        </Callout>
        {CALLOUTS.filter((c) => !dismissed.includes(c.tone)).map((c) => (
          <Callout key={`fechar-${c.tone}`} tone={c.tone} onDismiss={() => setDismissed((d) => [...d, c.tone])}>
            Aviso de {TONE_NAME[c.tone]} que pode ser fechado.
          </Callout>
        ))}
      </div>
      {dismissed.length > 0 && (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setDismissed([])}>
            Mostrar os avisos fechados
          </Button>
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Avatar
 * ------------------------------------------------------------------ */

const AVATAR_SIZES = ["xs", "sm", "md", "lg"] as const;
const SAMPLE_CLIENTS = ["Padaria Central", "Clínica Bem Viver", "Studio Aurora"];

function AvatarsSection() {
  return (
    <Section
      id="avatares"
      title="Avatar"
      description="Iniciais sobre neutral-bg. A cor do cliente é dado: só aparece como anel, nunca como fundo."
    >
      <Group title="Pessoa (circle): xs, sm, md e lg">
        {AVATAR_SIZES.map((s) => (
          <Avatar key={s} name="Pamela Souza" size={s} decorative={false} />
        ))}
      </Group>
      <Group title="Cliente (square) com a cor do cliente no anel">
        {SAMPLE_CLIENTS.map((c) => (
          <span key={c} className="inline-flex items-center gap-2 pr-3 text-sm">
            {/* cor-de-dado */}
            <Avatar name={c} shape="square" color={clientColor(c)} />
            {c}
          </span>
        ))}
      </Group>
      <Group title="Imagem, imagem quebrada (volta às iniciais), sem nome e carregando">
        <Avatar name="Logo do Grupo Coletivo" src="/icon.png" size="lg" shape="square" decorative={false} />
        <Avatar name="Stella Lima" src="data:image/png;base64,AAAA" size="lg" decorative={false} />
        <Avatar name="" size="lg" decorative={false} />
        <span aria-hidden="true" className="skeleton size-12 rounded-full" />
      </Group>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Badges
 * ------------------------------------------------------------------ */

const STATUS_KINDS: { kind: StatusKind; values: readonly string[] }[] = [
  { kind: "post", values: POST_STATUSES },
  { kind: "schedule", values: SCHEDULE_STATUSES },
  { kind: "client", values: CLIENT_STATUSES },
  { kind: "segment", values: SEGMENTS },
  { kind: "plan", values: PLANS },
  { kind: "tier", values: TIERS },
  { kind: "account", values: ACCOUNT_STATUSES },
  { kind: "pending", values: PENDING_KINDS },
  { kind: "agencyPublishes", values: ["sim", "nao"] },
  { kind: "stage", values: STAGES.map((s) => s.id) },
];

const TONES: { tone: Tone; label: string }[] = [
  { tone: "neutral", label: "Neutro" },
  { tone: "info", label: "Informação" },
  { tone: "success", label: "Sucesso" },
  { tone: "warning", label: "Atenção" },
  { tone: "danger", label: "Perigo" },
  { tone: "accent", label: "Destaque" },
];

function BadgesSection() {
  return (
    <Section
      id="selos"
      title="StatusBadge, ToneBadge e FormatBadge"
      description="Rótulo e tom vêm só do lib/status-meta: o mesmo status tem o mesmo tom em todas as telas. Valor fora do mapa vira “Status desconhecido”."
    >
      {STATUS_KINDS.map((k) => (
        <Group key={k.kind} title={`kind = ${k.kind}`}>
          {k.values.map((v) => (
            <StatusBadge key={v} kind={k.kind} status={v} />
          ))}
        </Group>
      ))}
      <Group title="Valor desconhecido, legado e tamanho md">
        <StatusBadge status="arquivado_v2" />
        <StatusBadge status="active" />
        <StatusBadge status="scheduled" size="md" />
        <StatusBadge kind="stage" status="em_aprovacao" size="md" />
        <StatusBadge kind="client" status="pausado" size="md" />
      </Group>
      <Group title="ToneBadge">
        {TONES.map((t) => (
          <ToneBadge key={t.tone} tone={t.tone}>
            {t.label}
          </ToneBadge>
        ))}
        <ToneBadge tone="warning" icon={<Icon.alert />}>
          3 pendências abertas
        </ToneBadge>
        <ToneBadge tone="accent" size="md" title="Posts deste cliente não são agendados pelo sistema">
          Só produção
        </ToneBadge>
      </Group>
      <Group title="FormatBadge (sm e md)">
        {POST_FORMATS.map((f) => (
          <FormatBadge key={f} format={f} />
        ))}
        {POST_FORMATS.map((f) => (
          <FormatBadge key={`md-${f}`} format={f} size="md" />
        ))}
      </Group>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * EmptyState
 * ------------------------------------------------------------------ */

function EmptyStatesSection() {
  return (
    <Section id="vazios" title="EmptyState" description="O que está vazio, por quê e a próxima ação. Nunca durante o carregamento.">
      <div className="grid gap-4 lg:grid-cols-2">
        <EmptyState
          headingLevel={3}
          title="Nada agendado para hoje"
          description="Os posts de hoje aparecem aqui quando entram na fila de publicação."
          action={
            <Link href="/posts/new" className={buttonClasses({ variant: "primary" })}>
              Novo post
            </Link>
          }
        />
        <EmptyState
          headingLevel={3}
          tone="error"
          icon={<Icon.alert />}
          title="Não foi possível carregar os cronogramas"
          description="Verifique a conexão e tente de novo."
          action={<Button leadingIcon={<Icon.refresh />}>Tentar de novo</Button>}
        />
      </div>
      <div className="card">
        <EmptyState
          headingLevel={3}
          size="inline"
          title="Nenhum post com esses filtros"
          description="Mude o cliente ou o período para ver outros posts."
          action={<Button variant="ghost">Limpar filtros</Button>}
        />
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Toast
 * ------------------------------------------------------------------ */

function ToastsSection({ notify }: { notify: (t: ToastState) => void }) {
  return (
    <Section
      id="toast"
      title="Toast"
      description="Embaixo e centralizado, para não cobrir as ações de linha. Sucesso e informação somem em 5 s (mouse ou foco em cima pausam); erro fica até fechar."
    >
      <Group title="Disparar">
        <Button
          onClick={() =>
            notify({
              kind: "success",
              text: "Post agendado para 12/10 às 18:00.",
              action: { label: "Ver posts", href: "/posts" },
            })
          }
        >
          Sucesso com ação
        </Button>
        <Button onClick={() => notify({ kind: "error", text: "Não foi possível copiar o link. Copie manualmente." })}>
          Erro
        </Button>
        <Button onClick={() => notify({ kind: "info", text: "Sincronização iniciada. Pode levar alguns minutos." })}>
          Informação
        </Button>
      </Group>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Dialog e ConfirmDialog (com Popover dentro)
 * ------------------------------------------------------------------ */

const LONG_TEXT = Array.from(
  { length: 14 },
  (_, i) =>
    `${i + 1}. O link de aprovação mostra os temas do mês e, depois, os posts completos da semana. Cada resposta do cliente fica registrada com data e hora, e a equipe recebe um aviso quando há ajuste pedido.`,
);

function DialogsSection({ notify }: { notify: (t: ToastState) => void }) {
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [publishes, setPublishes] = useState(true);
  const [format, setFormat] = useState<PostFormat>("feed");
  const [formatOpen, setFormatOpen] = useState(false);
  const formatRef = useRef<HTMLButtonElement>(null);

  const [longOpen, setLongOpen] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [approveOpen, setApproveOpen] = useState(false);
  const [approving, setApproving] = useState(false);

  function closeForm() {
    setFormOpen(false);
    setFormatOpen(false);
    setDirty(false);
  }

  // fechar com alterações pede confirmação (padrão do "Revisar cronograma")
  function requestCloseForm() {
    if (dirty) setDiscardOpen(true);
    else closeForm();
  }

  function saveForm(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      closeForm();
      notify({ kind: "success", text: "Cliente salvo." });
    }, 1000);
  }

  function confirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    setTimeout(() => {
      setDeleting(false);
      setDeleteError("Não foi possível excluir o cliente agora. Nada foi apagado. Tente de novo.");
    }, 900);
  }

  function confirmApprove() {
    setApproving(true);
    setTimeout(() => {
      setApproving(false);
      setApproveOpen(false);
      notify({ kind: "success", text: "Cronograma aprovado. 8 posts entraram na fila." });
    }, 900);
  }

  return (
    <Section
      id="dialogos"
      title="Dialog e ConfirmDialog"
      description="<dialog> nativo: o foco fica preso dentro, Esc fecha, o foco volta ao botão que abriu e a página não rola por trás. O erro de uma ação aparece dentro do diálogo."
    >
      <Group title="Abrir">
        <Button variant="primary" onClick={() => setFormOpen(true)}>
          Editar cliente
        </Button>
        <Button onClick={() => setLongOpen(true)}>Ler as regras do link</Button>
        <Button
          variant="danger"
          leadingIcon={<Icon.trash />}
          onClick={() => {
            setDeleteError(null);
            setDeleteOpen(true);
          }}
        >
          Excluir cliente (erro forçado)
        </Button>
        <Button onClick={() => setApproveOpen(true)}>Aprovar cronograma</Button>
      </Group>

      <Dialog
        open={formOpen}
        onClose={requestCloseForm}
        title="Editar cliente"
        description="Padaria Central · as mudanças valem para os próximos posts."
        busy={saving}
        footer={
          <>
            <Button onClick={requestCloseForm} disabled={saving}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" form="ds-form-cliente" loading={saving} loadingText="Salvando…">
              Salvar alterações
            </Button>
          </>
        }
      >
        <form id="ds-form-cliente" noValidate onSubmit={saveForm} onChange={() => setDirty(true)} className="grid gap-4 pb-2">
          <Field label="Nome do cliente">
            <Input name="nome" defaultValue="Padaria Central" autoComplete="off" />
          </Field>
          <Field label="E-mail principal" help="Recebe o link mensal e o semanal.">
            <Input name="email" type="email" defaultValue="contato@example.com" autoComplete="off" />
          </Field>
          <Field label="Plano">
            <Select name="plano" defaultValue="aprovacao_cliente">
              {PLANS.map((p) => (
                <option key={p} value={p}>
                  {labelOf(PLAN, p)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="ds-formato-campo" label="Formato padrão" help="Popover dentro do diálogo: Esc fecha só o painel.">
            <Button
              ref={formatRef}
              id="ds-formato-campo"
              fullWidth
              trailingIcon={<Icon.chevronDown />}
              aria-haspopup="dialog"
              aria-expanded={formatOpen}
              aria-controls="ds-formato"
              onClick={() => setFormatOpen((o) => !o)}
            >
              {FORMAT[format].label}
            </Button>
          </Field>
          <Popover
            open={formatOpen}
            onOpenChange={setFormatOpen}
            anchorRef={formatRef}
            id="ds-formato"
            aria-label="Escolher formato"
            matchAnchorWidth
            className="p-1.5"
          >
            <div className="grid gap-0.5">
              {FORMAT_OPTIONS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={format === f.id}
                  onClick={() => {
                    setFormat(f.id);
                    setDirty(true);
                    setFormatOpen(false);
                  }}
                  className="flex min-h-10 w-full items-center justify-between gap-2 rounded-control px-2.5 text-left text-sm text-fg hover:bg-hover"
                >
                  <FormatBadge format={f.id} />
                  {format === f.id && <Icon.check className="size-4 text-fg-muted" />}
                </button>
              ))}
            </div>
          </Popover>
          <Field label="Observações internas" optional>
            <Textarea name="observacoes" rows={3} />
          </Field>
          <Switch
            label="Agendar os posts?"
            stateLabels={{ on: "Sim", off: "Não" }}
            checked={publishes}
            onCheckedChange={(v) => {
              setPublishes(v);
              setDirty(true);
            }}
          />
        </form>
      </Dialog>

      <ConfirmDialog
        open={discardOpen}
        tone="danger"
        title="Descartar as alterações?"
        description="O que você mudou neste cliente ainda não foi salvo."
        confirmLabel="Descartar alterações"
        cancelLabel="Continuar editando"
        onConfirm={() => {
          setDiscardOpen(false);
          closeForm();
        }}
        onCancel={() => setDiscardOpen(false)}
      />

      <Dialog
        open={longOpen}
        onClose={() => setLongOpen(false)}
        size="lg"
        title="Regras do link de aprovação"
        description="Texto longo: o corpo rola por dentro e entra na ordem de Tab."
        footer={
          <Button variant="primary" onClick={() => setLongOpen(false)}>
            Entendi as regras
          </Button>
        }
      >
        <div className="grid gap-3 pb-2 text-sm text-fg">
          {LONG_TEXT.map((p) => (
            <p key={p.slice(0, 3)}>{p}</p>
          ))}
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        tone="danger"
        title="Excluir o cliente Padaria Central?"
        description="Demonstração com erro forçado: a exclusão sempre falha."
        consequences={[
          "12 posts agendados voltam a rascunho e saem da fila.",
          "O link de aprovação de outubro deixa de funcionar.",
          "As artes no Drive não são apagadas.",
        ]}
        confirmLabel="Excluir cliente"
        busy={deleting}
        busyLabel="Excluindo…"
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteOpen(false)}
      />

      <ConfirmDialog
        open={approveOpen}
        title="Aprovar o cronograma de outubro?"
        consequences={["8 rascunhos entram na fila de publicação.", "O cliente recebe um e-mail de confirmação."]}
        confirmLabel="Aprovar cronograma"
        busy={approving}
        busyLabel="Aprovando…"
        onConfirm={confirmApprove}
        onCancel={() => setApproveOpen(false)}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * Popover numa lista rolável e colado na borda
 * ------------------------------------------------------------------ */

const LIST_ITEMS = Array.from({ length: 14 }, (_, i) => `Post ${String(i + 1).padStart(2, "0")} · Padaria Central`);

const ITEM_ACTIONS = [
  { label: "Editar", icon: Icon.edit },
  { label: "Duplicar", icon: Icon.copy },
  { label: "Excluir", icon: Icon.trash },
] as const;

function PopoverSection({ notify }: { notify: (t: ToastState) => void }) {
  const itemAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [openItem, setOpenItem] = useState<number | null>(null);
  const edgeRef = useRef<HTMLButtonElement>(null);
  const [edgeOpen, setEdgeOpen] = useState(false);

  function toggleItem(index: number, trigger: HTMLButtonElement) {
    if (openItem === index) {
      setOpenItem(null);
      return;
    }
    itemAnchorRef.current = trigger;
    setOpenItem(index);
  }

  function runAction(label: string) {
    const item = openItem !== null ? LIST_ITEMS[openItem] : "";
    setOpenItem(null);
    notify({ kind: "info", text: `${label}: ${item} (exemplo, nada foi alterado).` });
  }

  return (
    <Section
      id="popover"
      title="Popover"
      description="Portal com posição fixa: não é cortado pela lista rolável e inverte para cima perto da borda. Role a página até a lista encostar na borda de baixo da janela e abra as ações do último item. “Filtros”, colado na borda direita, desloca o painel para dentro da tela."
    >
      <div className="flex justify-end">
        <Button
          ref={edgeRef}
          trailingIcon={<Icon.chevronDown />}
          aria-haspopup="dialog"
          aria-expanded={edgeOpen}
          aria-controls="ds-filtros"
          onClick={() => setEdgeOpen((o) => !o)}
        >
          Filtros
        </Button>
      </div>
      <Popover
        open={edgeOpen}
        onOpenChange={setEdgeOpen}
        anchorRef={edgeRef}
        placement="bottom-start"
        id="ds-filtros"
        aria-label="Filtros"
        className="w-80"
      >
        <div className="grid gap-3">
          <Field label="Status do post">
            <Select defaultValue="" placeholderOption="Todos">
              {POST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {labelOf(POST_STATUS, s)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEdgeOpen(false)}>
              Limpar filtros
            </Button>
            <Button size="sm" variant="primary" onClick={() => setEdgeOpen(false)}>
              Aplicar filtros
            </Button>
          </div>
        </div>
      </Popover>

      <ul
        id="ds-lista-rolavel"
        aria-label="Posts de outubro (lista rolável)"
        className="max-h-72 divide-y divide-line overflow-y-auto rounded-card border border-line"
      >
        {LIST_ITEMS.map((item, i) => (
          <li key={item} className="flex min-h-12 items-center justify-between gap-3 px-3 py-1 text-sm">
            <span className="min-w-0 truncate">{item}</span>
            <Button
              iconOnly
              variant="ghost"
              size="sm"
              aria-label={`Ações de ${item}`}
              aria-haspopup="dialog"
              aria-expanded={openItem === i}
              aria-controls={openItem === i ? "ds-acoes" : undefined}
              onClick={(e) => toggleItem(i, e.currentTarget)}
            >
              <Icon.moreHorizontal />
            </Button>
          </li>
        ))}
      </ul>
      <Popover
        key={openItem ?? "fechado"}
        open={openItem !== null}
        onOpenChange={(o) => {
          if (!o) setOpenItem(null);
        }}
        anchorRef={itemAnchorRef}
        placement="bottom-end"
        id="ds-acoes"
        aria-label={openItem !== null ? `Ações de ${LIST_ITEMS[openItem]}` : "Ações"}
        className="w-56 p-1.5"
      >
        <div className="grid gap-0.5">
          {ITEM_ACTIONS.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => runAction(a.label)}
              className="flex min-h-10 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-sm text-fg hover:bg-hover"
            >
              <a.icon className="size-4 shrink-0 text-fg-muted" />
              {a.label}
            </button>
          ))}
        </div>
      </Popover>
    </Section>
  );
}
