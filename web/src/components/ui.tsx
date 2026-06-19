import Link from "next/link";
import { Icon } from "./Icons";
import { BrandBadge } from "./BrandIcons";

export function PageHeader({
  title,
  subtitle,
  action,
  back,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  back?: string;
}) {
  return (
    <div className="mb-8 flex items-start justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        {back && (
          <Link
            href={back}
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-white hover:border-[var(--color-border-strong)] transition-colors shrink-0"
          >
            <Icon.back className="w-[18px] h-[18px]" />
          </Link>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight truncate">{title}</h1>
          {subtitle && (
            <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: "text-violet-200 bg-violet-500/10 border-violet-500/25",
  scheduled: "text-sky-300 bg-sky-500/10 border-sky-500/20",
  publishing: "text-amber-300 bg-amber-500/10 border-amber-500/20",
  published: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20",
  failed: "text-red-300 bg-red-500/10 border-red-500/20",
  active: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20",
  inactive: "text-zinc-400 bg-white/5 border-white/10",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  scheduled: "Agendado",
  publishing: "Publicando",
  published: "Publicado",
  failed: "Falhou",
  active: "Ativa",
  inactive: "Inativa",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "text-zinc-300 bg-white/5 border-white/10";
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${style}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {label}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card px-6 py-16 text-center">
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
        style={{ background: "rgba(124,92,255,0.1)", border: "1px solid rgba(124,92,255,0.2)" }}
      >
        <Icon.zap className="w-5 h-5 text-[var(--color-accent)]" />
      </div>
      <p className="font-medium">{title}</p>
      {description && (
        <p className="text-sm text-[var(--color-text-muted)] mt-1">{description}</p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function PlatformChip({ platform }: { platform: string }) {
  return <BrandBadge platform={platform} size={22} className="rounded-md" />;
}
