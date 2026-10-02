"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Field, Input, Select } from "@/components/Field";
import { Icon } from "@/components/Icons";

type Client = { id: string; name: string };

/**
 * Busca + cliente do Calendário (mesmo padrão de /posts). A busca procura no tema
 * ou no nome do cliente; com um cliente escolhido no select, só no tema (A-031).
 * O período, a visualização e o atalho de falhas (status) são preservados na URL.
 */
export default function CalendarFilters({
  clients,
  view,
  refKey,
  currentClientId,
  currentQuery,
  currentStatus,
}: {
  clients: Client[];
  view: string;
  refKey: string;
  currentClientId?: string;
  currentQuery: string;
  currentStatus?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(currentQuery);

  // sync input when the URL changes elsewhere (adjust state during render); não apaga o
  // espaço que a pessoa acabou de digitar quando a URL só confirma a mesma busca
  const [prevQuery, setPrevQuery] = useState(currentQuery);
  if (currentQuery !== prevQuery) {
    setPrevQuery(currentQuery);
    if (currentQuery !== query.trim()) setQuery(currentQuery);
  }

  function build(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      view,
      ref: refKey,
      clientId: currentClientId || undefined,
      q: query.trim() || undefined,
      status: currentStatus || undefined,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/calendar${params.size ? `?${params}` : ""}`;
  }

  // debounced search → updates the q param. Só navega quando o texto difere da URL: com a
  // "flag de primeiro render", o Strict Mode (dev) rodava o efeito 2× e fazia um replace
  // para a mesma URL logo após abrir a página.
  useEffect(() => {
    const next = query.trim();
    if (next === currentQuery) return;
    const t = setTimeout(() => {
      router.replace(build({ q: next || undefined }));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, currentQuery]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
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
            onChange={(e) => router.push(build({ clientId: e.target.value || undefined }))}
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
  );
}
