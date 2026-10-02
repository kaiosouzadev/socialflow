"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { Button, buttonClasses, Spinner } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { MonthPicker, TimePicker } from "@/components/DatePickers";
import { Field, Select, Textarea } from "@/components/Field";
import { Icon } from "@/components/Icons";
import { SegmentedControl } from "@/components/Toggle";
import { FormatBadge, PageHeader, StatusBadge, ToneBadge } from "@/components/ui";
import { DEFAULT_TIMES, stripCredentials, type DocStatus } from "@/lib/doc-import";
import type {
  BriefingDiffEntry,
  BriefingField,
  ImportAnalysis,
  ImportCommitResult,
  ImportItem,
  ImportScheduleStatus,
} from "@/lib/doc-import-commit";
import { DOCX_ERROR_MESSAGE, DocxReadError, readDocxFile, refMonthFromFileName } from "@/lib/docx-text";
import { capitalizeFirst, formatMonthLabel } from "@/lib/format-date";
import { formatLabel, type PostFormat } from "@/lib/formats";
import { labelOf, SCHEDULE_STATUS, type Tone } from "@/lib/status-meta";
import { toUserMessage } from "@/lib/user-facing-error";

/*
 * Importador do documento mensal (S33, DESIGN g.2) em 3 etapas:
 * 1. Fonte: .docx lido AQUI (lib/docx-text) ou texto colado. As credenciais
 *    saem com `stripCredentials` antes de qualquer envio; o .docx nunca vai ao
 *    servidor e nenhum request é multipart (só JSON com o texto).
 * 2. Prévia (`mode: "preview"`, S18): nada é gravado. Incluir/excluir por item,
 *    horários padrão por formato, status do cronograma, campos do briefing.
 * 3. Resultado (`mode: "commit"`, S18): posts SEMPRE rascunho. Nunca agenda.
 * Estado num `useReducer` (DATA FLOW do DESIGN).
 */

// ------------------------------------------------------------ tipos e constantes

type ClientInfo = { id: string; name: string; status: string; plan: string; agencyPublishes: boolean };
type Times = Record<PostFormat, string>;
type Source = "file" | "paste";
type Step = 1 | 2 | 3;

type FileState =
  | { status: "empty" }
  | { status: "reading"; name: string; size: number }
  | { status: "ready"; name: string; size: number; text: string; lines: number; credentialDetected: boolean }
  | { status: "error"; name: string; size: number; message: string };

/** O que a prévia recebeu (texto já sem credenciais). O commit reenvia o mesmo texto e mês. */
type Sent = { text: string; refMonth: string; credentialDetected: boolean };

type State = {
  step: Step;
  source: Source;
  file: FileState;
  paste: string;
  refMonth: string;
  /** mês detectado pelo nome do arquivo ("_09 - 2026") */
  detected: { refMonth: string; label: string } | null;
  busy: null | "preview" | "commit";
  /** erro da etapa 1 (gerar prévia) */
  error: string | null;
  sent: Sent | null;
  preview: ImportAnalysis | null;
  /** `line` dos itens desmarcados */
  excluded: number[];
  times: Times;
  scheduleStatus: ImportScheduleStatus;
  briefingFields: BriefingField[];
  commitError: string | null;
  result: ImportCommitResult | null;
};

type Action =
  | { type: "source"; source: Source }
  | { type: "fileReading"; name: string; size: number }
  | {
      type: "fileReady";
      name: string;
      size: number;
      text: string;
      credentialDetected: boolean;
      detected: { refMonth: string; label: string } | null;
    }
  | { type: "fileError"; name: string; size: number; message: string }
  | { type: "paste"; text: string }
  | { type: "month"; refMonth: string }
  | { type: "previewStart" }
  | { type: "previewFail"; message: string }
  | { type: "previewOk"; sent: Sent; preview: ImportAnalysis }
  | { type: "include"; lines: number[]; include: boolean }
  | { type: "time"; format: PostFormat; value: string }
  | { type: "scheduleStatus"; value: ImportScheduleStatus }
  | { type: "briefing"; field: BriefingField; checked: boolean }
  | { type: "back" }
  | { type: "commitStart" }
  | { type: "commitFail"; message: string }
  | { type: "commitOk"; result: ImportCommitResult }
  | { type: "restart" };

/** Mesmo limite de IMPORT_TEXT_MAX_BYTES (S18); o servidor confere de novo. */
const TEXT_MAX_BYTES = 500 * 1024;
const TEXT_TOO_LARGE = "O texto do documento passa de 500 KB. Divida o documento e importe por partes.";
const PREVIEW_FAILED = "Não foi possível gerar a prévia. Confira o texto e o mês e tente de novo.";
const COMMIT_FAILED = "Tente de novo. Se continuar, gere a prévia outra vez.";

/** Formatos que o documento usa (A12): feed e carrossel 09:00, reels 20:00. */
const TIME_FORMATS: readonly PostFormat[] = ["feed", "carrossel", "reels"];
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const LOOSE_LINK = "inline-flex min-h-11 items-center sm:min-h-10";
const CHECK_HIT = "inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center sm:min-h-10 sm:min-w-10";
const CHECKBOX = "size-4.5 rounded-chip accent-selected disabled:cursor-not-allowed";
const TH = "px-3 py-3 text-left text-xs font-semibold uppercase tracking-overline text-fg-muted";
const H2 = "font-display text-lg font-semibold tracking-title text-fg";
const H3 = "text-base font-semibold text-fg";

const DOC_STATUS: Record<DocStatus, { label: string; tone: Tone }> = {
  aprovado: { label: "Aprovado", tone: "success" },
  aguardando_aprovacao: { label: "Aguardando aprovação", tone: "warning" },
  aguardando_fotos: { label: "Aguardando fotos", tone: "warning" },
};

const STEPS: readonly { n: Step; label: string }[] = [
  { n: 1, label: "Fonte" },
  { n: 2, label: "Prévia" },
  { n: 3, label: "Resultado" },
];

// ------------------------------------------------------------ utilidades

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const nameCase = (s: string) => capitalizeFirst(s.toLowerCase());

/** "seg, 07/09" (data civil do documento). */
function dateLabel(date: string | null): string {
  if (!date) return "Sem data";
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return `${weekday}, ${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

const utf8Bytes = (s: string) => new TextEncoder().encode(s).byteLength;

function snippet(line: string | undefined): string {
  const s = (line ?? "").trim();
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

type ApiResult = { ok: true; data: Record<string, unknown> } | { ok: false; message: string };

/** POST JSON (só o texto; nunca o arquivo) para a rota do S18. Erro: só string (N-14). */
async function callImport(clientId: string, body: Record<string, unknown>, fallback: string): Promise<ApiResult> {
  let res: Response;
  try {
    res = await fetch(`/api/clients/${clientId}/import-doc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: "Sem conexão com o servidor. Verifique a internet e tente de novo." };
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.ok && data && typeof data === "object") return { ok: true, data: data as Record<string, unknown> };
  if (res.status === 401) return { ok: false, message: "Sua sessão expirou. Entre de novo para continuar." };
  const error = data && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
  return { ok: false, message: typeof error === "string" && error.trim() ? toUserMessage(error, fallback) : fallback };
}

// ------------------------------------------------------------ estado

function initialState(): State {
  return {
    step: 1,
    source: "file",
    file: { status: "empty" },
    paste: "",
    refMonth: "",
    detected: null,
    busy: null,
    error: null,
    sent: null,
    preview: null,
    excluded: [],
    times: { ...DEFAULT_TIMES },
    scheduleStatus: "rascunho",
    briefingFields: [],
    commitError: null,
    result: null,
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "source":
      return { ...state, source: action.source, error: null };
    case "fileReading":
      return { ...state, file: { status: "reading", name: action.name, size: action.size }, error: null };
    case "fileReady":
      return {
        ...state,
        file: {
          status: "ready",
          name: action.name,
          size: action.size,
          text: action.text,
          lines: action.text.split("\n").length,
          credentialDetected: action.credentialDetected,
        },
        detected: action.detected,
        // o mês vem do nome "_MM - AAAA" e continua editável
        refMonth: action.detected?.refMonth ?? state.refMonth,
        error: null,
      };
    case "fileError":
      return { ...state, file: { status: "error", name: action.name, size: action.size, message: action.message } };
    case "paste":
      return { ...state, paste: action.text, error: null };
    case "month":
      return { ...state, refMonth: action.refMonth, error: null };
    case "previewStart":
      return { ...state, busy: "preview", error: null };
    case "previewFail":
      return { ...state, busy: null, error: action.message };
    case "previewOk":
      return {
        ...state,
        step: 2,
        busy: null,
        sent: action.sent,
        preview: action.preview,
        excluded: [],
        times: { ...DEFAULT_TIMES, ...action.preview.defaultTimes },
        scheduleStatus: "rascunho",
        // só os campos vazios no cadastro vêm marcados
        briefingFields: action.preview.briefing.filter((b) => b.suggested).map((b) => b.field),
        commitError: null,
        result: null,
      };
    case "include": {
      const set = new Set(state.excluded);
      for (const line of action.lines) {
        if (action.include) set.delete(line);
        else set.add(line);
      }
      return { ...state, excluded: [...set].sort((a, b) => a - b) };
    }
    case "time":
      return { ...state, times: { ...state.times, [action.format]: action.value } };
    case "scheduleStatus":
      return { ...state, scheduleStatus: action.value };
    case "briefing": {
      const set = new Set(state.briefingFields);
      if (action.checked) set.add(action.field);
      else set.delete(action.field);
      return { ...state, briefingFields: [...set] };
    }
    case "back":
      return { ...state, step: 1, busy: null, commitError: null };
    case "commitStart":
      return { ...state, busy: "commit", commitError: null };
    case "commitFail":
      return { ...state, busy: null, commitError: action.message };
    case "commitOk":
      return { ...state, step: 3, busy: null, result: action.result };
    case "restart":
      return initialState();
  }
}

// ------------------------------------------------------------ componente principal

export default function ImportWizard({ client }: { client: ClientInfo }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef<Step>(state.step);

  // a cada troca de etapa, o foco vai para o título dela (leitor de tela e teclado)
  useEffect(() => {
    if (shownStep.current === state.step) return;
    shownStep.current = state.step;
    headingRef.current?.focus();
  }, [state.step]);

  return (
    <div className={state.step === 2 ? "page" : "page page--narrow"}>
      <PageHeader
        title="Importar documento do mês"
        subtitle={client.name}
        back={`/clients/${client.id}`}
        backLabel="Voltar para o cliente"
      />
      <StepIndicator step={state.step} />

      {state.step === 1 && (
        <SourceStep client={client} state={state} dispatch={dispatch} headingRef={headingRef} />
      )}
      {state.step === 2 && state.preview && state.sent && (
        <PreviewStep
          client={client}
          state={state}
          preview={state.preview}
          sent={state.sent}
          dispatch={dispatch}
          headingRef={headingRef}
        />
      )}
      {state.step === 3 && state.result && state.sent && state.preview && (
        <ResultStep
          client={client}
          result={state.result}
          sent={state.sent}
          preview={state.preview}
          onRestart={() => dispatch({ type: "restart" })}
          headingRef={headingRef}
        />
      )}
    </div>
  );
}

type HeadingRef = React.RefObject<HTMLHeadingElement | null>;

function StepIndicator({ step }: { step: Step }) {
  const current = STEPS[step - 1];
  return (
    <div className="mb-6">
      <ol aria-label="Etapas da importação" className="hidden items-center gap-3 sm:flex">
        {STEPS.map((s, i) => {
          const state = s.n < step ? "done" : s.n === step ? "current" : "next";
          return (
            <li key={s.n} aria-current={state === "current" ? "step" : undefined} className="flex items-center gap-3">
              <span className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className={`inline-grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                    state === "current"
                      ? "bg-selected text-on-selected"
                      : state === "done"
                        ? "bg-success-solid text-on-solid"
                        : "border border-line-strong text-fg-muted"
                  }`}
                >
                  {state === "done" ? <Icon.check className="size-3.5" /> : s.n}
                </span>
                <span className={state === "next" ? "text-fg-muted" : "font-medium text-fg"}>
                  {s.label}
                  {state === "done" && <span className="sr-only"> (concluída)</span>}
                </span>
              </span>
              {i < STEPS.length - 1 && <span aria-hidden="true" className="h-px w-8 bg-line-strong" />}
            </li>
          );
        })}
      </ol>
      <div className="sm:hidden">
        <p className="text-sm font-medium text-fg">
          Etapa {step} de {STEPS.length} · {current.label}
        </p>
        <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-bg">
          <div
            className={`h-full rounded-full bg-selected ${step === 1 ? "w-1/3" : step === 2 ? "w-2/3" : "w-full"}`}
          />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ etapa 1: fonte

function SourceStep({
  client,
  state,
  dispatch,
  headingRef,
}: {
  client: ClientInfo;
  state: State;
  dispatch: React.Dispatch<Action>;
  headingRef: HeadingRef;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const readToken = useRef(0);
  const [dragging, setDragging] = useState(false);
  const headingId = useId();
  const originId = useId();
  const countId = useId();
  const hintId = useId();

  const pasteBytes = useMemo(() => utf8Bytes(state.paste), [state.paste]);
  const hasSource = state.source === "file" ? state.file.status === "ready" : state.paste.trim().length > 0;
  const hasMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(state.refMonth);
  const canPreview = hasSource && hasMonth && state.busy === null;
  const fileName = state.file.status === "empty" ? null : state.file.name;
  const fromName = state.source === "file" && state.detected !== null && state.detected.refMonth === state.refMonth;

  async function loadFile(file: File) {
    const token = ++readToken.current;
    dispatch({ type: "fileReading", name: file.name, size: file.size });
    try {
      const raw = await readDocxFile(file);
      if (token !== readToken.current) return;
      // credenciais saem aqui, no navegador; o texto bruto não fica guardado no estado
      const clean = stripCredentials(raw);
      dispatch({
        type: "fileReady",
        name: file.name,
        size: file.size,
        text: clean.text,
        credentialDetected: clean.credentialDetected,
        detected: refMonthFromFileName(file.name),
      });
    } catch (e) {
      if (token !== readToken.current) return;
      dispatch({
        type: "fileError",
        name: file.name,
        size: file.size,
        message: e instanceof DocxReadError ? e.message : DOCX_ERROR_MESSAGE.corrupt,
      });
    }
  }

  async function generatePreview() {
    if (!canPreview) return;
    const fromFile = state.source === "file" && state.file.status === "ready";
    // o arquivo já foi limpo na leitura; o texto colado é limpo agora, antes do envio
    const clean = stripCredentials(fromFile && state.file.status === "ready" ? state.file.text : state.paste);
    const credentialDetected =
      clean.credentialDetected || (state.file.status === "ready" && fromFile && state.file.credentialDetected);
    if (utf8Bytes(clean.text) > TEXT_MAX_BYTES) {
      dispatch({ type: "previewFail", message: TEXT_TOO_LARGE });
      return;
    }
    dispatch({ type: "previewStart" });
    const r = await callImport(client.id, { mode: "preview", text: clean.text, refMonth: state.refMonth }, PREVIEW_FAILED);
    if (!r.ok) {
      dispatch({ type: "previewFail", message: r.message });
      return;
    }
    if (!Array.isArray(r.data.items) || !Array.isArray(r.data.warnings)) {
      dispatch({ type: "previewFail", message: PREVIEW_FAILED });
      return;
    }
    dispatch({
      type: "previewOk",
      sent: { text: clean.text, refMonth: state.refMonth, credentialDetected },
      preview: r.data as unknown as ImportAnalysis,
    });
  }

  const pickFile = () => inputRef.current?.click();
  const missing = !hasSource
    ? state.source === "file"
      ? "Escolha o arquivo .docx"
      : "Cole o texto do documento"
    : !hasMonth
      ? "Escolha o mês de referência"
      : null;

  return (
    <section aria-labelledby={headingId} className="grid gap-5">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className={H2}>
        Fonte do documento
      </h2>

      <Callout tone="info" title="Seu documento não sai do navegador">
        Lemos o .docx aqui mesmo. Senhas e dados de acesso são removidos antes de enviar o texto para a prévia.
      </Callout>

      <Field label="Origem" kind="group" id={originId}>
        <SegmentedControl
          aria-labelledby={`${originId}-label`}
          value={state.source}
          onChange={(source) => dispatch({ type: "source", source })}
          options={[
            { value: "file", label: "Arquivo .docx", icon: <Icon.fileText /> },
            { value: "paste", label: "Colar texto", icon: <Icon.copy /> },
          ]}
        />
      </Field>

      {state.source === "file" ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!dragging) setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) void loadFile(file);
          }}
          className={`grid min-h-40 content-center gap-4 rounded-card border-2 border-dashed p-4 transition-colors duration-(--sf-dur-fast) sm:p-6 ${
            dragging ? "border-focus bg-info-bg" : "border-line-strong bg-sunken"
          }`}
        >
          {state.file.status === "ready" ? (
            <div className="flex flex-wrap items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-grid size-10 shrink-0 place-items-center rounded-control border border-line bg-surface text-fg-muted"
              >
                <Icon.fileText className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg" title={state.file.name}>
                  {state.file.name}
                </p>
                <p className="text-xs text-fg-muted">
                  {sizeLabel(state.file.size)} · {count(state.file.lines, "linha lida", "linhas lidas")}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={pickFile}>
                Trocar arquivo
              </Button>
            </div>
          ) : state.file.status === "reading" ? (
            <p role="status" className="flex items-center justify-center gap-2 text-sm text-fg">
              <Spinner /> Lendo o documento…
            </p>
          ) : (
            <div className="grid justify-items-center gap-3 text-center">
              <span aria-hidden="true" className="inline-flex size-8 text-fg-muted [&>svg]:size-full">
                <Icon.upload />
              </span>
              <p className="text-sm text-fg">Arraste o .docx aqui ou</p>
              <Button variant="secondary" leadingIcon={<Icon.upload />} onClick={pickFile}>
                Escolher arquivo
              </Button>
              <p className="text-xs text-fg-muted">
                Até 10 MB. O nome no padrão “Cliente_MM - AAAA.docx” já preenche o mês.
              </p>
            </div>
          )}
          {state.file.status === "error" && (
            <Callout tone="danger" live="assertive" title="Não foi possível usar este arquivo">
              <p>{state.file.message}</p>
              {fileName && <p className="mt-1 break-all text-fg-muted">{fileName}</p>}
            </Callout>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // escolher o mesmo arquivo de novo também dispara a leitura
              if (file) void loadFile(file);
            }}
          />
        </div>
      ) : (
        <div className="grid gap-1">
          <Field
            label="Texto do documento"
            help="Cole o documento inteiro, do cabeçalho ao STAND BY. Senhas e dados de acesso são removidos antes do envio."
          >
            <Textarea
              value={state.paste}
              onChange={(e) => dispatch({ type: "paste", text: e.target.value })}
              aria-describedby={countId}
              invalid={pasteBytes > TEXT_MAX_BYTES}
              spellCheck={false}
              rows={12}
              className="min-h-60"
            />
          </Field>
          <p
            id={countId}
            className={`justify-self-end text-xs tabular-nums ${pasteBytes > TEXT_MAX_BYTES ? "font-medium text-danger-fg" : "text-fg-muted"}`}
          >
            {Math.ceil(pasteBytes / 1024)} KB de 500 KB
            {pasteBytes > TEXT_MAX_BYTES && " — divida o documento e importe por partes"}
          </p>
        </div>
      )}

      <Field
        label="Mês de referência"
        required
        help={
          fromName && state.detected
            ? `Detectado pelo nome do arquivo (${state.detected.label}). Confira.`
            : "Mês em que o documento começa: as datas dd/mm são lidas a partir dele."
        }
      >
        <MonthPicker value={state.refMonth} onChange={(refMonth) => dispatch({ type: "month", refMonth })} />
      </Field>

      {state.error && (
        <Callout tone="danger" live="assertive" title="Não foi possível gerar a prévia">
          {state.error}
        </Callout>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        {missing && (
          <p id={hintId} className="text-sm text-fg-muted sm:mr-auto">
            {missing} para gerar a prévia.
          </p>
        )}
        <Link href={`/clients/${client.id}`} className={buttonClasses({ variant: "secondary" })}>
          Cancelar
        </Link>
        <Button
          variant="primary"
          disabled={!canPreview}
          loading={state.busy === "preview"}
          loadingText="Gerando prévia…"
          aria-describedby={missing ? hintId : undefined}
          onClick={() => void generatePreview()}
        >
          Gerar prévia
        </Button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------ etapa 2: prévia

function DocStatusBadge({ status }: { status: DocStatus | null }) {
  if (!status) {
    return (
      <span className="text-fg-muted">
        <span aria-hidden="true">—</span>
        <span className="sr-only">sem status</span>
      </span>
    );
  }
  const meta = DOC_STATUS[status];
  return <ToneBadge tone={meta.tone}>{meta.label}</ToneBadge>;
}

function WriterCell({ item }: { item: ImportItem }) {
  if (item.writer) return <span className="text-fg">{item.writer.name}</span>;
  if (!item.writerName) {
    return (
      <span className="text-fg-muted">
        <span aria-hidden="true">—</span>
        <span className="sr-only">sem redatora</span>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-fg">{nameCase(item.writerName)}</span>
      <ToneBadge tone="warning">Não encontrada</ToneBadge>
    </span>
  );
}

function Checkbox({
  checked,
  disabled,
  label,
  onChange,
  indeterminate = false,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  indeterminate?: boolean;
}) {
  return (
    <label className={CHECK_HIT}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        onChange={(e) => onChange(e.target.checked)}
        className={CHECKBOX}
      />
    </label>
  );
}

function PreviewStep({
  client,
  state,
  preview,
  sent,
  dispatch,
  headingRef,
}: {
  client: ClientInfo;
  state: State;
  preview: ImportAnalysis;
  sent: Sent;
  dispatch: React.Dispatch<Action>;
  headingRef: HeadingRef;
}) {
  const headingId = useId();
  const postsId = useId();
  const pendingId = useId();
  const briefingId = useId();
  const settingsId = useId();
  const errorRef = useRef<HTMLDivElement>(null);

  // erro do commit: o foco vai para o aviso (DESIGN g.2, item 7)
  useEffect(() => {
    if (state.commitError) errorRef.current?.focus();
  }, [state.commitError]);

  const excluded = new Set(state.excluded);
  const sentLines = sent.text.split("\n");
  const posts = preview.items.filter((i) => i.kind !== "stand_by");
  const standBy = preview.items.filter((i) => i.kind === "stand_by");
  const isIncluded = (i: ImportItem) => i.action === "create" && !excluded.has(i.line);
  const selectable = posts.filter((i) => i.action === "create");
  const includedPosts = selectable.filter(isIncluded);
  const awaiting = posts.filter((i) => i.pendingKind === "aguardando_material");
  const pendingCount = standBy.filter(isIncluded).length + awaiting.filter(isIncluded).length;
  const briefingCount = state.briefingFields.length;
  const nothing = includedPosts.length + pendingCount + briefingCount === 0;
  // reimportação: tudo já existe (posts, stand-by) e o briefing já está igual
  const nothingNew =
    selectable.length === 0 &&
    standBy.every((i) => i.action !== "create") &&
    preview.briefing.every((b) => !b.changed);
  const timeOf = (i: ImportItem) => (i.timeSource === "padrao" ? state.times[i.format] : i.time);

  const credential = sent.credentialDetected || preview.credentialDetected;
  const missingWriters = preview.writers.filter((w) => w.status !== "matched");
  const docWarnings = preview.warnings.filter((w) => w.code === "documento");
  const lineWarnings = (line: number) => docWarnings.filter((w) => w.line === line);
  const postConflicts = posts.filter((i) => i.action === "conflict").length;
  const standByConflicts = standBy.filter((i) => i.action === "conflict").length;
  const lockedSchedules = preview.schedules.filter(
    (s) => s.existing && s.existing.status !== "rascunho" && s.existing.status !== "em_revisao",
  );
  const postsPerMonth = (month: string) => includedPosts.filter((i) => i.monthKey === month).length;
  const allIncluded = selectable.length > 0 && includedPosts.length === selectable.length;
  const someIncluded = includedPosts.length > 0 && !allIncluded;
  const approvalNote =
    preview.client.plan === "aprovacao_cliente" && posts.some((i) => i.clientApproval === "aprovado");

  async function commit() {
    if (nothing || state.busy) return;
    dispatch({ type: "commitStart" });
    const r = await callImport(
      client.id,
      {
        mode: "commit",
        text: sent.text,
        refMonth: sent.refMonth,
        options: {
          defaultTimes: state.times,
          scheduleStatus: state.scheduleStatus,
          exclude: state.excluded,
          briefingFields: state.briefingFields,
        },
      },
      COMMIT_FAILED,
    );
    if (!r.ok || typeof r.data.created !== "object" || r.data.created === null) {
      dispatch({ type: "commitFail", message: r.ok ? COMMIT_FAILED : r.message });
      return;
    }
    dispatch({ type: "commitOk", result: r.data as unknown as ImportCommitResult });
  }

  const conflictTitle = [
    postConflicts > 0 ? count(postConflicts, "post", "posts") : null,
    standByConflicts > 0 ? count(standByConflicts, "stand-by", "stand-by") : null,
  ]
    .filter(Boolean)
    .join(" e ");
  const conflictsTotal = postConflicts + standByConflicts;
  const commitLabel =
    includedPosts.length > 0
      ? `Importar ${count(includedPosts.length, "post", "posts")} como rascunho`
      : "Gravar o que foi marcado";

  return (
    <section aria-labelledby={headingId} className="grid gap-6">
      {state.commitError && (
        <div ref={errorRef} tabIndex={-1} className="outline-none">
          <Callout tone="danger" live="assertive" title="Não foi possível importar. Nada foi gravado.">
            {state.commitError}
          </Callout>
        </div>
      )}

      <div>
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className={H2}>
          Prévia da importação
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Documento de {formatMonthLabel(sent.refMonth)} ·{" "}
          {count(preview.counts.posts, "post", "posts")}
          {preview.counts.avulsos > 0 && `, ${count(preview.counts.avulsos, "avulso", "avulsos")}`}
          {preview.counts.standBy > 0 && ` e ${count(preview.counts.standBy, "stand-by", "stand-by")}`}
          {preview.ignoredTemplates > 0 &&
            ` · ${count(preview.ignoredTemplates, "molde ignorado", "moldes ignorados")}`}
          . Nada foi gravado ainda.
        </p>
      </div>

      {/* avisos, nesta ordem e só os que existirem */}
      {(credential ||
        preview.endOfContract ||
        missingWriters.length > 0 ||
        docWarnings.length > 0 ||
        conflictsTotal > 0 ||
        lockedSchedules.length > 0) && (
        <div className="grid gap-3">
          {credential && (
            <Callout tone="warning" title="Credencial descartada">
              <p>
                O documento tinha dados de acesso (ex.: “Acesso ao Instagram”). Eles não foram enviados nem serão
                gravados.
              </p>
              <p>
                <Link href={`/clients/${client.id}#credenciais-titulo`} className={`${LOOSE_LINK} font-medium`}>
                  Abrir credenciais do cliente
                </Link>
              </p>
            </Callout>
          )}
          {preview.endOfContract && (
            <Callout
              tone="warning"
              title="O documento pede para encerrar a gestão"
              action={
                client.status !== "encerrado" ? (
                  <Link href={`/clients/${client.id}#cadastro-titulo`} className={`${LOOSE_LINK} font-medium`}>
                    Editar status do cliente
                  </Link>
                ) : undefined
              }
            >
              {client.status === "encerrado"
                ? "Encontramos “ENCERRAR GESTÃO”. Este cliente já está marcado como encerrado."
                : "Encontramos “ENCERRAR GESTÃO”. Nada muda sozinho: se a gestão acabou, marque o cliente como encerrado na edição do cliente."}
            </Callout>
          )}
          {missingWriters.length > 0 && (
            <Callout
              tone="warning"
              title={missingWriters.length === 1 ? "Redatora não encontrada" : "Redatoras não encontradas"}
            >
              <ul className="grid gap-1">
                {missingWriters.map((w) => (
                  <li key={w.name}>
                    {w.status === "ambiguous"
                      ? `Há mais de uma usuária chamada ${nameCase(w.name)}.`
                      : `${nameCase(w.name)} não corresponde a nenhuma usuária.`}{" "}
                    {w.posts === 1 ? "O item dela fica sem redatora." : `Os ${w.posts} itens dela ficam sem redatora.`}
                  </li>
                ))}
              </ul>
            </Callout>
          )}
          {docWarnings.length > 0 && (
            <Callout tone="warning" title={`Trechos não reconhecidos (${docWarnings.length})`}>
              <p>Estes trechos do documento não entram na importação como o esperado. Confira antes de importar.</p>
              <details className="mt-1">
                <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium sm:min-h-10">
                  Ver os trechos
                </summary>
                <ul className="grid gap-2 pb-1">
                  {docWarnings.map((w, i) => (
                    <li key={`${w.line}-${i}`}>
                      <span className="font-medium">Linha {w.line}</span>
                      {w.line !== null && snippet(sentLines[w.line - 1]) && (
                        <>: «{snippet(sentLines[w.line - 1])}»</>
                      )}
                      <span className="block text-fg-muted">{w.message}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </Callout>
          )}
          {lockedSchedules.length > 0 && (
            <Callout tone="warning" title="Cronograma já existe">
              <ul className="grid gap-1">
                {lockedSchedules.map((s) => (
                  <li key={s.month}>
                    O cronograma de {s.label} está como “{labelOf(SCHEDULE_STATUS, s.existing?.status)}”. Os posts
                    importados entram nele como rascunho.
                  </li>
                ))}
              </ul>
            </Callout>
          )}
          {conflictsTotal > 0 && (
            <Callout
              tone="info"
              title={`${conflictTitle} ${conflictsTotal === 1 ? "já existe e será ignorado" : "já existem e serão ignorados"}`}
            >
              Mesmo dia e formato de um post do cliente (ou stand-by com o mesmo título). Reimportar o mesmo documento
              não duplica nada.
            </Callout>
          )}
        </div>
      )}

      {/* configurações */}
      <section aria-labelledby={settingsId} className="card p-4 sm:p-5">
        <h3 id={settingsId} className={H3}>
          Configurações
        </h3>
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <Field
            label="Horário padrão por formato"
            kind="group"
            help="Vale para os posts sem “*Postar” no documento. As linhas abaixo mudam junto."
          >
            <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
              {TIME_FORMATS.map((f) => (
                <Field key={f} label={formatLabel(f)}>
                  <TimePicker value={state.times[f]} onChange={(value) => dispatch({ type: "time", format: f, value })} />
                </Field>
              ))}
            </div>
          </Field>
          <div className="grid content-start gap-3">
            <Field
              label="Status do cronograma"
              help="Use “Aprovado” só se o cliente já aprovou este mês fora do sistema. Vale para os cronogramas criados agora."
            >
              <Select
                value={state.scheduleStatus}
                onChange={(e) =>
                  dispatch({
                    type: "scheduleStatus",
                    value: e.target.value === "aprovado_cliente" ? "aprovado_cliente" : "rascunho",
                  })
                }
              >
                <option value="rascunho">Rascunho (padrão)</option>
                <option value="aprovado_cliente">Aprovado pelo cliente</option>
              </Select>
            </Field>
            {preview.schedules.length > 0 && (
              <div>
                <p className="text-sm font-medium text-fg">Cronogramas de destino</p>
                <ul className="mt-1 grid gap-1.5 text-sm">
                  {preview.schedules.map((s) => {
                    const n = postsPerMonth(s.month);
                    return (
                      <li key={s.month} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-fg">{s.label}</span>
                        <StatusBadge kind="schedule" status={s.existing ? s.existing.status : state.scheduleStatus} />
                        <span className="text-fg-muted">
                          {s.existing ? "já existe" : n > 0 ? "será criado" : "não será criado"} ·{" "}
                          {count(n, "post", "posts")}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* posts */}
      <section aria-labelledby={postsId} className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id={postsId} className={H3}>
            Posts do documento
          </h3>
          <p className="text-sm text-fg-muted" aria-live="polite">
            {includedPosts.length} de {count(selectable.length, "post marcado", "posts marcados")}
          </p>
        </div>
        {approvalNote && (
          <p className="text-sm text-fg-muted">
            Plano com aprovação: os posts “Aprovado” no documento entram como aprovados pelo cliente.
          </p>
        )}

        {posts.length === 0 ? (
          <p className="card p-4 text-sm text-fg-muted">
            Nenhum post encontrado no documento. Confira o mês de referência e o texto.
          </p>
        ) : (
          <>
            {/* ≥ lg: tabela (rolagem horizontal declarada entre 1024 e ~1300 px) */}
            <div
              role="region"
              aria-label="Posts do documento"
              tabIndex={0}
              className="card relative hidden overflow-x-auto lg:block"
            >
              <table className="w-full text-sm">
                <caption className="sr-only">Posts do documento: marque os que serão importados</caption>
                <thead className="bg-sunken">
                  <tr>
                    <th scope="col" className="w-12 py-1 pl-2">
                      <Checkbox
                        checked={allIncluded}
                        indeterminate={someIncluded}
                        disabled={selectable.length === 0}
                        label="Incluir todos os posts"
                        onChange={(checked) =>
                          dispatch({ type: "include", lines: selectable.map((i) => i.line), include: checked })
                        }
                      />
                    </th>
                    {["Data", "Formato", "Título", "Redatora", "No documento", "Horário", "Telas"].map((h) => (
                      <th key={h} scope="col" className={TH}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {posts.map((item) => {
                    const blocked = item.action !== "create";
                    return (
                      <tr key={item.line} className="border-t border-line align-top">
                        <td className="py-1 pl-2">
                          <Checkbox
                            checked={isIncluded(item)}
                            disabled={blocked}
                            label={`Incluir: ${dateLabel(item.date)} · ${item.title || item.kindLabel}`}
                            onChange={(checked) => dispatch({ type: "include", lines: [item.line], include: checked })}
                          />
                        </td>
                        <td className={`whitespace-nowrap px-3 py-3 ${blocked ? "text-fg-muted" : "text-fg"}`}>
                          {dateLabel(item.date)}
                        </td>
                        <td className="px-3 py-3">
                          <FormatBadge format={item.format} />
                        </td>
                        <td className="px-3 py-3">
                          <div className="min-w-48">
                            <PostTitle item={item} warnings={lineWarnings(item.line)} />
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <WriterCell item={item} />
                        </td>
                        <td className="px-3 py-3">
                          <DocStatusBadge status={item.docStatus} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <TimeCell item={item} time={timeOf(item)} />
                        </td>
                        <td className="px-3 py-3 tabular-nums text-fg">{item.slides.length || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* < lg: cartões */}
            <div className="grid gap-3 lg:hidden">
              <div className="flex items-center gap-1">
                <Checkbox
                  checked={allIncluded}
                  indeterminate={someIncluded}
                  disabled={selectable.length === 0}
                  label="Incluir todos os posts"
                  onChange={(checked) =>
                    dispatch({ type: "include", lines: selectable.map((i) => i.line), include: checked })
                  }
                />
                <span aria-hidden="true" className="text-sm text-fg">
                  Incluir todos
                </span>
              </div>
              <ul aria-label="Posts do documento" className="grid gap-3">
                {posts.map((item) => (
                  <li key={item.line} className="card grid gap-2 p-3">
                    <div className="flex items-start gap-1">
                      <Checkbox
                        checked={isIncluded(item)}
                        disabled={item.action !== "create"}
                        label={`Incluir: ${dateLabel(item.date)} · ${item.title || item.kindLabel}`}
                        onChange={(checked) => dispatch({ type: "include", lines: [item.line], include: checked })}
                      />
                      <div className="min-w-0 flex-1 pt-1.5">
                        <p className="text-xs text-fg-muted">
                          {dateLabel(item.date)} · <TimeCell item={item} time={timeOf(item)} inline />
                        </p>
                        <PostTitle item={item} warnings={lineWarnings(item.line)} />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pl-1 text-sm">
                      <FormatBadge format={item.format} />
                      <DocStatusBadge status={item.docStatus} />
                      <WriterCell item={item} />
                      {item.slides.length > 0 && (
                        <span className="text-fg-muted">{count(item.slides.length, "tela", "telas")}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>

      {/* pendências */}
      {(standBy.length > 0 || awaiting.length > 0) && (
        <section aria-labelledby={pendingId} className="grid gap-3">
          <div>
            <h3 id={pendingId} className={H3}>
              Vão para Pendências ({pendingCount})
            </h3>
            <p className="mt-1 text-sm text-fg-muted">
              Itens sem data ou que dependem de material do cliente. Ficam em Pendências até alguém resolver.
            </p>
          </div>
          <ul className="card divide-y divide-line">
            {standBy.map((item) => (
              <li key={item.line} className="flex items-start gap-1 p-2 pr-4">
                <Checkbox
                  checked={isIncluded(item)}
                  disabled={item.action !== "create"}
                  label={`Incluir stand-by: ${item.title || item.kindLabel}`}
                  onChange={(checked) => dispatch({ type: "include", lines: [item.line], include: checked })}
                />
                <div className="grid min-w-0 flex-1 gap-1 pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge kind="pending" status="stand_by" />
                    <span className="text-sm font-medium text-fg wrap-break-word">{item.title || item.kindLabel}</span>
                  </div>
                  <p className="text-xs text-fg-muted">
                    {item.kindLabel} · sem data · horário {item.time}
                    {item.slides.length > 0 && ` · ${count(item.slides.length, "tela", "telas")}`}
                  </p>
                  {item.action === "conflict" && (
                    <p className="text-xs text-fg-muted">
                      <ToneBadge tone="neutral">Já existe</ToneBadge> Já há um stand-by com este título.
                    </p>
                  )}
                </div>
              </li>
            ))}
            {awaiting.map((item) => (
              <li key={`m-${item.line}`} className="grid gap-1 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge kind="pending" status="aguardando_material" />
                  <span className="text-sm font-medium text-fg wrap-break-word">{item.title || item.kindLabel}</span>
                </div>
                <p className="text-xs text-fg-muted">
                  {isIncluded(item)
                    ? `Criada junto com o post de ${dateLabel(item.date)}.`
                    : item.action === "conflict"
                      ? "Não será criada: o post já existe."
                      : `Não será criada: o post de ${dateLabel(item.date)} foi desmarcado.`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* briefing */}
      {(preview.briefing.length > 0 || preview.emailSuggestion) && (
        <BriefingSection
          id={briefingId}
          client={client}
          entries={preview.briefing}
          selected={state.briefingFields}
          emailSuggestion={preview.emailSuggestion}
          onToggle={(field, checked) => dispatch({ type: "briefing", field, checked })}
        />
      )}

      {/* barra de ações (fica presa no rodapé da tela enquanto a prévia rola) */}
      <div className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-raised px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 shadow-bar sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="hidden text-sm text-fg sm:block" aria-live="polite">
            {count(includedPosts.length, "post", "posts")} · {count(pendingCount, "pendência", "pendências")} ·{" "}
            {count(briefingCount, "campo do briefing", "campos do briefing")}
          </p>
          <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto">
            <Button variant="secondary" onClick={() => dispatch({ type: "back" })} disabled={state.busy === "commit"}>
              Voltar
            </Button>
            <Button
              variant="primary"
              className="whitespace-normal"
              disabled={nothing}
              loading={state.busy === "commit"}
              loadingText="Importando…"
              onClick={() => void commit()}
            >
              {commitLabel}
            </Button>
          </div>
        </div>
        {nothing && (
          <p className="mt-2 text-sm font-medium text-fg" role="status">
            {nothingNew
              ? "Nada novo para importar: o que está no documento já existe no sistema."
              : "Marque ao menos um post, uma pendência ou um campo do briefing."}
          </p>
        )}
        <p className="mt-2 text-sm text-fg-muted">Nada é agendado. Os posts entram como rascunho.</p>
      </div>
    </section>
  );
}

function PostTitle({ item, warnings }: { item: ImportItem; warnings: { message: string }[] }) {
  const blocked = item.action !== "create";
  return (
    <div className="grid gap-1">
      <p className={`text-sm font-medium wrap-break-word ${blocked ? "text-fg-muted" : "text-fg"}`}>
        {item.title || item.kindLabel}
      </p>
      {item.kind === "avulso" && <p className="text-xs text-fg-muted">Post avulso</p>}
      {item.action === "conflict" && item.conflictWith?.type === "post" && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
          <ToneBadge tone="neutral">Já existe</ToneBadge>
          <span className="wrap-break-word">{item.conflictWith.theme || "Post sem tema"} — será ignorado</span>
        </p>
      )}
      {item.action === "invalid" && (
        <p className="text-xs text-warning-fg">Sem data válida no documento: não será importado.</p>
      )}
      {warnings.map((w, i) => (
        <p key={i} className="text-xs text-warning-fg">
          {w.message}
        </p>
      ))}
    </div>
  );
}

function TimeCell({ item, time, inline = false }: { item: ImportItem; time: string; inline?: boolean }) {
  const source = item.timeSource === "documento" ? "do documento" : "padrão";
  if (inline) {
    return (
      <span className="tabular-nums">
        {time} ({source})
      </span>
    );
  }
  return (
    <span className="grid">
      <span className="tabular-nums text-fg">{time}</span>
      <span className="text-xs text-fg-muted">{source}</span>
    </span>
  );
}

function BriefingSection({
  id,
  client,
  entries,
  selected,
  emailSuggestion,
  onToggle,
}: {
  id: string;
  client: ClientInfo;
  entries: BriefingDiffEntry[];
  selected: BriefingField[];
  emailSuggestion: string | null;
  onToggle: (field: BriefingField, checked: boolean) => void;
}) {
  const chosen = new Set(selected);
  const value = (v: string | null) =>
    v ? (
      <span className="line-clamp-3 whitespace-pre-line wrap-break-word" title={v}>
        {v}
      </span>
    ) : (
      <span className="text-fg-muted">Vazio</span>
    );
  const control = (e: BriefingDiffEntry) =>
    e.changed ? (
      <Checkbox
        checked={chosen.has(e.field)}
        label={`Atualizar ${e.label}`}
        onChange={(checked) => onToggle(e.field, checked)}
      />
    ) : (
      <span className="inline-flex min-h-11 items-center text-xs text-fg-muted sm:min-h-10">Já igual</span>
    );
  const emailNote = emailSuggestion && (
    <div className="text-sm">
      <p className="text-fg">
        <span className="font-medium">E-mail no documento:</span> <span className="break-all">{emailSuggestion}</span>
        <span className="text-fg-muted"> — sugestão, não é gravado.</span>
      </p>
      <Link
        href={`/clients/${client.id}#cadastro-titulo`}
        className={`${LOOSE_LINK} font-medium text-link hover:text-link-hover hover:underline`}
      >
        Revisar e-mails em Editar cliente
      </Link>
    </div>
  );

  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div>
        <h3 id={id} className={H3}>
          Briefing do cliente
        </h3>
        <p className="mt-1 text-sm text-fg-muted">
          Marque os campos que devem ser gravados no cadastro. Só os campos vazios vêm marcados; os demais ficam como
          estão.
        </p>
      </div>

      {entries.length > 0 && (
        <>
          <div
            role="region"
            aria-label="Briefing do cliente"
            tabIndex={0}
            className="card relative hidden overflow-x-auto lg:block"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Briefing: cadastro atual × documento</caption>
              <thead className="bg-sunken">
                <tr>
                  {["Campo", "No cadastro", "No documento"].map((h) => (
                    <th key={h} scope="col" className={`${TH} first:pl-4`}>
                      {h}
                    </th>
                  ))}
                  <th scope="col" className={`${TH} pr-4`}>
                    Atualizar?
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.field} className="border-t border-line align-top">
                    <th scope="row" className="w-44 py-3 pl-4 pr-3 text-left font-medium text-fg">
                      {e.label}
                    </th>
                    <td className="px-3 py-3 text-fg">
                      <div className="max-w-72">{value(e.current)}</div>
                    </td>
                    <td className="px-3 py-3 text-fg">
                      <div className="max-w-80">{value(e.proposed)}</div>
                    </td>
                    <td className="py-1 pl-1 pr-4">{control(e)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul aria-label="Briefing do cliente" className="grid gap-3 lg:hidden">
            {entries.map((e) => (
              <li key={e.field} className="card grid gap-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="pt-2 text-sm font-medium text-fg">{e.label}</p>
                  {control(e)}
                </div>
                <dl className="grid gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-fg-muted">No cadastro</dt>
                    <dd className="text-fg">{value(e.current)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-fg-muted">No documento</dt>
                    <dd className="text-fg">{value(e.proposed)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
      {emailNote}
    </section>
  );
}

// ------------------------------------------------------------ etapa 3: resultado

function ResultStep({
  client,
  result,
  sent,
  preview,
  onRestart,
  headingRef,
}: {
  client: ClientInfo;
  result: ImportCommitResult;
  sent: Sent;
  preview: ImportAnalysis;
  onRestart: () => void;
  headingRef: HeadingRef;
}) {
  const headingId = useId();
  const schedulesId = useId();
  const { created, skipped } = result;
  const months = result.schedules.map((s) => s.month);
  const mainMonth = months.includes(sent.refMonth) ? sent.refMonth : (months[0] ?? sent.refMonth);
  const monthByLine = new Map(preview.items.map((i) => [i.line, i.monthKey]));
  const postsIn = (month: string) => result.posts.filter((p) => monthByLine.get(p.line) === month).length;
  const nothingNew =
    created.posts + created.pendingItems + created.schedules + result.briefingUpdated.length === 0;
  const credential = sent.credentialDetected || result.credentialDetected;

  const stats: { label: string; value: number; detail?: string }[] = [
    { label: "Posts criados (rascunho)", value: created.posts },
    { label: "Ignorados (já existiam)", value: skipped.conflicts },
    {
      label: "Pendências criadas",
      value: created.pendingItems,
      detail:
        created.pendingItems > 0
          ? `${count(created.standBy, "stand-by", "stand-by")} · ${created.awaitingMaterial} aguardando material`
          : undefined,
    },
    { label: "Campos do briefing atualizados", value: result.briefingUpdated.length },
    ...(skipped.excluded > 0 ? [{ label: "Desmarcados na prévia", value: skipped.excluded }] : []),
    ...(skipped.invalid > 0 ? [{ label: "Sem data válida", value: skipped.invalid }] : []),
  ];

  return (
    <section aria-labelledby={headingId} className="grid gap-6">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className={H2}>
        Resultado
      </h2>

      {nothingNew ? (
        <Callout tone="info" title="Nada novo para importar">
          Tudo o que estava marcado já existia no sistema: nenhum post, pendência ou cronograma foi criado.
        </Callout>
      ) : (
        <Callout tone="success" title="Importação concluída">
          {count(created.posts, "post criado", "posts criados")} como rascunho. Nada foi agendado.
        </Callout>
      )}

      <dl className="card grid grid-cols-1 gap-4 p-4 min-[420px]:grid-cols-2 sm:p-5">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-xs font-semibold uppercase tracking-overline text-fg-muted">{s.label}</dt>
            <dd className="mt-1 font-display text-2xl font-semibold text-fg">{s.value}</dd>
            {s.detail && <dd className="text-sm text-fg-muted">{s.detail}</dd>}
          </div>
        ))}
      </dl>

      {result.schedules.length > 0 && (
        <section aria-labelledby={schedulesId} className="grid gap-2">
          <h3 id={schedulesId} className={H3}>
            Cronogramas
          </h3>
          <ul className="card divide-y divide-line">
            {result.schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <span className="font-medium text-fg">{s.label}</span>
                <StatusBadge kind="schedule" status={s.status} />
                <span className="text-sm text-fg-muted">
                  {s.created ? "criado agora" : "já existia"} · {count(postsIn(s.month), "post novo", "posts novos")}
                </span>
                <Link
                  href={`/producao?mes=${s.month}`}
                  className={`${LOOSE_LINK} ml-auto text-sm font-medium text-link hover:text-link-hover hover:underline`}
                >
                  Ver no Quadro <span className="sr-only">de {s.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.endOfContract && client.status !== "encerrado" && (
        <Callout
          tone="warning"
          title="O documento pede para encerrar a gestão"
          action={
            <Link href={`/clients/${client.id}#cadastro-titulo`} className={`${LOOSE_LINK} font-medium`}>
              Editar status do cliente
            </Link>
          }
        >
          A importação não mudou o status do cliente. Se a gestão acabou, marque-o como encerrado.
        </Callout>
      )}
      {credential && (
        <div className="text-sm">
          <p className="text-fg-muted">
            Os dados de acesso do documento foram descartados. Se precisar, cadastre-os nas credenciais do cliente.
          </p>
          <Link
            href={`/clients/${client.id}#credenciais-titulo`}
            className={`${LOOSE_LINK} font-medium text-link hover:text-link-hover hover:underline`}
          >
            Abrir credenciais do cliente
          </Link>
        </div>
      )}
      <p className="text-sm text-fg-muted">
        {client.agencyPublishes
          ? "Os posts ficam como rascunho até alguém agendá-los."
          : "Este cliente é só produção: a agência não agenda nem publica estes posts."}
      </p>

      <div className="grid gap-2 sm:flex sm:flex-wrap">
        <Link href={`/producao?mes=${mainMonth}`} className={buttonClasses({ variant: "primary" })}>
          Abrir o Quadro de {formatMonthLabel(mainMonth, { withYear: false })}
        </Link>
        <Link href={`/pendencias?cliente=${client.id}`} className={buttonClasses({ variant: "secondary" })}>
          Ver pendências do cliente
        </Link>
        <Link href="/aprovacoes" className={buttonClasses({ variant: "secondary" })}>
          Ver cronograma em Aprovações
        </Link>
        <Button variant="ghost" onClick={onRestart}>
          Importar outro documento
        </Button>
      </div>
    </section>
  );
}
