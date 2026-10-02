"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Field, Select, useFieldControl } from "./Field";
import { Icon } from "./Icons";
import { Popover } from "./Popover";
import { formatMonthLabel } from "@/lib/format-date";

/* ------------------------------------------------------------------ *
 * Seletores de data, mês e horário (DESIGN e.13). O painel é um Popover
 * em portal com posição fixa: não é cortado por listas roláveis (A-042)
 * e funciona dentro de <dialog>. Setas e dias têm nome acessível, o dia
 * escolhido tem aria-pressed e as cores vêm dos tokens (A-047). O mês
 * vem de formatMonthLabel, sem transformação de caixa por CSS (A-019).
 * Abaixo de sm, ou quando o painel não cabe nem acima nem abaixo do
 * gatilho (altura útil baixa: barra do navegador, teclado, paisagem), o
 * painel abre como folha inferior (Dialog): "Concluir" fica sempre à vista.
 * A API dos 4 pickers é a mesma de antes, só com props opcionais a mais.
 * ------------------------------------------------------------------ */

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEKDAYS = [
  { short: "dom", long: "domingo" },
  { short: "seg", long: "segunda-feira" },
  { short: "ter", long: "terça-feira" },
  { short: "qua", long: "quarta-feira" },
  { short: "qui", long: "quinta-feira" },
  { short: "sex", long: "sexta-feira" },
  { short: "sáb", long: "sábado" },
];

/** Largura do painel abaixo de sm: min(100vw − 16, 360). */
const PANEL_MOBILE = "w-[min(calc(100vw-16px),360px)]";

/** Abaixo de sm (max-width 639px) o painel é sempre folha inferior. */
const NARROW_QUERY = "(max-width: 639px)";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/* ------------------------------ datas civis ------------------------------ */

/** Data civil (mês de 1 a 12), sem fuso. */
type Ymd = { y: number; m: number; d: number };

function parseYmd(value: string): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const v = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  return v.m >= 1 && v.m <= 12 && v.d >= 1 && v.d <= 31 ? v : null;
}

function ymdKey(v: Ymd) {
  return `${v.y}-${pad(v.m)}-${pad(v.d)}`;
}

function todayYmd(): Ymd {
  const t = new Date();
  return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
}

function sameDay(a: Ymd | null, b: Ymd) {
  return !!a && a.y === b.y && a.m === b.m && a.d === b.d;
}

function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate();
}

function addDays(v: Ymd, n: number): Ymd {
  const dt = new Date(v.y, v.m - 1, v.d + n);
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
}

function addMonths(v: Ymd, n: number): Ymd {
  const first = new Date(v.y, v.m - 1 + n, 1);
  const y = first.getFullYear();
  const m = first.getMonth() + 1;
  return { y, m, d: Math.min(v.d, daysInMonth(y, m)) };
}

function weekdayOf(v: Ymd) {
  return new Date(v.y, v.m - 1, v.d).getDay();
}

const DAY_LABEL = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** "quinta-feira, 1 de outubro de 2026" */
function dayLabel(v: Ymd) {
  return DAY_LABEL.format(new Date(Date.UTC(v.y, v.m - 1, v.d, 12)));
}

/* -------------------------------- gatilho -------------------------------- */

type TriggerProps = {
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** painel ou folha aberta (aria-expanded fica true nos dois casos) */
  open: boolean;
  /** id do painel controlado (só no modo Popover) */
  controls?: string;
  onToggle: () => void;
  placeholder: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
};

/**
 * `<button>` com o visual do Input. Dentro de um <Field>, o nome acessível é
 * o rótulo + o valor mostrado, e a ajuda/erro do Field descrevem o gatilho
 * (o erro aparece na borda; aria-invalid não vale para o papel button).
 */
function Trigger({
  triggerRef,
  id,
  disabled = false,
  invalid,
  open,
  controls,
  onToggle,
  placeholder,
  icon,
  children,
}: TriggerProps) {
  const field = useFieldControl();
  const valueId = useId();
  const isInvalid = invalid ?? field?.invalid ?? false;
  const look = disabled
    ? "cursor-not-allowed border-line bg-disabled text-fg-disabled"
    : isInvalid
      ? "border-danger-solid bg-surface"
      : "border-line-strong bg-surface hover:border-fg-muted";
  const valueColor = disabled ? "text-fg-disabled" : placeholder ? "text-fg-faint" : "text-fg";

  return (
    <button
      ref={triggerRef}
      type="button"
      id={id ?? field?.id}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={controls}
      aria-labelledby={field ? `${field.labelId} ${valueId}` : undefined}
      aria-describedby={field?.describedBy}
      disabled={disabled}
      onClick={onToggle}
      className={`flex h-11 w-full items-center justify-between gap-2 rounded-control border px-3 text-left text-base transition-colors duration-(--sf-dur-fast) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus sm:h-10 sm:text-sm ${look}`}
    >
      <span id={valueId} className={`min-w-0 truncate ${valueColor}`}>
        {children}
      </span>
      <span aria-hidden="true" className="inline-flex size-4 shrink-0 text-fg-muted [&>svg]:size-full">
        {icon}
      </span>
    </button>
  );
}

type PickerMode = "popover" | "sheet";

/*
 * Altura natural dos painéis a partir de sm (px), para decidir ao abrir se o
 * Popover cabe. Moldura do Popover = p-3 + borda; rodapé = mt-3 + borda + pt-3
 * + Button sm; calendário = navegação + dias da semana + semanas de 36 px.
 */
const POPOVER_FRAME = 26;
const PANEL_FOOTER = 57;
const CLEAR_FOOTER = 49;
const TIME_COLUMNS = 196;
const MONTH_GRID = 218;
/** Folga para arredondamentos de fonte/zoom. */
const FIT_SLACK = 12;
/** offset (8) + distância mínima da borda (8) do Popover. */
const POPOVER_GAP = 16;

function calendarHeight(v: Ymd) {
  const weeks = Math.ceil((weekdayOf({ y: v.y, m: v.m, d: 1 }) + daysInMonth(v.y, v.m)) / 7);
  return 40 + 28 + weeks * 36 + (weeks - 1) * 2;
}

/**
 * Estado comum dos 4 pickers: aberto/fechado, modo (Popover ou folha), gatilho,
 * id do painel e título da folha. O modo é decidido ao abrir: abaixo de sm é
 * folha; a partir de sm é Popover se a altura estimada do painel couber acima
 * ou abaixo do gatilho, senão folha. Se o Popover ainda assim abrir com rolagem
 * interna (estimativa curta), vira folha no quadro seguinte.
 */
function usePicker(disabled: boolean | undefined, defaultTitle: string, panelHeight: () => number) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PickerMode>("popover");
  const [sheetTitle, setSheetTitle] = useState(defaultTitle);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const field = useFieldControl();

  // rede de segurança: Popover com rolagem interna (não coube) → folha
  useEffect(() => {
    if (!open || mode !== "popover") return;
    const frame = requestAnimationFrame(() => {
      const panel = document.getElementById(panelId);
      if (panel && panel.scrollHeight > panel.clientHeight + 1) setMode("sheet");
    });
    return () => cancelAnimationFrame(frame);
  }, [open, mode, panelId]);

  // Folha aberta: Esc fecha só ela. Em captura na window, antes do Popover/Dialog de fora
  // (ex.: popover de IA, revisão do cronograma), que assim continuam abertos.
  useEffect(() => {
    if (!open || mode !== "sheet") return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, mode]);

  /** Rótulo do <Field> (ou <label for>) do gatilho; senão o título padrão. */
  function labelText() {
    const labelEl = (field && document.getElementById(field.labelId)) || triggerRef.current?.labels?.[0];
    const text = labelEl?.textContent?.replace(/\(opcional\)/i, "").trim();
    return text || defaultTitle;
  }

  /** ≥ sm e o painel inteiro cabe acima ou abaixo do gatilho? (só no navegador, ao abrir) */
  function fitsAsPopover() {
    if (typeof window === "undefined" || window.matchMedia?.(NARROW_QUERY).matches) return false;
    const trigger = triggerRef.current;
    if (!trigger) return true;
    const rect = trigger.getBoundingClientRect();
    const viewportH = document.documentElement.clientHeight;
    const need = panelHeight() + FIT_SLACK;
    return viewportH - rect.bottom - POPOVER_GAP >= need || rect.top - POPOVER_GAP >= need;
  }

  return {
    open,
    mode,
    sheetTitle,
    setOpen,
    triggerRef,
    panelId,
    /** id para aria-controls (só o Popover tem esse id) */
    controls: open && mode === "popover" ? panelId : undefined,
    toggle: () => {
      if (disabled) return;
      if (open) {
        setOpen(false);
        return;
      }
      setMode(fitsAsPopover() ? "popover" : "sheet");
      setSheetTitle(labelText());
      setOpen(true);
    },
    /** fecha e devolve o foco ao gatilho (na folha, o Dialog devolve ao fechar) */
    close: () => {
      setOpen(false);
      triggerRef.current?.focus();
    },
  };
}

/**
 * Folha inferior do picker (Dialog do P2-A: folha abaixo de sm, centralizado a
 * partir de sm; foco preso, devolução do foco). O rodapé com "Concluir" fica
 * fixo e sempre visível; o conteúdo rola dentro da folha se precisar.
 */
function PickerSheet({
  picker,
  size = "sm",
  initialFocusRef,
  footer,
  children,
}: {
  picker: ReturnType<typeof usePicker>;
  size?: "sm" | "md";
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!picker.open || picker.mode !== "sheet") return null;
  return (
    <Dialog
      open
      onClose={picker.close}
      title={picker.sheetTitle}
      size={size}
      initialFocusRef={initialFocusRef}
      footer={footer}
    >
      <div className="pb-2">{children}</div>
    </Dialog>
  );
}

/** Foca, uma vez, o elemento marcado com data-autofocus (o painel já está no DOM: efeito passivo). */
function useAutoFocus(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, [ref]);
}

/* ------------------------------- calendário ------------------------------ */

function MonthNav({
  label,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
}: {
  label: string;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <Button iconOnly variant="ghost" size="sm" aria-label={previousLabel} onClick={onPrevious}>
        <Icon.chevronLeft />
      </Button>
      <p aria-live="polite" className="text-sm font-semibold tabular-nums text-fg">
        {label}
      </p>
      <Button iconOnly variant="ghost" size="sm" aria-label={nextLabel} onClick={onNext}>
        <Icon.chevronRight />
      </Button>
    </div>
  );
}

/**
 * Grade de um mês com tabindex itinerante: ←/→ ±1 dia, ↑/↓ ±7, PageUp/PageDown
 * ±1 mês, Home/End início/fim da semana; Enter/Espaço escolhe. Ao abrir, o
 * foco vai para o dia escolhido (ou hoje).
 */
function Calendar({
  selected,
  onSelect,
  activeRef,
}: {
  selected: Ymd | null;
  onSelect: (v: Ymd) => void;
  /** recebe o dia com o ponto de Tab (foco inicial da folha) */
  activeRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const [today] = useState(todayYmd);
  const [active, setActive] = useState<Ymd>(() => selected ?? today);
  const gridRef = useRef<HTMLDivElement>(null);
  // foca o dia ativo depois de montar (abrir) e depois de cada navegação por teclado
  const focusPending = useRef(true);

  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus({ preventScroll: true });
  });

  const monthLabel = formatMonthLabel(`${active.y}-${pad(active.m)}`);
  const leading = weekdayOf({ y: active.y, m: active.m, d: 1 });
  const total = daysInMonth(active.y, active.m);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    let next: Ymd;
    switch (e.key) {
      case "ArrowLeft":
        next = addDays(active, -1);
        break;
      case "ArrowRight":
        next = addDays(active, 1);
        break;
      case "ArrowUp":
        next = addDays(active, -7);
        break;
      case "ArrowDown":
        next = addDays(active, 7);
        break;
      case "PageUp":
        next = addMonths(active, -1);
        break;
      case "PageDown":
        next = addMonths(active, 1);
        break;
      case "Home":
        next = addDays(active, -weekdayOf(active));
        break;
      case "End":
        next = addDays(active, 6 - weekdayOf(active));
        break;
      default:
        return;
    }
    e.preventDefault();
    focusPending.current = true;
    setActive(next);
  }

  return (
    <div>
      <MonthNav
        label={monthLabel}
        previousLabel="Mês anterior"
        nextLabel="Próximo mês"
        onPrevious={() => setActive((v) => addMonths(v, -1))}
        onNext={() => setActive((v) => addMonths(v, 1))}
      />

      <div aria-hidden="true" className="mb-1 grid grid-cols-7 gap-0.5">
        {WEEKDAYS.map((w) => (
          <abbr key={w.short} title={w.long} className="py-1 text-center text-xs font-medium text-fg-muted no-underline">
            {w.short}
          </abbr>
        ))}
      </div>

      <div ref={gridRef} role="group" aria-label={monthLabel} onKeyDown={onKeyDown} className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: leading }, (_, i) => (
          <span key={`vazio-${i}`} aria-hidden="true" />
        ))}
        {Array.from({ length: total }, (_, i) => {
          const day: Ymd = { y: active.y, m: active.m, d: i + 1 };
          const isSelected = sameDay(selected, day);
          const isToday = sameDay(today, day);
          const look = isSelected
            ? "bg-selected font-semibold text-on-selected"
            : `text-fg hover:bg-hover ${isToday ? "font-semibold" : ""}`;
          return (
            <button
              key={day.d}
              ref={day.d === active.d ? activeRef : undefined}
              type="button"
              tabIndex={day.d === active.d ? 0 : -1}
              aria-label={dayLabel(day)}
              aria-pressed={isSelected}
              aria-current={isToday ? "date" : undefined}
              onClick={() => {
                setActive(day);
                onSelect(day);
              }}
              className={`relative grid h-10 place-items-center rounded-control text-sm tabular-nums transition-colors duration-(--sf-dur-fast) sm:h-9 ${look}`}
            >
              {day.d}
              {isToday && (
                <span
                  aria-hidden="true"
                  className={`absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full ${
                    isSelected ? "bg-on-selected" : "bg-link"
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------------- horas --------------------------------- */

function unitLabel(v: number, singular: string, plural: string) {
  return `${v} ${v === 1 ? singular : plural}`;
}

/** Valores de minuto no passo pedido, incluindo o minuto atual se ele não cair no passo. */
function minuteValues(step: number, current: number | null) {
  const values = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  if (current !== null && !values.includes(current)) values.push(current);
  return values.sort((a, b) => a - b);
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * Coluna rolável de valores (≥ sm). Um ponto de Tab por coluna; ↑/↓, Home e
 * End movem o foco; Enter/Espaço escolhe. O valor escolhido aparece no meio.
 */
function ScrollColumn({
  label,
  singular,
  plural,
  values,
  selected,
  onPick,
}: {
  label: string;
  singular: string;
  plural: string;
  values: number[];
  selected: number | null;
  onPick: (v: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const tabStop = selected !== null && values.includes(selected) ? selected : values[0];

  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (list && el) list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2;
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = values.length - 1;
    const next =
      e.key === "ArrowDown" ? Math.min(index + 1, last)
      : e.key === "ArrowUp" ? Math.max(index - 1, 0)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    listRef.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  }

  return (
    <div role="group" aria-labelledby={labelId}>
      <p id={labelId} className="mb-1 text-center text-xs font-medium text-fg-muted">
        {label}
      </p>
      <div ref={listRef} className="relative h-44 w-12 space-y-0.5 overflow-y-auto pr-0.5">
        {values.map((v, index) => {
          const active = v === selected;
          return (
            <button
              key={v}
              type="button"
              tabIndex={v === tabStop ? 0 : -1}
              aria-pressed={active}
              aria-label={unitLabel(v, singular, plural)}
              onClick={() => onPick(v)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={`h-9 w-full rounded-control text-sm tabular-nums transition-colors duration-(--sf-dur-fast) ${
                active ? "bg-selected font-semibold text-on-selected" : "text-fg hover:bg-hover"
              }`}
            >
              {pad(v)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Hora e minuto: colunas a partir de sm; dois Select nativos abaixo de sm (e.13). */
function TimeFields({
  hour,
  minute,
  minuteStep,
  onHour,
  onMinute,
  withDivider = false,
}: {
  hour: number | null;
  minute: number | null;
  minuteStep: number;
  onHour: (h: number) => void;
  onMinute: (m: number) => void;
  withDivider?: boolean;
}) {
  const minutes = minuteValues(minuteStep, minute);
  return (
    <>
      <div className={`hidden gap-2 sm:flex ${withDivider ? "border-l border-line pl-3" : ""}`}>
        <ScrollColumn label="Hora" singular="hora" plural="horas" values={HOURS} selected={hour} onPick={onHour} />
        <ScrollColumn label="Min" singular="minuto" plural="minutos" values={minutes} selected={minute} onPick={onMinute} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:hidden">
        <Field label="Hora">
          <Select
            size="sm"
            value={hour === null ? "" : String(hour)}
            placeholderOption={hour === null ? "--" : undefined}
            onChange={(e) => e.target.value !== "" && onHour(Number(e.target.value))}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {pad(h)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Minuto">
          <Select
            size="sm"
            value={minute === null ? "" : String(minute)}
            placeholderOption={minute === null ? "--" : undefined}
            onChange={(e) => e.target.value !== "" && onMinute(Number(e.target.value))}
          >
            {minutes.map((m) => (
              <option key={m} value={m}>
                {pad(m)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </>
  );
}

function parseTime(value: string): { h: number | null; m: number | null } {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return { h: null, m: null };
  return { h: Number(match[1]), m: Number(match[2]) };
}

/* ------------------------------------------------------------------ *
 * MonthPicker — value: "YYYY-MM"
 * ------------------------------------------------------------------ */
export function MonthPicker({
  value,
  onChange,
  id,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  /** id do gatilho (para <label htmlFor>) */
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const picker = usePicker(disabled, "Escolher mês", () => POPOVER_FRAME + MONTH_GRID);
  const match = /^(\d{4})-(\d{2})/.exec(value);
  const selYear = match ? Number(match[1]) : null;
  const selMonth = match ? Number(match[2]) : null;
  const [viewYear, setViewYear] = useState(() => selYear ?? new Date().getFullYear());
  const gridRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLButtonElement>(null);
  const label = match ? formatMonthLabel(`${match[1]}-${match[2]}`) : "Selecione o mês";

  const grid = (
    <MonthGrid
      gridRef={gridRef}
      focusRef={focusRef}
      viewYear={viewYear}
      setViewYear={setViewYear}
      selYear={selYear}
      selMonth={selMonth}
      onPick={(month) => {
        onChange(`${viewYear}-${pad(month)}`);
        picker.close();
      }}
    />
  );

  return (
    <div>
      <Trigger
        triggerRef={picker.triggerRef}
        id={id}
        disabled={disabled}
        invalid={invalid}
        open={picker.open}
        controls={picker.controls}
        onToggle={picker.toggle}
        placeholder={!match}
        icon={<Icon.calendar />}
      >
        {label}
      </Trigger>

      {picker.mode === "sheet" ? (
        <PickerSheet
          picker={picker}
          initialFocusRef={focusRef}
          footer={
            <Button variant="primary" onClick={picker.close}>
              Concluir
            </Button>
          }
        >
          {grid}
        </PickerSheet>
      ) : (
        <Popover
          open={picker.open}
          onOpenChange={picker.setOpen}
          anchorRef={picker.triggerRef}
          id={picker.panelId}
          aria-label="Escolher mês"
          initialFocus="none"
          className={`${PANEL_MOBILE} sm:w-66`}
        >
          {grid}
        </Popover>
      )}
    </div>
  );
}

function MonthGrid({
  gridRef,
  focusRef,
  viewYear,
  setViewYear,
  selYear,
  selMonth,
  onPick,
}: {
  gridRef: React.RefObject<HTMLDivElement | null>;
  /** recebe o botão do mês com foco inicial (foco inicial da folha) */
  focusRef?: React.RefObject<HTMLButtonElement | null>;
  viewYear: number;
  setViewYear: (fn: (y: number) => number) => void;
  selYear: number | null;
  selMonth: number | null;
  onPick: (month: number) => void;
}) {
  const now = new Date();
  // foco inicial: o mês escolhido, senão o mês atual (no ano em vista), senão janeiro
  const focusMonth =
    selYear === viewYear && selMonth ? selMonth : now.getFullYear() === viewYear ? now.getMonth() + 1 : 1;
  useAutoFocus(gridRef);

  return (
    <div>
      <MonthNav
        label={String(viewYear)}
        previousLabel="Ano anterior"
        nextLabel="Próximo ano"
        onPrevious={() => setViewYear((y) => y - 1)}
        onNext={() => setViewYear((y) => y + 1)}
      />
      <div ref={gridRef} role="group" aria-label={`Meses de ${viewYear}`} className="grid grid-cols-3 gap-1.5">
        {MONTHS_SHORT.map((short, i) => {
          const month = i + 1;
          const active = selYear === viewYear && selMonth === month;
          return (
            <button
              key={short}
              ref={month === focusMonth ? focusRef : undefined}
              type="button"
              data-autofocus={month === focusMonth ? "" : undefined}
              aria-label={`${MONTHS[i]} de ${viewYear}`}
              aria-pressed={active}
              onClick={() => onPick(month)}
              className={`h-10 rounded-control text-sm transition-colors duration-(--sf-dur-fast) ${
                active ? "bg-selected font-semibold text-on-selected" : "text-fg hover:bg-hover"
              }`}
            >
              {short}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * DatePicker — value: "YYYY-MM-DD" (empty string = unset)
 * ------------------------------------------------------------------ */
export function DatePicker({
  value,
  onChange,
  name,
  placeholder = "Selecione a data",
  id,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  name?: string;
  placeholder?: string;
  /** id do gatilho (para <label htmlFor>) */
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const sel = parseYmd(value);
  const picker = usePicker(
    disabled,
    "Escolher data",
    () => POPOVER_FRAME + calendarHeight(sel ?? todayYmd()) + (value ? CLEAR_FOOTER : 0),
  );
  const dayRef = useRef<HTMLButtonElement>(null);
  const label = sel ? `${pad(sel.d)}/${pad(sel.m)}/${sel.y}` : placeholder;

  const calendar = (
    <Calendar
      selected={sel}
      activeRef={dayRef}
      onSelect={(day) => {
        onChange(ymdKey(day));
        picker.close();
      }}
    />
  );
  const clear = () => {
    onChange("");
    picker.close();
  };

  return (
    <div>
      {name && <input type="hidden" name={name} value={value} />}
      <Trigger
        triggerRef={picker.triggerRef}
        id={id}
        disabled={disabled}
        invalid={invalid}
        open={picker.open}
        controls={picker.controls}
        onToggle={picker.toggle}
        placeholder={!sel}
        icon={<Icon.calendar />}
      >
        {label}
      </Trigger>

      {picker.mode === "sheet" ? (
        <PickerSheet
          picker={picker}
          initialFocusRef={dayRef}
          footer={
            <>
              {value && <Button onClick={clear}>Limpar</Button>}
              <Button variant="primary" onClick={picker.close}>
                Concluir
              </Button>
            </>
          }
        >
          {calendar}
        </PickerSheet>
      ) : (
        <Popover
          open={picker.open}
          onOpenChange={picker.setOpen}
          anchorRef={picker.triggerRef}
          id={picker.panelId}
          aria-label="Escolher data"
          initialFocus="none"
          className={`${PANEL_MOBILE} sm:w-74`}
        >
          {calendar}
          {value && (
            <div className="mt-2 flex justify-end border-t border-line pt-2">
              <Button variant="ghost" size="sm" onClick={clear}>
                Limpar
              </Button>
            </div>
          )}
        </Popover>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * DateTimePicker — value: "YYYY-MM-DDTHH:MM" (datetime-local format).
 * Calendário + horário no mesmo painel. Renderiza um input hidden, então
 * continua funcionando em formulários com FormData.
 * ------------------------------------------------------------------ */
export function DateTimePicker({
  name,
  defaultValue = "",
  minuteStep = 5,
  placeholder = "Selecione data e horário",
  required,
  onChange,
  id,
  disabled,
  invalid,
}: {
  name?: string;
  defaultValue?: string;
  minuteStep?: number;
  placeholder?: string;
  required?: boolean;
  onChange?: (v: string) => void;
  /** id do gatilho (para <label htmlFor>) */
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [value, setValueState] = useState(defaultValue);
  const setValue = (v: string) => {
    setValueState(v);
    onChange?.(v);
  };

  const datePart = value.slice(0, 10);
  const timePart = value.slice(11, 16);
  const sel = parseYmd(datePart);
  const { h: th, m: tm } = parseTime(timePart);
  const picker = usePicker(
    disabled,
    "Escolher data e hora",
    () => POPOVER_FRAME + Math.max(calendarHeight(sel ?? todayYmd()), TIME_COLUMNS) + PANEL_FOOTER,
  );
  const dayRef = useRef<HTMLButtonElement>(null);

  function pickDate(day: Ymd) {
    const t = timePart || "12:00";
    setValue(`${ymdKey(day)}T${t}`);
  }
  function pickTime(nh: number, nm: number) {
    const dp = datePart || ymdKey(todayYmd());
    setValue(`${dp}T${pad(nh)}:${pad(nm)}`);
  }

  const label = sel && timePart ? `${pad(sel.d)}/${pad(sel.m)}/${sel.y} às ${timePart}` : placeholder;

  // escolher o dia ou a hora não fecha o painel: "Concluir" fecha
  const content = (
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="sm:w-66 sm:shrink-0">
        <Calendar selected={sel} onSelect={pickDate} activeRef={dayRef} />
      </div>
      <TimeFields
        hour={th}
        minute={tm}
        minuteStep={minuteStep}
        onHour={(hh) => pickTime(hh, tm ?? 0)}
        onMinute={(mm) => pickTime(th ?? 12, mm)}
        withDivider
      />
    </div>
  );

  return (
    <div>
      {name && <input type="hidden" name={name} value={value} required={required} />}
      <Trigger
        triggerRef={picker.triggerRef}
        id={id}
        disabled={disabled}
        invalid={invalid}
        open={picker.open}
        controls={picker.controls}
        onToggle={picker.toggle}
        placeholder={!value}
        icon={<Icon.calendar />}
      >
        {label}
      </Trigger>

      {picker.mode === "sheet" ? (
        <PickerSheet
          picker={picker}
          size="md"
          initialFocusRef={dayRef}
          footer={
            <Button variant="primary" onClick={picker.close}>
              Concluir
            </Button>
          }
        >
          {content}
        </PickerSheet>
      ) : (
        <Popover
          open={picker.open}
          onOpenChange={picker.setOpen}
          anchorRef={picker.triggerRef}
          id={picker.panelId}
          aria-label="Escolher data e horário"
          initialFocus="none"
          className={`${PANEL_MOBILE} sm:w-103`}
        >
          {content}
          <div className="mt-3 flex justify-end border-t border-line pt-3">
            <Button variant="primary" size="sm" onClick={picker.close}>
              Concluir
            </Button>
          </div>
        </Popover>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * TimePicker — value: "HH:MM"
 * ------------------------------------------------------------------ */
export function TimePicker({
  value,
  onChange,
  minuteStep = 5,
  id,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  minuteStep?: number;
  /** id do gatilho (para <label htmlFor>) */
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const picker = usePicker(disabled, "Escolher horário", () => POPOVER_FRAME + TIME_COLUMNS + PANEL_FOOTER);
  const { h, m } = parseTime(value);
  const hasValue = h !== null && m !== null;

  function set(nh: number, nm: number) {
    onChange(`${pad(nh)}:${pad(nm)}`);
  }

  const fields = (
    <div className="sm:flex sm:justify-center">
      <TimeFields
        hour={h}
        minute={m}
        minuteStep={minuteStep}
        onHour={(hh) => set(hh, m ?? 0)}
        onMinute={(mm) => set(h ?? 0, mm)}
      />
    </div>
  );

  return (
    <div>
      <Trigger
        triggerRef={picker.triggerRef}
        id={id}
        disabled={disabled}
        invalid={invalid}
        open={picker.open}
        controls={picker.controls}
        onToggle={picker.toggle}
        placeholder={!hasValue}
        icon={<Icon.clock />}
      >
        {hasValue ? `${pad(h)}:${pad(m)}` : "Selecione o horário"}
      </Trigger>

      {picker.mode === "sheet" ? (
        <PickerSheet
          picker={picker}
          footer={
            <Button variant="primary" onClick={picker.close}>
              Concluir
            </Button>
          }
        >
          {fields}
        </PickerSheet>
      ) : (
        <Popover
          open={picker.open}
          onOpenChange={picker.setOpen}
          anchorRef={picker.triggerRef}
          id={picker.panelId}
          aria-label="Escolher horário"
          className={`${PANEL_MOBILE} sm:w-34`}
        >
          {fields}
          <div className="mt-3 flex justify-end border-t border-line pt-3">
            <Button variant="primary" size="sm" fullWidth onClick={picker.close}>
              Concluir
            </Button>
          </div>
        </Popover>
      )}
    </div>
  );
}
