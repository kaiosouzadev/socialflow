"use client";

import { Button } from "@/components/Button";
import { Field, Input, Select } from "@/components/Field";
import { Icon } from "@/components/Icons";
import { hasActiveFilters, NO_FILTERS, STATUS_OPTIONS, type ScheduleFilters as Filters } from "./schedules-view";

/*
 * Filtros de /aprovacoes (F13): cliente (busca), mês (meses que existem na lista) e status.
 * Aplicam na hora, no navegador; a URL acompanha (?q=&mes=&status=) pelo pai.
 */
export default function ScheduleFilters({
  value,
  months,
  summary,
  onChange,
}: {
  value: Filters;
  months: { value: string; label: string }[];
  /** "12 cronogramas" · "3 de 12 cronogramas" */
  summary: string;
  onChange: (next: Filters) => void;
}) {
  const active = hasActiveFilters(value);
  return (
    <div role="search" aria-label="Filtrar cronogramas" className="mb-6">
      <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-end">
        <Field label="Cliente" className="col-span-2 md:w-72">
          <Input
            type="search"
            value={value.q}
            onChange={(e) => onChange({ ...value, q: e.target.value })}
            placeholder="Buscar cliente"
            leadingIcon={<Icon.search />}
            autoComplete="off"
            maxLength={80}
          />
        </Field>
        <Field label="Mês" className="min-w-0 md:w-52">
          <Select value={value.mes} onChange={(e) => onChange({ ...value, mes: e.target.value })}>
            <option value="">Todos os meses</option>
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" className="min-w-0 md:w-52">
          <Select value={value.status} onChange={(e) => onChange({ ...value, status: e.target.value })}>
            <option value="">Todos os status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        {active && (
          <Button variant="ghost" className="col-span-2 justify-self-start" onClick={() => onChange(NO_FILTERS)}>
            Limpar filtros
          </Button>
        )}
      </div>
      <p role="status" className="mt-3 text-sm text-fg-muted tabular-nums">
        {summary}
      </p>
    </div>
  );
}
