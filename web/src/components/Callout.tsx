import { Button } from "./Button";
import { Icon } from "./Icons";

/*
 * Mensagem em bloco com tom e papel ARIA (DESIGN e.6). Sem "use client": também
 * serve a componentes de servidor (sem `onDismiss`, que é função).
 */

export type CalloutTone = "info" | "success" | "warning" | "danger";
export type CalloutProps = {
  tone: CalloutTone;
  title?: string;
  children?: React.ReactNode;
  /** Button size="sm" ou link */
  action?: React.ReactNode;
  /** mostra o X "Fechar aviso" */
  onDismiss?: () => void;
  /** padrão "off"; polite → role="status"; assertive → role="alert" */
  live?: "off" | "polite" | "assertive";
  /** padrão: ícone do tom; false = sem ícone */
  icon?: React.ReactNode | false;
  className?: string;
};

const TONE: Record<CalloutTone, { box: string; icon: string; title: string }> = {
  info: { box: "border-info-line bg-info-bg", icon: "text-info-solid", title: "text-info-fg" },
  success: { box: "border-success-line bg-success-bg", icon: "text-success-solid", title: "text-success-fg" },
  warning: { box: "border-warning-line bg-warning-bg", icon: "text-warning-solid", title: "text-warning-fg" },
  danger: { box: "border-danger-line bg-danger-bg", icon: "text-danger-solid", title: "text-danger-fg" },
};

const TONE_ICON: Record<CalloutTone, (p: { className?: string }) => React.ReactNode> = {
  info: Icon.info,
  success: Icon.check,
  warning: Icon.alert,
  danger: Icon.xCircle,
};

/** Colunas da grade conforme as partes presentes: [ícone] [texto] [X]. */
const COLUMNS = {
  iconAndClose: "grid-cols-[20px_minmax(0,1fr)_auto]",
  icon: "grid-cols-[20px_minmax(0,1fr)]",
  close: "grid-cols-[minmax(0,1fr)_auto]",
  none: "grid-cols-1",
} as const;

export function Callout({
  tone,
  title,
  children,
  action,
  onDismiss,
  live = "off",
  icon,
  className = "",
}: CalloutProps) {
  const t = TONE[tone];
  const role = live === "assertive" ? "alert" : live === "polite" ? "status" : undefined;
  const ToneIcon = TONE_ICON[tone];
  const iconNode = icon === false ? null : (icon ?? <ToneIcon />);
  const columns = iconNode ? (onDismiss ? COLUMNS.iconAndClose : COLUMNS.icon) : onDismiss ? COLUMNS.close : COLUMNS.none;

  return (
    <div role={role} className={`grid gap-x-3 rounded-card border p-3 sm:p-4 ${columns} ${t.box} ${className}`}>
      {iconNode && (
        <span aria-hidden="true" className={`mt-px inline-flex size-5 shrink-0 [&>svg]:size-full ${t.icon}`}>
          {iconNode}
        </span>
      )}
      <div className="min-w-0 text-sm text-fg [&_a]:text-link [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-link-hover">
        {title && <p className={`font-semibold ${t.title}`}>{title}</p>}
        {children != null && children !== false && <div className={title ? "mt-1" : undefined}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {onDismiss && (
        <Button iconOnly variant="ghost" size="sm" aria-label="Fechar aviso" onClick={onDismiss} className="-my-1 -mr-1">
          <Icon.x />
        </Button>
      )}
    </div>
  );
}
