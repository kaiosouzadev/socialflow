import Link from "next/link";
import { STAGES, type ProductionStage } from "@/lib/production";
import { FORMAT, POST_FORMATS, type PostFormat } from "@/lib/formats";
import { SEGMENT, labelOf } from "@/lib/status-meta";
import { StatusBadge } from "@/components/ui";
import { Icon } from "@/components/Icons";

/*
 * Quadro de Produção (S31, DESIGN g.1): grade cliente × dia, resumo do mês e
 * legenda "Como ler o quadro". Componente de servidor: o modelo (inclusive o
 * aria-label de cada marcador) chega pronto da página (H-13).
 */

export type MarkerIssue = "failed" | "adjustment" | "waitingMaterial";
export type MarkerPublication = "scheduled" | "published";

export type MarkerModel = {
  postId: string;
  day: number;
  format: PostFormat;
  stage: ProductionStage;
  hasArt: boolean;
  late: boolean;
  /** selo do canto superior (no máximo 1, por prioridade) */
  issue: MarkerIssue | null;
  /** selo do canto inferior; rascunho = sem selo */
  publication: MarkerPublication | null;
  ariaLabel: string;
};

export type RowModel = {
  client: {
    id: string;
    name: string;
    writerName: string | null;
    segment: string | null;
    withApproval: boolean;
    agencyPublishes: boolean;
    status: string;
  };
  /** dia do mês → marcadores na ordem de scheduledAt */
  days: Map<number, MarkerModel[]>;
  totals: Record<ProductionStage, number>;
  total: number;
};

export type DayColumn = {
  day: number;
  /** "seg", "ter"… */
  weekday: string;
  /** "segunda-feira"… */
  weekdayFull: string;
  weekend: boolean;
  today: boolean;
  /** coluna até onde a grade rola ao abrir o mês atual ("hoje" − 2) */
  scrollAnchor: boolean;
};

export type BoardModel = {
  monthLabel: string;
  days: DayColumn[];
  rows: RowModel[];
  totals: Record<ProductionStage, number>;
  late: number;
  total: number;
};

/* Mapas estáticos (H-03): o Tailwind só gera classes escritas por inteiro. */
const STAGE_FILLED: Record<ProductionStage, string> = {
  sem_texto: "bg-stage-sem-texto-fill text-stage-sem-texto-on border-stage-sem-texto-solid",
  texto_ok: "bg-stage-texto-ok-fill text-stage-texto-ok-on border-stage-texto-ok-solid",
  em_aprovacao: "bg-stage-em-aprovacao-fill text-stage-em-aprovacao-on border-stage-em-aprovacao-solid",
  tema_aprovado: "bg-stage-tema-aprovado-fill text-stage-tema-aprovado-on border-stage-tema-aprovado-solid",
  post_aprovado: "bg-stage-post-aprovado-fill text-stage-post-aprovado-on border-stage-post-aprovado-solid",
};
const STAGE_HOLLOW: Record<ProductionStage, string> = {
  sem_texto: "bg-surface text-stage-sem-texto-text border-stage-sem-texto-solid",
  texto_ok: "bg-surface text-stage-texto-ok-text border-stage-texto-ok-solid",
  em_aprovacao: "bg-surface text-stage-em-aprovacao-text border-stage-em-aprovacao-solid",
  tema_aprovado: "bg-surface text-stage-tema-aprovado-text border-stage-tema-aprovado-solid",
  post_aprovado: "bg-surface text-stage-post-aprovado-text border-stage-post-aprovado-solid",
};
/** Formato = forma (nunca só cor): feed quadrado, carrossel com cartão atrás, reels círculo, story tracejado. */
const SHAPE: Record<PostFormat, string> = {
  feed: "rounded-chip",
  carrossel: "rounded-chip",
  reels: "rounded-full",
  story: "rounded-chip border-dashed",
};
/**
 * Sombras do marcador: cartão de trás do carrossel (3 px acima/à direita) e anel
 * de atraso (2 px surface + 2 px danger). O foco usa `outline`, então os dois convivem.
 */
const MARKER_SHADOW = {
  plain: "hover:shadow-raised",
  card: "shadow-[3px_-3px_0_-1.5px_var(--sf-surface),3px_-3px_0_0_var(--sf-line-strong)] hover:shadow-[3px_-3px_0_-1.5px_var(--sf-surface),3px_-3px_0_0_var(--sf-line-strong),var(--sf-shadow-raised)]",
  late: "shadow-[0_0_0_2px_var(--sf-surface),0_0_0_4px_var(--sf-danger-solid)] hover:shadow-[0_0_0_2px_var(--sf-surface),0_0_0_4px_var(--sf-danger-solid),var(--sf-shadow-raised)]",
  cardLate:
    "shadow-[3px_-3px_0_-1.5px_var(--sf-surface),3px_-3px_0_0_var(--sf-line-strong),0_0_0_2px_var(--sf-surface),0_0_0_4px_var(--sf-danger-solid)] hover:shadow-[3px_-3px_0_-1.5px_var(--sf-surface),3px_-3px_0_0_var(--sf-line-strong),0_0_0_2px_var(--sf-surface),0_0_0_4px_var(--sf-danger-solid),var(--sf-shadow-raised)]",
} as const;
/** Amostras da legenda (sem hover). */
const SAMPLE_SHADOW = {
  card: "shadow-[3px_-3px_0_-1.5px_var(--sf-surface),3px_-3px_0_0_var(--sf-line-strong)]",
  late: "shadow-[0_0_0_2px_var(--sf-surface),0_0_0_4px_var(--sf-danger-solid)]",
} as const;

const ISSUE_BADGE: Record<MarkerIssue, string> = {
  failed: "bg-danger-solid",
  adjustment: "bg-warning-solid",
  waitingMaterial: "bg-info-solid",
};
const PUBLICATION_BADGE: Record<MarkerPublication, string> = {
  scheduled: "bg-info-solid",
  published: "bg-success-solid",
};

type GlyphKind = MarkerIssue | MarkerPublication;

/** Glifo de 8 px dos selos (traço mais grosso que o dos ícones de 24 px, para ler pequeno). */
function Glyph({ kind }: { kind: GlyphKind }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-2"
    >
      {kind === "failed" && <path d="M12 4v10M12 20h.01" />}
      {kind === "adjustment" && <path d="M4 20h4L19 9l-4-4L4 16Z" />}
      {kind === "waitingMaterial" && (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
        </>
      )}
      {kind === "scheduled" && <path d="M4 12h16M14 6l6 6-6 6" />}
      {kind === "published" && <path d="m4 12 5 5L20 6" />}
    </svg>
  );
}

const SEAL = "absolute grid size-3.5 place-items-center rounded-full border-[1.5px] border-surface text-on-solid";

function markerShadow(format: PostFormat, late: boolean) {
  const card = format === "carrossel";
  if (card && late) return MARKER_SHADOW.cardLate;
  if (card) return MARKER_SHADOW.card;
  if (late) return MARKER_SHADOW.late;
  return MARKER_SHADOW.plain;
}

/** Marcador de um post: link para o post; letra + cor do estágio, forma do formato, selos e anel de atraso. */
function StageMarker({ marker }: { marker: MarkerModel }) {
  const meta = STAGES.find((s) => s.id === marker.stage);
  return (
    <Link
      href={`/posts/${marker.postId}`}
      prefetch={false}
      aria-label={marker.ariaLabel}
      title={marker.ariaLabel}
      className={`relative grid size-10 shrink-0 place-items-center text-sm font-bold leading-none transition-shadow duration-(--sf-dur-fast) focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus active:after:absolute active:after:inset-0 active:after:rounded-[inherit] active:after:bg-press md:size-6 md:text-xs ${
        marker.hasArt ? `border-[1.5px] ${STAGE_FILLED[marker.stage]}` : `border-2 ${STAGE_HOLLOW[marker.stage]}`
      } ${SHAPE[marker.format]} ${markerShadow(marker.format, marker.late)}`}
    >
      <span aria-hidden="true">{meta?.letter}</span>
      {marker.issue && (
        <span aria-hidden="true" className={`${SEAL} -right-1.5 -top-1.5 ${ISSUE_BADGE[marker.issue]}`}>
          <Glyph kind={marker.issue} />
        </span>
      )}
      {marker.publication && (
        <span aria-hidden="true" className={`${SEAL} -bottom-1.5 -right-1.5 ${PUBLICATION_BADGE[marker.publication]}`}>
          <Glyph kind={marker.publication} />
        </span>
      )}
    </Link>
  );
}

/* ------------------------------------------------------------------ *
 * Resumo do mês (chips não clicáveis)
 * ------------------------------------------------------------------ */
export function ProductionSummary({ board }: { board: BoardModel }) {
  const chip = "inline-flex h-8 items-center gap-2 rounded-control border border-line bg-surface pl-1 pr-3";
  return (
    <ul aria-label="Resumo do mês" className="mb-4 flex flex-wrap gap-2">
      {STAGES.map((s) => (
        <li key={s.id} className={chip}>
          <span
            aria-hidden="true"
            className={`grid size-6 place-items-center rounded-chip border-[1.5px] text-xs font-bold leading-none ${STAGE_FILLED[s.id]}`}
          >
            {s.letter}
          </span>
          <span className="text-sm text-fg">
            {s.label}
            <span className="sr-only">:</span>
          </span>
          <span className="text-sm font-semibold tabular-nums text-fg">{board.totals[s.id]}</span>
        </li>
      ))}
      <li className={chip}>
        <span
          aria-hidden="true"
          className={`grid size-6 place-items-center rounded-chip border-[1.5px] border-line-strong bg-surface text-xs font-bold leading-none text-fg ${SAMPLE_SHADOW.late}`}
        >
          !
        </span>
        <span className="text-sm text-fg">
          Atrasados
          <span className="sr-only">:</span>
        </span>
        <span className="text-sm font-semibold tabular-nums text-fg">{board.late}</span>
      </li>
      <li className="inline-flex h-8 items-center gap-2 px-2">
        <span className="text-sm text-fg-muted">
          Total
          <span className="sr-only">:</span>
        </span>
        <span className="text-sm font-semibold tabular-nums text-fg">{board.total}</span>
      </li>
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Legenda "Como ler o quadro" (fechada por padrão)
 * ------------------------------------------------------------------ */
const SAMPLE_BASE = "grid size-6 shrink-0 place-items-center text-xs font-bold leading-none";
const SAMPLE_NEUTRAL = "border-[1.5px] border-line-strong bg-surface text-fg-muted";
const FORMAT_HINT: Record<PostFormat, string> = {
  feed: "quadrado",
  carrossel: "quadrado com um cartão atrás",
  reels: "círculo",
  story: "borda tracejada",
};

function LegendItem({ sample, children }: { sample: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 text-sm text-fg">
      <span aria-hidden="true" className="relative grid w-8 shrink-0 place-items-center">
        {sample}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Seal({ kind, tone }: { kind: GlyphKind; tone: string }) {
  return (
    <span className={`grid size-3.5 place-items-center rounded-full border-[1.5px] border-surface text-on-solid ${tone}`}>
      <Glyph kind={kind} />
    </span>
  );
}

export function ProductionLegend() {
  const heading = "mb-2 text-xs font-semibold uppercase tracking-overline text-fg-muted";
  return (
    <details className="group mb-4">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-control text-sm font-medium text-fg sm:min-h-10 [&::-webkit-details-marker]:hidden">
        <Icon.chevronRight className="size-4 shrink-0 text-fg-muted transition-transform duration-(--sf-dur-fast) group-open:rotate-90" />
        Como ler o quadro
      </summary>
      <div className="card mt-2 grid gap-6 p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <caption className="mb-2 text-left text-xs font-semibold uppercase tracking-overline text-fg-muted">
              Estágios e cores da planilha
            </caption>
            <thead>
              <tr className="text-left text-xs text-fg-muted">
                <th scope="col" className="border-b border-line py-2 pr-3 font-semibold">
                  Estágio
                </th>
                <th scope="col" className="border-b border-line px-3 py-2 font-semibold">
                  Letra
                </th>
                <th scope="col" className="border-b border-line py-2 pl-3 font-semibold">
                  Equivale a (planilha)
                </th>
              </tr>
            </thead>
            <tbody>
              {STAGES.map((s) => (
                <tr key={s.id}>
                  <th scope="row" className="border-b border-line py-2 pr-3 text-left font-medium text-fg">
                    {s.label}
                  </th>
                  <td className="border-b border-line px-3 py-2">
                    <span
                      className={`grid size-6 place-items-center rounded-chip border-[1.5px] text-xs font-bold leading-none ${STAGE_FILLED[s.id]}`}
                    >
                      {s.letter}
                    </span>
                  </td>
                  <td className="border-b border-line py-2 pl-3 text-fg">
                    “{s.sheetLabel}” ({s.sheetColor})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <section>
            <h2 className={heading}>Formato (forma do marcador)</h2>
            <ul className="space-y-2">
              {POST_FORMATS.map((f) => (
                <LegendItem
                  key={f}
                  sample={
                    <span
                      className={`${SAMPLE_BASE} ${SAMPLE_NEUTRAL} ${SHAPE[f]} ${f === "carrossel" ? SAMPLE_SHADOW.card : ""}`}
                    />
                  }
                >
                  {FORMAT[f].label}: {FORMAT_HINT[f]}
                </LegendItem>
              ))}
            </ul>
          </section>

          <section>
            <h2 className={heading}>Arte e atraso</h2>
            <ul className="space-y-2">
              <LegendItem
                sample={
                  <span className={`${SAMPLE_BASE} rounded-chip border-[1.5px] ${STAGE_FILLED.texto_ok}`}>T</span>
                }
              >
                Cheio: já tem arte
              </LegendItem>
              <LegendItem
                sample={<span className={`${SAMPLE_BASE} rounded-chip border-2 ${STAGE_HOLLOW.texto_ok}`}>T</span>}
              >
                Vazado: ainda sem arte
              </LegendItem>
              <LegendItem
                sample={
                  <span className={`${SAMPLE_BASE} rounded-chip ${SAMPLE_NEUTRAL} ${SAMPLE_SHADOW.late}`}>!</span>
                }
              >
                Anel vermelho: atrasado (sem texto a até 3 dias da data, ou em aprovação com o prazo de resposta
                vencido)
              </LegendItem>
            </ul>
          </section>

          <section className="sm:col-span-2 lg:col-span-1 xl:col-span-2">
            <h2 className={heading}>Selos</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              <LegendItem sample={<Seal kind="failed" tone={ISSUE_BADGE.failed} />}>Falhou ao publicar</LegendItem>
              <LegendItem sample={<Seal kind="adjustment" tone={ISSUE_BADGE.adjustment} />}>
                Ajuste pendente do cliente
              </LegendItem>
              <LegendItem sample={<Seal kind="waitingMaterial" tone={ISSUE_BADGE.waitingMaterial} />}>
                Aguardando material (pendência aberta)
              </LegendItem>
              <LegendItem sample={<Seal kind="scheduled" tone={PUBLICATION_BADGE.scheduled} />}>
                Agendado para publicar
              </LegendItem>
              <LegendItem sample={<Seal kind="published" tone={PUBLICATION_BADGE.published} />}>Publicado</LegendItem>
            </ul>
            <p className="mt-2 text-xs text-fg-muted">
              No canto de cima aparece só o selo mais importante (falhou, depois ajuste, depois material). Rascunho não
              tem selo de publicação.
            </p>
          </section>
        </div>
      </div>
    </details>
  );
}

/* ------------------------------------------------------------------ *
 * Grade cliente × dia
 * ------------------------------------------------------------------ */
function RowTotals({ row }: { row: RowModel }) {
  const present = STAGES.filter((s) => row.totals[s.id] > 0);
  return (
    <>
      <p className="text-sm text-fg">
        <span className="font-semibold">{row.total}</span> {row.total === 1 ? "post" : "posts"}
      </p>
      {present.length > 0 && (
        <>
          <p aria-hidden="true" className="flex flex-wrap gap-x-1 text-xs tabular-nums text-fg-muted">
            {present.map((s, i) => (
              <span key={s.id} className="whitespace-nowrap">
                {i > 0 && "· "}
                {s.letter}
                {row.totals[s.id]}
              </span>
            ))}
          </p>
          <span className="sr-only">
            {present.map((s) => `${row.totals[s.id]} ${s.label.toLowerCase()}`).join(", ")}
          </span>
        </>
      )}
    </>
  );
}

function ClientHeader({ row }: { row: RowModel }) {
  const c = row.client;
  const meta = [c.writerName ?? "Sem redatora", c.segment ? labelOf(SEGMENT, c.segment) : null].filter(Boolean);
  return (
    <>
      <Link
        href={`/clients/${c.id}`}
        title={c.name}
        className="group/cliente flex min-h-11 flex-col justify-center rounded-chip py-0.5 sm:min-h-10"
      >
        <span className="line-clamp-2 text-sm font-semibold wrap-break-word text-fg group-hover/cliente:underline">
          {c.name}
        </span>
        <span className="flex items-center gap-1 text-xs font-normal text-fg-muted">
          <span className="truncate">{meta.join(" · ")}</span>
          {c.withApproval && (
            <>
              <Icon.shield className="size-3 shrink-0" />
              <span className="sr-only">, com aprovação</span>
            </>
          )}
        </span>
      </Link>
      {(!c.agencyPublishes || c.status !== "ativo") && (
        <div className="flex flex-wrap gap-1 pb-1">
          {!c.agencyPublishes && <StatusBadge kind="agencyPublishes" status="nao" size="sm" />}
          {c.status !== "ativo" && <StatusBadge kind="client" status={c.status} size="sm" />}
        </div>
      )}
    </>
  );
}

const DAY_BG = (col: DayColumn) => (col.today ? "bg-today" : col.weekend ? "bg-sunken" : "");

export default function ProductionGrid({ board }: { board: BoardModel }) {
  return (
    <div
      role="region"
      aria-label={`Quadro de produção de ${board.monthLabel}`}
      tabIndex={0}
      // relative: os textos sr-only (absolute) ficam presos à rolagem da grade, não à da página
      className="relative overflow-auto rounded-card border border-line bg-surface"
      style={{ maxHeight: "calc(100dvh - 14rem)" }}
    >
      <table className="w-max border-separate border-spacing-0 text-sm">
        <caption className="sr-only">
          Quadro de produção de {board.monthLabel}: uma linha por cliente e uma coluna por dia. Cada post é um link com
          o estágio, o formato e os avisos.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 top-0 z-20 w-32 min-w-32 border-b border-r border-line bg-surface px-2 text-left text-xs font-semibold text-fg-muted md:w-40 md:min-w-40 md:px-3"
            >
              Cliente
            </th>
            {board.days.map((col) => (
              <th
                key={col.day}
                scope="col"
                aria-current={col.today ? "date" : undefined}
                data-scroll-anchor={col.scrollAnchor ? "" : undefined}
                className={`sticky top-0 z-10 h-12 w-11 min-w-11 border-b border-r border-line px-0 text-center align-middle font-normal md:w-6.75 md:min-w-6.75 ${
                  col.today
                    ? "bg-surface bg-linear-to-b from-today to-today"
                    : col.weekend
                      ? "bg-sunken"
                      : "bg-surface"
                }`}
              >
                <abbr title={col.weekdayFull} className="block text-xs text-fg-muted no-underline">
                  {col.weekday}
                </abbr>
                <span
                  className={`inline-block text-xs font-semibold tabular-nums ${
                    col.today ? "rounded-chip bg-brand px-1 text-on-brand" : "text-fg"
                  }`}
                >
                  {col.day}
                </span>
              </th>
            ))}
            <th
              scope="col"
              className="sticky top-0 z-10 w-24 min-w-24 border-b border-line bg-surface px-2 text-left text-xs font-semibold text-fg-muted md:w-26 md:min-w-26 md:px-3"
            >
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {board.rows.map((row) => (
            <tr key={row.client.id} className="h-13 md:h-11">
              <th
                scope="row"
                className="sticky left-0 z-10 w-32 min-w-32 max-w-32 border-b border-r border-line bg-surface px-2 text-left align-middle font-normal md:w-40 md:min-w-40 md:max-w-40 md:px-3"
              >
                <ClientHeader row={row} />
              </th>
              {board.days.map((col) => {
                const markers = row.days.get(col.day);
                return (
                  <td key={col.day} className={`border-b border-r border-line p-0 align-middle ${DAY_BG(col)}`}>
                    {markers && markers.length > 0 && (
                      <div className="flex flex-col items-center gap-2 py-1.5">
                        {markers.map((m) => (
                          <StageMarker key={m.postId} marker={m} />
                        ))}
                      </div>
                    )}
                  </td>
                );
              })}
              <td className="border-b border-line px-2 align-middle md:px-3">
                <RowTotals row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
