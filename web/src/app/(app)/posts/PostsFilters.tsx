"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icons";
import { shiftRef, rangeLabel, spDateKey, type RangeKind } from "@/lib/date-range";

type Client = { id: string; name: string };

const STATUS_FILTERS = [
  { label: "Todos", value: "" },
  { label: "Rascunhos", value: "draft" },
  { label: "Agendados", value: "scheduled" },
  { label: "Publicados", value: "published" },
  { label: "Falharam", value: "failed" },
];

const RANGE_FILTERS: { label: string; value: RangeKind }[] = [
  { label: "Todas", value: "all" },
  { label: "Dia", value: "day" },
  { label: "Semana", value: "week" },
  { label: "Mês", value: "month" },
];

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
  currentRange: RangeKind;
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
      range: currentRange !== "all" ? currentRange : undefined,
      ref: currentRange !== "all" ? currentRef : undefined,
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

  return (
    <div className="space-y-3 mb-6">
      {/* Row 1 — status + client + search */}
      <div className="flex gap-2 flex-wrap items-center">
        {STATUS_FILTERS.map((f) => {
          const active = (currentStatus ?? "") === f.value;
          return (
            <Link
              key={f.value}
              href={build({ status: f.value || undefined, page: undefined })}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                active
                  ? "text-white border border-transparent"
                  : "text-[var(--color-text-muted)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:text-white"
              }`}
              style={active ? { background: "linear-gradient(135deg,#7c5cff,#a855f7)" } : undefined}
            >
              {f.label}
            </Link>
          );
        })}

        <div className="relative ml-auto">
          <Icon.users className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)] pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por cliente…"
            className="input !py-1.5 !pl-9 text-sm w-56"
          />
        </div>

        {clients.length > 0 && (
          <select
            className="input w-auto !py-1.5 text-sm"
            value={currentClientId ?? ""}
            onChange={(e) => router.push(build({ clientId: e.target.value || undefined, page: undefined }))}
          >
            <option value="">Todos os clientes</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Row 2 — date range */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="flex items-center rounded-lg border border-[var(--color-border)] overflow-hidden text-sm">
          {RANGE_FILTERS.map((r) => {
            const active = currentRange === r.value;
            return (
              <Link
                key={r.value}
                href={build({
                  range: r.value !== "all" ? r.value : undefined,
                  ref: r.value !== "all" ? (currentRange === "all" ? spDateKey() : currentRef) : undefined,
                  page: undefined,
                })}
                className={`px-3.5 py-1.5 font-medium transition-colors ${
                  active ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-text-muted)] hover:text-white"
                }`}
              >
                {r.label}
              </Link>
            );
          })}
        </div>

        {currentRange !== "all" && (
          <div className="flex items-center gap-2">
            <Link
              href={build({ ref: shiftRef(currentRange, currentRef, -1), page: undefined })}
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-white hover:border-[var(--color-border-strong)] transition-colors"
            >
              <Icon.chevronLeft className="w-4 h-4" />
            </Link>
            <Link
              href={build({ ref: shiftRef(currentRange, currentRef, 1), page: undefined })}
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-white hover:border-[var(--color-border-strong)] transition-colors"
            >
              <Icon.chevronRight className="w-4 h-4" />
            </Link>
            <Link href={build({ ref: spDateKey(), page: undefined })} className="btn-ghost !py-1.5 text-sm">
              Hoje
            </Link>
            <span className="ml-1 text-sm font-medium capitalize text-[var(--color-text-muted)]">
              {rangeLabel(currentRange, currentRef)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
