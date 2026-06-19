"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icons";

/* ------------------------------------------------------------------ *
 * Custom date / month / time pickers — replace the browser-native
 * controls so the UI follows the system design (dark surfaces, accent
 * highlights). All panels render on an OPAQUE surface so nothing behind
 * bleeds through.
 * ------------------------------------------------------------------ */

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Closes the popover on outside click / Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return { open, setOpen, ref };
}

function TriggerButton({
  onClick,
  children,
  placeholder,
  icon,
}: {
  onClick: () => void;
  children: React.ReactNode;
  placeholder: boolean;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="input flex items-center justify-between gap-2 text-left"
    >
      <span className={placeholder ? "text-[var(--color-text-faint)]" : "text-[var(--color-text)]"}>
        {children}
      </span>
      <span className="text-[var(--color-text-muted)] shrink-0">{icon}</span>
    </button>
  );
}

/** Opaque floating panel anchored to the trigger. */
function Panel({
  ref,
  onClose,
  children,
  className = "",
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        ref={ref}
        className={`absolute left-0 top-full mt-2 z-40 rounded-xl border border-[var(--color-border-strong)] p-3 shadow-2xl animate-fade-up ${className}`}
        style={{
          background: "var(--color-surface-2)",
          boxShadow: "0 20px 50px -16px rgba(0,0,0,0.85), 0 1px 0 rgba(255,255,255,0.05) inset",
        }}
      >
        {children}
      </div>
    </>
  );
}

/** A compact, scrollable column of values (hours / minutes). Height is
 * fixed via inline style so the list never sprawls, and the selected
 * value is scrolled into view when it mounts. */
function ScrollColumn({
  label,
  values,
  selected,
  onPick,
}: {
  label: string;
  values: number[];
  selected: number;
  onPick: (v: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = listRef.current;
    if (!c) return;
    const el = c.querySelector<HTMLElement>('[data-selected="true"]');
    if (el) c.scrollTop = el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2;
  }, []);

  return (
    <div>
      <div className="text-[0.65rem] font-medium uppercase tracking-wide text-[var(--color-text-faint)] mb-1 text-center">
        {label}
      </div>
      <div
        ref={listRef}
        className="relative overflow-y-auto space-y-0.5 w-12 pr-0.5"
        style={{ height: "11rem" }}
      >
        {values.map((v) => {
          const active = v === selected;
          return (
            <button
              key={v}
              type="button"
              data-selected={active}
              onClick={() => onPick(v)}
              className={`w-full py-1.5 rounded-lg text-sm transition ${
                active
                  ? "text-white bg-[var(--color-accent)] font-medium"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5"
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

/* ------------------------------------------------------------------ *
 * MonthPicker — value: "YYYY-MM"
 * ------------------------------------------------------------------ */
export function MonthPicker({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
}) {
  const { open, setOpen, ref } = usePopover();
  const [selYear, selMonth] = value ? value.split("-").map(Number) : [NaN, NaN];
  const [viewYear, setViewYear] = useState(
    Number.isFinite(selYear) ? selYear : new Date().getFullYear()
  );

  const label = value && Number.isFinite(selYear)
    ? `${MONTHS[selMonth - 1]} de ${selYear}`
    : "Selecione o mês";

  return (
    <div className="relative" id={id}>
      <TriggerButton
        onClick={() => setOpen((v) => !v)}
        placeholder={!value}
        icon={<Icon.calendar className="w-4 h-4" />}
      >
        {label}
      </TriggerButton>

      {open && (
        <Panel ref={ref} onClose={() => setOpen(false)} className="w-64">
          <div className="flex items-center justify-between mb-3 px-1">
            <button
              type="button"
              onClick={() => setViewYear((y) => y - 1)}
              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5 transition"
            >
              <Icon.chevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold">{viewYear}</span>
            <button
              type="button"
              onClick={() => setViewYear((y) => y + 1)}
              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5 transition"
            >
              <Icon.chevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {MONTHS_SHORT.map((m, i) => {
              const active = selYear === viewYear && selMonth === i + 1;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    onChange(`${viewYear}-${pad(i + 1)}`);
                    setOpen(false);
                  }}
                  className={`py-2 rounded-lg text-sm capitalize transition ${
                    active
                      ? "text-white bg-[var(--color-accent)] font-medium"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5"
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </Panel>
      )}
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
}: {
  value: string;
  onChange: (v: string) => void;
  name?: string;
  placeholder?: string;
}) {
  const { open, setOpen, ref } = usePopover();
  const sel = value ? value.split("-").map(Number) : null;
  const today = new Date();
  const [view, setView] = useState(() => ({
    year: sel ? sel[0] : today.getFullYear(),
    month: sel ? sel[1] - 1 : today.getMonth(), // 0-based
  }));

  const label = sel ? `${pad(sel[2])}/${pad(sel[1])}/${sel[0]}` : placeholder;

  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  return (
    <div className="relative">
      {name && <input type="hidden" name={name} value={value} />}
      <TriggerButton
        onClick={() => setOpen((v) => !v)}
        placeholder={!value}
        icon={<Icon.calendar className="w-4 h-4" />}
      >
        {label}
      </TriggerButton>

      {open && (
        <Panel ref={ref} onClose={() => setOpen(false)} className="w-72">
          <div className="flex items-center justify-between mb-3 px-1">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5 transition"
            >
              <Icon.chevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold capitalize">
              {MONTHS[view.month]} {view.year}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5 transition"
            >
              <Icon.chevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="text-center text-[0.65rem] font-medium uppercase tracking-wide text-[var(--color-text-faint)] py-1"
              >
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              if (day === null) return <div key={`e${i}`} />;
              const isSel = sel && sel[0] === view.year && sel[1] === view.month + 1 && sel[2] === day;
              const isToday =
                today.getFullYear() === view.year &&
                today.getMonth() === view.month &&
                today.getDate() === day;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    onChange(`${view.year}-${pad(view.month + 1)}-${pad(day)}`);
                    setOpen(false);
                  }}
                  className={`h-9 rounded-lg text-sm transition ${
                    isSel
                      ? "text-white bg-[var(--color-accent)] font-medium"
                      : isToday
                        ? "text-[var(--color-accent)] bg-white/5 font-medium"
                        : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {value && (
            <div className="mt-2 pt-2 border-t border-[var(--color-border)] flex justify-end">
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition"
              >
                Limpar
              </button>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * DateTimePicker — value: "YYYY-MM-DDTHH:MM" (datetime-local format).
 * Combines a calendar + time columns in one opaque panel. Renders a
 * hidden input so it drops into FormData-based forms unchanged.
 * ------------------------------------------------------------------ */
export function DateTimePicker({
  name,
  defaultValue = "",
  minuteStep = 5,
  placeholder = "Selecione data e horário",
  required,
  onChange,
}: {
  name?: string;
  defaultValue?: string;
  minuteStep?: number;
  placeholder?: string;
  required?: boolean;
  onChange?: (v: string) => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const [value, setValueState] = useState(defaultValue);
  const setValue = (v: string) => {
    setValueState(v);
    onChange?.(v);
  };

  const datePart = value.slice(0, 10);
  const timePart = value.slice(11, 16);
  const sel = datePart ? datePart.split("-").map(Number) : null;
  const [th, tm] = timePart ? timePart.split(":").map(Number) : [NaN, NaN];

  const today = new Date();
  const [view, setView] = useState(() => ({
    year: sel ? sel[0] : today.getFullYear(),
    month: sel ? sel[1] - 1 : today.getMonth(),
  }));

  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep);

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }
  function pickDate(y: number, mo: number, d: number) {
    const t = timePart || "12:00";
    setValue(`${y}-${pad(mo)}-${pad(d)}T${t}`);
  }
  function pickTime(nh: number, nm: number) {
    const dp = datePart || `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    setValue(`${dp}T${pad(nh)}:${pad(nm)}`);
  }

  const label = sel && timePart
    ? `${pad(sel[2])}/${pad(sel[1])}/${sel[0]} às ${timePart}`
    : placeholder;

  return (
    <div className="relative">
      {name && <input type="hidden" name={name} value={value} required={required} />}
      <TriggerButton
        onClick={() => setOpen((v) => !v)}
        placeholder={!value}
        icon={<Icon.calendar className="w-4 h-4" />}
      >
        {label}
      </TriggerButton>

      {open && (
        <Panel ref={ref} onClose={() => setOpen(false)} className="flex gap-3">
          {/* Calendar */}
          <div className="w-64">
            <div className="flex items-center justify-between mb-3 px-1">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5 transition"
              >
                <Icon.chevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold capitalize">
                {MONTHS[view.month]} {view.year}
              </span>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5 transition"
              >
                <Icon.chevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {WEEKDAYS.map((w) => (
                <div
                  key={w}
                  className="text-center text-[0.65rem] font-medium uppercase tracking-wide text-[var(--color-text-faint)] py-1"
                >
                  {w}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((day, i) => {
                if (day === null) return <div key={`e${i}`} />;
                const isSel = sel && sel[0] === view.year && sel[1] === view.month + 1 && sel[2] === day;
                const isToday =
                  today.getFullYear() === view.year &&
                  today.getMonth() === view.month &&
                  today.getDate() === day;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => pickDate(view.year, view.month + 1, day)}
                    className={`h-9 rounded-lg text-sm transition ${
                      isSel
                        ? "text-white bg-[var(--color-accent)] font-medium"
                        : isToday
                          ? "text-[var(--color-accent)] bg-white/5 font-medium"
                          : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time columns */}
          <div className="flex gap-2 border-l border-[var(--color-border)] pl-3">
            <ScrollColumn
              label="Hora"
              values={hours}
              selected={Number.isFinite(th) ? th : -1}
              onPick={(hh) => pickTime(hh, Number.isFinite(tm) ? tm : 0)}
            />
            <ScrollColumn
              label="Min"
              values={minutes}
              selected={Number.isFinite(tm) ? tm : -1}
              onPick={(mm) => pickTime(Number.isFinite(th) ? th : 12, mm)}
            />
          </div>
        </Panel>
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
}: {
  value: string;
  onChange: (v: string) => void;
  minuteStep?: number;
}) {
  const { open, setOpen, ref } = usePopover();
  const [h, m] = value ? value.split(":").map(Number) : [NaN, NaN];
  const hasValue = Number.isFinite(h) && Number.isFinite(m);

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep);

  function set(nh: number, nm: number) {
    onChange(`${pad(nh)}:${pad(nm)}`);
  }

  return (
    <div className="relative">
      <TriggerButton
        onClick={() => setOpen((v) => !v)}
        placeholder={!hasValue}
        icon={<Icon.clock className="w-4 h-4" />}
      >
        {hasValue ? `${pad(h)}:${pad(m)}` : "Selecione o horário"}
      </TriggerButton>

      {open && (
        <Panel ref={ref} onClose={() => setOpen(false)}>
          <div className="flex gap-2">
            <ScrollColumn
              label="Hora"
              values={hours}
              selected={Number.isFinite(h) ? h : -1}
              onPick={(hh) => set(hh, Number.isFinite(m) ? m : 0)}
            />
            <ScrollColumn
              label="Min"
              values={minutes}
              selected={Number.isFinite(m) ? m : -1}
              onPick={(mm) => set(Number.isFinite(h) ? h : 0, mm)}
            />
          </div>
        </Panel>
      )}
    </div>
  );
}
