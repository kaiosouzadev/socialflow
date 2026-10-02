"use client";

import { createContext, forwardRef, useContext, useId, useState } from "react";
import { Spinner } from "./Button";
import { Icon } from "./Icons";

/*
 * Rótulo + controle + ajuda + erro (DESIGN e.4) [A-004]. O controle dentro de
 * <Field> lê o contexto e aplica sozinho id, aria-describedby (ajuda + erro),
 * aria-invalid e required/aria-required. Fora de <Field>, valem as props.
 */

type FieldControl = { id: string; labelId: string; describedBy?: string; invalid: boolean; required: boolean };

const FieldContext = createContext<FieldControl | null>(null);

export type FieldProps = {
  label: React.ReactNode;
  /** UM controle: Input, Textarea, Select, DatePicker, MonthPicker, MultiEmailInput, SegmentedControl… */
  children: React.ReactNode;
  help?: React.ReactNode;
  error?: string | null;
  /** required + aria-required no controle; sem marca visual */
  required?: boolean;
  /** mostra "(opcional)" após o rótulo */
  optional?: boolean;
  /** "group" → <fieldset><legend> (SegmentedControl, checkboxes, radios) */
  kind?: "control" | "group";
  /** rótulo sr-only (edição em linha em tabela) */
  labelHidden?: boolean;
  /** padrão: useId(). O rótulo fica em `${id}-label`, a ajuda em `${id}-help` e o erro em `${id}-error` */
  id?: string;
  className?: string;
};

/** Dados do <Field> em volta (id, labelId, describedBy, invalid, required) ou null fora dele. */
export function useFieldControl(): FieldControl | null {
  return useContext(FieldContext);
}

function joinIds(...ids: (string | undefined | null | false)[]): string | undefined {
  const value = ids.filter(Boolean).join(" ");
  return value || undefined;
}

export function Label({ className = "", ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={`text-sm font-medium text-fg ${className}`} />;
}

export function Field({
  label,
  children,
  help,
  error,
  required = false,
  optional = false,
  kind = "control",
  labelHidden = false,
  id: idProp,
  className = "",
}: FieldProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const labelId = `${id}-label`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const control: FieldControl = {
    id,
    labelId,
    describedBy: joinIds(help ? helpId : null, error ? errorId : null),
    invalid: !!error,
    required,
  };

  const labelContent = (
    <>
      {label}
      {optional && <span className="font-normal text-fg-muted"> (opcional)</span>}
    </>
  );
  const helpNode = help ? (
    <div id={helpId} className="text-xs text-fg-muted">
      {help}
    </div>
  ) : null;
  const errorNode = error ? (
    <p id={errorId} className="flex items-start gap-1 text-xs font-medium text-danger-fg">
      <span aria-hidden="true" className="mt-px inline-flex size-3.5 shrink-0 text-danger-solid [&>svg]:size-full">
        <Icon.alert />
      </span>
      {error}
    </p>
  ) : null;

  if (kind === "group") {
    return (
      <fieldset aria-describedby={control.describedBy} className={`m-0 min-w-0 border-0 p-0 ${className}`}>
        <legend id={labelId} className={labelHidden ? "sr-only" : "mb-1.5 p-0 text-sm font-medium text-fg"}>
          {labelContent}
        </legend>
        <div className="grid gap-1.5">
          <FieldContext.Provider value={control}>{children}</FieldContext.Provider>
          {helpNode}
          {errorNode}
        </div>
      </fieldset>
    );
  }

  return (
    <div className={`grid gap-1.5 ${className}`}>
      <Label id={labelId} htmlFor={id} className={labelHidden ? "sr-only" : ""}>
        {labelContent}
      </Label>
      <FieldContext.Provider value={control}>{children}</FieldContext.Provider>
      {helpNode}
      {errorNode}
    </div>
  );
}

export type ControlSize = "sm" | "md";

const CONTROL_BASE =
  "w-full rounded-control border text-base text-fg transition-colors duration-(--sf-dur-fast) placeholder:text-fg-faint focus:border-focus focus:outline-2 focus:outline-offset-1 focus:outline-focus disabled:cursor-not-allowed disabled:border-line disabled:bg-disabled disabled:text-fg-disabled sm:text-sm";

const CONTROL_HEIGHT: Record<ControlSize, string> = { sm: "h-10 sm:h-8", md: "h-11 sm:h-10" };

/** Borda e fundo por estado (um valor só por propriedade; o disabled vence por variante). */
function controlState(invalid: boolean, readOnly: boolean | undefined) {
  if (invalid) return `border-danger-solid ${readOnly ? "bg-sunken" : "bg-surface"}`;
  if (readOnly) return "border-line bg-sunken";
  return "border-line-strong bg-surface hover:border-fg-muted";
}

/** Atributos de acessibilidade do controle: as props explícitas somam/vencem o contexto do Field. */
function useControlA11y(p: {
  id?: string;
  invalid?: boolean;
  required?: boolean;
  describedBy?: string;
}) {
  const field = useFieldControl();
  const invalid = p.invalid ?? field?.invalid ?? false;
  const required = p.required ?? field?.required ?? false;
  return {
    id: p.id ?? field?.id,
    invalid,
    required,
    attrs: {
      "aria-invalid": invalid || undefined,
      "aria-required": required || undefined,
      "aria-describedby": joinIds(field?.describedBy, p.describedBy),
      required: required || undefined,
    },
  };
}

export const Input = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
    size?: ControlSize;
    invalid?: boolean;
    leadingIcon?: React.ReactNode;
    trailingSlot?: React.ReactNode;
  }
>(function Input(
  { size = "md", invalid, leadingIcon, trailingSlot, className = "", id, required, "aria-describedby": describedBy, ...rest },
  ref,
) {
  const a11y = useControlA11y({ id, invalid, required, describedBy });
  const padding = `${leadingIcon ? "pl-9" : "pl-3"} ${trailingSlot ? "pr-11 sm:pr-10" : "pr-3"}`;
  const classes = `${CONTROL_BASE} ${CONTROL_HEIGHT[size]} ${padding} ${controlState(a11y.invalid, rest.readOnly)}`;

  if (!leadingIcon && !trailingSlot) {
    return <input {...rest} {...a11y.attrs} ref={ref} id={a11y.id} className={`${classes} ${className}`} />;
  }
  // com adornos, a largura vem do invólucro (className vai nele)
  return (
    <div className={`relative w-full ${className}`}>
      {leadingIcon && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 inline-flex size-4 -translate-y-1/2 text-fg-muted [&>svg]:size-full"
        >
          {leadingIcon}
        </span>
      )}
      <input {...rest} {...a11y.attrs} ref={ref} id={a11y.id} className={classes} />
      {trailingSlot && (
        <span className="absolute right-0.5 top-1/2 inline-flex -translate-y-1/2 items-center">{trailingSlot}</span>
      )}
    </div>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    invalid?: boolean;
    /** com maxLength → "120/2000" */
    showCount?: boolean;
  }
>(function Textarea(
  { invalid, showCount = false, className = "", id, required, onChange, "aria-describedby": describedBy, ...rest },
  ref,
) {
  const countId = useId();
  const withCount = showCount && rest.maxLength !== undefined;
  const a11y = useControlA11y({ id, invalid, required, describedBy: joinIds(describedBy, withCount && countId) });
  // não controlado: conta o que foi digitado; controlado: conta o `value`
  const [typed, setTyped] = useState(() => String(rest.defaultValue ?? "").length);
  const count = rest.value !== undefined ? String(rest.value).length : typed;

  const textarea = (
    <textarea
      {...rest}
      {...a11y.attrs}
      ref={ref}
      id={a11y.id}
      onChange={(e) => {
        setTyped(e.target.value.length);
        onChange?.(e);
      }}
      className={`${CONTROL_BASE} min-h-24 resize-y px-3 py-2.5 ${controlState(a11y.invalid, rest.readOnly)} ${className}`}
    />
  );
  if (!withCount) return textarea;
  return (
    <div className="grid gap-1">
      {textarea}
      <p id={countId} className="justify-self-end text-xs tabular-nums text-fg-muted">
        {count}/{rest.maxLength}
      </p>
    </div>
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
    size?: ControlSize;
    invalid?: boolean;
    loading?: boolean;
    /** 1ª <option value=""> (ex.: "Selecione…") */
    placeholderOption?: string;
  }
>(function Select(
  {
    size = "md",
    invalid,
    loading = false,
    placeholderOption,
    className = "",
    id,
    required,
    disabled,
    children,
    "aria-describedby": describedBy,
    ...rest
  },
  ref,
) {
  const a11y = useControlA11y({ id, invalid, required, describedBy });
  return (
    // a largura vem do invólucro (className vai nele), para a seta acompanhar o select
    <div className={`relative w-full ${className}`}>
      <select
        {...rest}
        {...a11y.attrs}
        ref={ref}
        id={a11y.id}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={`${CONTROL_BASE} ${CONTROL_HEIGHT[size]} appearance-none pl-3 pr-9 ${controlState(a11y.invalid, false)} [&_option]:bg-raised [&_option]:text-fg`}
      >
        {loading ? (
          <option value="">Carregando…</option>
        ) : (
          <>
            {placeholderOption !== undefined && <option value="">{placeholderOption}</option>}
            {children}
          </>
        )}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 inline-flex -translate-y-1/2 text-fg-muted"
      >
        {loading ? <Spinner size={16} /> : <Icon.chevronDown className="size-4" />}
      </span>
    </div>
  );
});
