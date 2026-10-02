"use client";

import { useRef, type KeyboardEvent } from "react";
import { Spinner } from "./Button";
import { useFieldControl } from "./Field";

/*
 * Controles binários e de escolha única (DESIGN e.5).
 * Switch: role="switch"; o estado nunca depende só de cor/posição (stateLabels).
 * SegmentedControl: radiogroup com um único ponto de Tab e setas (com volta).
 */

type SwitchBase = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** texto visível do estado, ex.: { on: "Sim", off: "Não" } (aria-hidden) */
  stateLabels?: { on: string; off: string };
  disabled?: boolean;
  /** salvando: desabilita + Spinner + aria-busy */
  loading?: boolean;
  invalid?: boolean;
  /** trilho 32×18 · 40×24 */
  size?: "sm" | "md";
  id?: string;
  /** <input type="hidden" value="true|false"> */
  name?: string;
  /** ids extras (ex.: erro em linha fora de um Field); dentro de <Field> soma-se à ajuda/erro dele */
  "aria-describedby"?: string;
};
export type SwitchProps = SwitchBase &
  ({ label: React.ReactNode; "aria-label"?: never } | { label?: never; "aria-label": string });

const TRACK_SIZE = { sm: "h-4.5 w-8", md: "h-6 w-10" } as const;
const THUMB_SIZE = { sm: "left-0.5 size-3", md: "left-0.75 size-4" } as const;
const THUMB_ON = { sm: "translate-x-3.5", md: "translate-x-4" } as const;

export function Switch(props: SwitchProps) {
  const {
    checked,
    onCheckedChange,
    stateLabels,
    disabled = false,
    loading = false,
    invalid,
    size = "md",
    id,
    name,
    label,
  } = props;
  const ariaLabel = props["aria-label"];
  const field = useFieldControl();
  const isInvalid = invalid ?? field?.invalid ?? false;
  const describedBy = [field?.describedBy, props["aria-describedby"]].filter(Boolean).join(" ") || undefined;
  const blocked = disabled || loading;
  // loading mantém as cores (o Spinner informa); disabled usa os tokens de desabilitado
  const looksDisabled = disabled && !loading;

  const border = isInvalid ? "border-danger-solid" : null;
  const track = looksDisabled
    ? `${border ?? "border-line"} bg-disabled`
    : checked
      ? `${border ?? "border-selected"} bg-selected ${blocked ? "" : "group-hover:ring-2 group-hover:ring-hover"}`
      : `${border ?? "border-line-strong"} bg-transparent ${blocked ? "" : "group-hover:bg-hover"}`;
  const thumb = looksDisabled ? "bg-fg-disabled" : checked ? "bg-on-selected" : "bg-fg-muted";

  return (
    <>
      <button
        type="button"
        role="switch"
        id={id ?? field?.id}
        aria-checked={checked}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={isInvalid || undefined}
        aria-busy={loading || undefined}
        disabled={blocked}
        onClick={() => onCheckedChange(!checked)}
        className={`group inline-flex min-h-11 items-center gap-3 rounded-control text-left text-sm focus-visible:outline-none sm:min-h-10 ${
          looksDisabled ? "cursor-not-allowed text-fg-disabled" : loading ? "cursor-progress text-fg" : "text-fg"
        }`}
      >
        <span
          aria-hidden="true"
          className={`relative shrink-0 rounded-full border transition-colors duration-(--sf-dur-base) group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-focus ${TRACK_SIZE[size]} ${track}`}
        >
          <span
            className={`absolute top-1/2 -translate-y-1/2 rounded-full transition-[translate,background-color] duration-(--sf-dur-base) ${THUMB_SIZE[size]} ${checked ? THUMB_ON[size] : ""} ${thumb}`}
          />
        </span>
        {label != null && <span>{label}</span>}
        {stateLabels && (
          <span aria-hidden="true" className={looksDisabled ? undefined : "text-fg-muted"}>
            {checked ? stateLabels.on : stateLabels.off}
          </span>
        )}
        {loading && <Spinner size={16} />}
      </button>
      {name && <input type="hidden" name={name} value={checked ? "true" : "false"} />}
    </>
  );
}

export type SegmentedOption<V extends string> = {
  value: V;
  label: string;
  icon?: React.ReactNode;
  hideLabel?: boolean;
  disabled?: boolean;
};
export type SegmentedControlProps<V extends string> = {
  value: V;
  onChange: (value: V) => void;
  options: readonly SegmentedOption<V>[];
  /** padrão "md" */
  size?: "sm" | "md";
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
  invalid?: boolean;
  /** <input type="hidden"> para formulários com FormData */
  name?: string;
} & ({ "aria-label": string } | { "aria-labelledby": string }); // dentro de Field kind="group": aria-labelledby={`${id}-label`}

/** Altura da opção: < sm 40/44 (CC7, A-033), ≥ sm 28/36. */
const OPTION_HEIGHT = { sm: "h-10 sm:h-7", md: "h-11 sm:h-9" } as const;

export function SegmentedControl<V extends string>(props: SegmentedControlProps<V>) {
  const { value, onChange, options, size = "md", fullWidth = false, disabled = false, loading = false, invalid, name } =
    props;
  const ariaLabel = "aria-label" in props ? props["aria-label"] : undefined;
  const ariaLabelledby = "aria-labelledby" in props ? props["aria-labelledby"] : undefined;
  const field = useFieldControl();
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const blocked = disabled || loading;
  const isInvalid = invalid ?? field?.invalid ?? false;

  const enabled = options.flatMap((o, i) => (o.disabled ? [] : [i]));
  const selectedIndex = options.findIndex((o) => o.value === value);
  const tabStop = selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : (enabled[0] ?? -1);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (enabled.length === 0) return;
    const pos = enabled.indexOf(index);
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = enabled[(pos + 1) % enabled.length];
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = enabled[(pos - 1 + enabled.length) % enabled.length];
        break;
      case "Home":
        next = enabled[0];
        break;
      case "End":
        next = enabled[enabled.length - 1];
        break;
      default:
        return;
    }
    e.preventDefault();
    onChange(options[next].value);
    optionRefs.current[next]?.focus();
  }

  return (
    <div className={`${fullWidth ? "flex w-full" : "inline-flex"} items-center gap-2`}>
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={field?.describedBy}
        aria-invalid={isInvalid || undefined}
        aria-disabled={blocked || undefined}
        aria-busy={loading || undefined}
        className={`${fullWidth ? "flex w-full" : "inline-flex"} gap-0.5 rounded-control border bg-surface p-0.5 ${
          isInvalid ? "border-danger-solid" : "border-line-strong"
        }`}
      >
        {options.map((option, index) => {
          const checked = option.value === value;
          const optionDisabled = blocked || !!option.disabled;
          const look = checked
            ? disabled
              ? "bg-disabled text-fg-disabled"
              : "bg-selected text-on-selected"
            : optionDisabled
              ? "text-fg-disabled"
              : "text-fg-muted hover:bg-hover hover:text-fg";
          return (
            <button
              key={option.value}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={option.hideLabel ? option.label : undefined}
              title={option.hideLabel ? option.label : undefined}
              tabIndex={index === tabStop ? 0 : -1}
              disabled={optionDisabled}
              onClick={() => onChange(option.value)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={`inline-flex min-w-10 items-center justify-center gap-1.5 rounded-chip px-3 text-sm font-medium transition-colors duration-(--sf-dur-base) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-not-allowed ${OPTION_HEIGHT[size]} ${fullWidth ? "flex-1" : ""} ${look}`}
            >
              {option.icon && (
                <span aria-hidden="true" className="inline-flex size-4 shrink-0 [&>svg]:size-full">
                  {option.icon}
                </span>
              )}
              {!option.hideLabel && <span>{option.label}</span>}
            </button>
          );
        })}
      </div>
      {loading && <Spinner size={16} />}
      {name && <input type="hidden" name={name} value={value} />}
    </div>
  );
}
