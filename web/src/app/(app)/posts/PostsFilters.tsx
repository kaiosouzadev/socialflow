"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buttonClasses } from "@/components/Button";
import { Field, Input, Select } from "@/components/Field";
import { Icon } from "@/components/Icons";
import { shiftRef, rangeLabel, spDateKey, type RangeKind } from "@/lib/date-range";
import { formatMonthLabel } from "@/lib/format-date";
import type { ListRange } from "./list-query";

type Client = { id: string; name: string };

const STATUS_FILTERS = [
  { label: "Todos", value: "" },
  { label: "Rascunhos", value: "draft" },
  { label: "Agendados", value: "scheduled" },
  { label: "Publicados", value: "published" },
  { label: "Falharam", value: "failed" },
];

/* "Próximos" é o padrão (sem `range` na URL): de hoje em diante, atrasados/falhas no topo (U-19). */
const RANGE_FILTERS: { label: string; value: ListRange }[] = [
  { label: "Próximos", value: "upcoming" },
  { label: "Todas", value: "all" },
  { label: "Dia", value: "day" },
  { label: "Semana", value: "week" },
  { label: "Mês", value: "month" },
];

/** Períodos com data de referência (setas, "Hoje" e `ref` na URL). */
type DatedRange = Exclude<RangeKind, "all">;
const isDated = (r: ListRange): r is DatedRange => r !== "all" && r !== "upcoming";

/** Nome acessível das setas de período (A-014). */
const STEP_LABELS: Record<DatedRange, { prev: string; next: string }> = {
  day: { prev: "Dia anterior", next: "Próximo dia" },
  week: { prev: "Semana anterior", next: "Próxima semana" },
  month: { prev: "Mês anterior", next: "Próximo mês" },
};

/* Pílulas de status: ativa = `selected` + `on-selected` (contraste verificado no DESIGN b; A-005). */
const PILL =
  "inline-flex min-h-10 items-center rounded-control border px-3 text-sm font-medium transition-colors duration-(--sf-dur-fast) sm:min-h-8";
const PILL_ON = "border-selected bg-selected text-on-selected";
const PILL_OFF = "border-line-strong bg-surface text-fg-muted hover:bg-hover hover:text-fg";

/* Período: mesmo visual do SegmentedControl sm (DESIGN e.5), mas com links (estado na URL). */
const SEGMENT =
  "inline-flex min-h-10 min-w-10 items-center justify-center rounded-chip px-3 text-sm font-medium transition-colors duration-(--sf-dur-fast) focus-visible:outline-offset-1 sm:min-h-7";
const SEGMENT_ON = "bg-selected text-on-selected";
const SEGMENT_OFF = "text-fg-muted hover:bg-hover hover:text-fg";

export default function PostsFilters({
  clients,
  currentStatus,
  currentClientId,
  currentRange,
  currentRef,
  currentQuery,
}: {
  clients: Client[];
  currentStatus?: string;
  currentClientId?: string;
  currentRange: ListRange;
  currentRef: string;
  currentQuery: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(currentQuery);

  // keep input in sync if the URL changes elsewhere (e.g. back button):
  // React's "adjust state during render" pattern (no effect needed).
  const [prevQuery, setPrevQuery] = useState(currentQuery);
  if (currentQuery !== prevQuery) {
    setPrevQuery(currentQuery);
    setQuery(currentQuery);
  }

  function build(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      status: currentStatus || undefined,
      clientId: currentClientId || undefined,
      // "Próximos" é o padrão: fica fora da URL
      range: currentRange !== "upcoming" ? currentRange : undefined,
      ref: isDated(currentRange) ? currentRef : undefined,
      q: query || undefined,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/posts${params.size ? `?${params}` : ""}`;
  }

  // debounced search → updates the q param, resets to page 1
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => {
      router.replace(build({ q: query || undefined, page: undefined }));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const dated = isDated(currentRange) ? currentRange : null;
  const step = dated ? STEP_LABELS[dated] : null;

  return (
    <div className="mb-6 grid gap-3">
      {/* Busca (tema ou cliente) + cliente. Com um cliente escolhido, a busca é só por tema (A-031). */}
      <div className="flex flex-wrap items-center gap-2">
        <Field label="Buscar posts" labelHidden className="min-w-0 flex-1 basis-64">
          <Input
            type="search"
            size="sm"
            leadingIcon={<Icon.search />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={currentClientId ? "Buscar por tema" : "Buscar por tema ou cliente"}
            autoComplete="off"
          />
        </Field>

        {clients.length > 0 && (
          <Field label="Cliente" labelHidden className="w-full sm:w-60">
            <Select
              size="sm"
              placeholderOption="Todos os clientes"
              value={currentClientId ?? ""}
              onChange={(e) => router.push(build({ clientId: e.target.value || undefined, page: undefined }))}
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {/* Status */}
      <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => {
          const active = (currentStatus ?? "") === f.value;
          return (
            <Link
              key={f.value}
              href={build({ status: f.value || undefined, page: undefined })}
              aria-current={active ? "true" : undefined}
              className={`${PILL} ${active ? PILL_ON : PILL_OFF}`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {/* Período */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Período"
          className="inline-flex gap-0.5 rounded-control border border-line-strong bg-surface p-0.5"
        >
          {RANGE_FILTERS.map((r) => {
            const active = currentRange === r.value;
            return (
              <Link
                key={r.value}
                href={build({
                  range: r.value !== "upcoming" ? r.value : undefined,
                  ref: isDated(r.value) ? (isDated(currentRange) ? currentRef : spDateKey()) : undefined,
                  page: undefined,
                })}
                aria-current={active ? "true" : undefined}
                className={`${SEGMENT} ${active ? SEGMENT_ON : SEGMENT_OFF}`}
              >
                {r.label}
              </Link>
            );
          })}
        </div>

        {step && dated && (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={build({ ref: shiftRef(dated, currentRef, -1), page: undefined })}
              aria-label={step.prev}
              title={step.prev}
              className={buttonClasses({ variant: "secondary", size: "sm", iconOnly: true })}
            >
              <Icon.chevronLeft className="size-4" />
            </Link>
            <Link
              href={build({ ref: shiftRef(dated, currentRef, 1), page: undefined })}
              aria-label={step.next}
              title={step.next}
              className={buttonClasses({ variant: "secondary", size: "sm", iconOnly: true })}
            >
              <Icon.chevronRight className="size-4" />
            </Link>
            <Link
              href={build({ ref: spDateKey(), page: undefined })}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Hoje
            </Link>
            <span aria-live="polite" className="ml-1 text-sm font-medium text-fg">
              {/* inicial maiúscula só no mês (A-019, sem CSS): dia e semana começam com número */}
              {dated === "month" ? formatMonthLabel(currentRef) : rangeLabel(dated, currentRef)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
