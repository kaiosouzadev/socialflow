"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icons";

type Client = { id: string; name: string };

export default function CalendarFilters({
  clients,
  view,
  refKey,
  currentClientId,
  currentQuery,
}: {
  clients: Client[];
  view: string;
  refKey: string;
  currentClientId?: string;
  currentQuery: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(currentQuery);

  // sync input when the URL changes elsewhere (adjust state during render)
  const [prevQuery, setPrevQuery] = useState(currentQuery);
  if (currentQuery !== prevQuery) {
    setPrevQuery(currentQuery);
    setQuery(currentQuery);
  }

  function build(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      view,
      ref: refKey,
      clientId: currentClientId || undefined,
      q: query || undefined,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/calendar${params.size ? `?${params}` : ""}`;
  }

  // debounced search → updates the q param
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => {
      router.replace(build({ q: query || undefined }));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <Icon.users className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)] pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por cliente…"
          className="input !py-1.5 !pl-9 text-sm w-52"
        />
      </div>

      {clients.length > 0 && (
        <select
          className="input w-auto !py-1.5 text-sm"
          value={currentClientId ?? ""}
          onChange={(e) => router.push(build({ clientId: e.target.value || undefined }))}
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
  );
}
