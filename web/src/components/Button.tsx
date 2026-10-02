import { forwardRef } from "react";

/*
 * Botão do design system (DESIGN e.1). Sem "use client": `buttonClasses()` e
 * `Spinner` também servem a componentes de servidor (ex.: <Link> com cara de botão).
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonBase = {
  /** padrão "secondary" */
  variant?: ButtonVariant;
  /** padrão "md" */
  size?: ButtonSize;
  /** desabilita, marca aria-busy e troca o leadingIcon por um Spinner */
  loading?: boolean;
  /** texto durante o carregamento (ex.: "Enviando…"); sem ele o texto se mantém */
  loadingText?: string;
  /** 16 (sm) · 18 (md) · 20 (lg) px */
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  fullWidth?: boolean;
};
type NativeButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">;
export type TextButtonProps = ButtonBase & NativeButtonProps & { iconOnly?: false; children: React.ReactNode };
export type IconButtonProps = ButtonBase &
  Omit<NativeButtonProps, "aria-label"> & {
    iconOnly: true;
    /** OBRIGATÓRIO pelo tipo (A-014): sem ele o tsc falha */
    "aria-label": string;
    /** o ícone */
    children: React.ReactElement;
  };
export type ButtonProps = TextButtonProps | IconButtonProps;

const BASE =
  "inline-flex select-none items-center justify-center rounded-control border font-semibold transition-colors duration-(--sf-dur-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** Altura mínima: < sm é maior (alvo de toque; CC7), ≥ sm volta a 32/40/48. */
const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-10 gap-1.5 px-3 text-sm sm:min-h-8",
  md: "min-h-11 gap-2 px-4 text-sm sm:min-h-10",
  lg: "min-h-12 gap-2 px-5 text-base",
};
const ICON_ONLY_SIZE: Record<ButtonSize, string> = {
  sm: "size-10 sm:size-8",
  md: "size-11 sm:size-10",
  lg: "size-12",
};
const ICON_SIZE: Record<ButtonSize, string> = { sm: "size-4", md: "size-4.5", lg: "size-5" };

const VARIANT_IDLE: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-primary text-on-primary",
  secondary: "border-line-strong bg-surface text-fg",
  ghost: "border-transparent bg-transparent text-fg-muted",
  danger: "border-transparent bg-danger-solid text-on-danger",
};
const VARIANT_INTERACTIVE: Record<ButtonVariant, string> = {
  primary: "hover:bg-primary-hover active:bg-primary-press",
  secondary: "hover:bg-hover active:bg-press",
  ghost: "hover:bg-hover hover:text-fg active:bg-press active:text-fg",
  danger: "hover:bg-danger-hover active:bg-danger-hover",
};
/** Desabilitado por tokens, sem `opacity` (a.4). */
const VARIANT_DISABLED: Record<ButtonVariant, string> = {
  primary: "cursor-not-allowed border-transparent bg-disabled text-fg-disabled",
  secondary: "cursor-not-allowed border-line bg-disabled text-fg-disabled",
  ghost: "cursor-not-allowed border-transparent bg-transparent text-fg-disabled",
  danger: "cursor-not-allowed border-transparent bg-disabled text-fg-disabled",
};

type ClassOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  iconOnly?: boolean;
};

function classesFor(
  { variant = "secondary", size = "md", fullWidth = false, iconOnly = false }: ClassOptions,
  state: "idle" | "disabled" | "loading",
) {
  const sizing = iconOnly ? `${ICON_ONLY_SIZE[size]} shrink-0 p-0` : SIZE[size];
  const width = fullWidth ? "w-full whitespace-normal text-center" : "whitespace-nowrap";
  const look =
    state === "disabled"
      ? VARIANT_DISABLED[variant]
      : state === "loading"
        ? `${VARIANT_IDLE[variant]} cursor-progress`
        : `${VARIANT_IDLE[variant]} ${VARIANT_INTERACTIVE[variant]}`;
  return `${BASE} ${sizing} ${width} ${look}`;
}

/** Mesmas classes do Button, para <Link> e <a> com cara de botão. */
export function buttonClasses(o: ClassOptions = {}): string {
  return classesFor(o, "idle");
}

/** Indicador de progresso. aria-hidden; com `label` vira role="status" com texto sr-only. */
export function Spinner({ size = 16, label }: { size?: 16 | 20; label?: string }) {
  const svg = (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={`${size === 20 ? "size-5" : "size-4"} shrink-0 animate-spin`}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
  if (!label) return svg;
  return (
    <span role="status" className="inline-flex items-center">
      {svg}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function IconSlot({ size, children }: { size: ButtonSize; children: React.ReactNode }) {
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 ${ICON_SIZE[size]} [&>svg]:size-full`}>
      {children}
    </span>
  );
}

/**
 * Ação clicável com variantes, tamanhos e carregando (DESIGN e.1).
 * `type="button"` é o padrão. Só com ícone: `iconOnly` + `aria-label` (exigido pelo tipo).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const {
    variant = "secondary",
    size = "md",
    loading = false,
    loadingText,
    leadingIcon,
    trailingIcon,
    fullWidth = false,
    iconOnly = false,
    className = "",
    children,
    disabled,
    type = "button",
    ...native
  } = props;

  const state = loading ? "loading" : disabled ? "disabled" : "idle";
  const spinner = <Spinner size={size === "lg" ? 20 : 16} />;

  return (
    <button
      {...native}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${classesFor({ variant, size, fullWidth, iconOnly }, state)} ${className}`}
    >
      {iconOnly ? (
        loading ? (
          spinner
        ) : (
          <IconSlot size={size}>{children}</IconSlot>
        )
      ) : (
        <>
          {loading ? spinner : leadingIcon ? <IconSlot size={size}>{leadingIcon}</IconSlot> : null}
          <span>{loading && loadingText ? loadingText : children}</span>
          {!loading && trailingIcon ? <IconSlot size={size}>{trailingIcon}</IconSlot> : null}
        </>
      )}
    </button>
  );
});
