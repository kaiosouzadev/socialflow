"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, buttonClasses } from "@/components/Button";
import { DatePicker } from "@/components/DatePickers";
import { Field, Select } from "@/components/Field";

type Option = { id: string; name: string };
type Current = { action: string; actorId: string; clientId: string; from: string; to: string };

/**
 * Filtros do Registro de ações (estado na URL: ?acao=&pessoa=&cliente=&de=&ate=).
 * "Filtrar" monta a URL e volta para a página 1; "Limpar filtros" volta às últimas 200 ações.
 */
export default function AuditFiltersForm({
  actions,
  users,
  clients,
  current,
}: {
  actions: { value: string; label: string }[];
  users: Option[];
  clients: Option[];
  current: Current;
}) {
  const router = useRouter();
  const [v, setV] = useState<Current>(current);

  // URL mudou por fora (voltar do navegador, "Limpar filtros"): acompanha sem efeito
  const key = JSON.stringify(current);
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    setV(current);
  }

  const set = (patch: Partial<Current>) => setV((old) => ({ ...old, ...patch }));
  const any = !!(current.action || current.actorId || current.clientId || current.from || current.to);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (v.action) params.set("acao", v.action);
    if (v.actorId) params.set("pessoa", v.actorId);
    if (v.clientId) params.set("cliente", v.clientId);
    if (v.from) params.set("de", v.from);
    if (v.to) params.set("ate", v.to);
    router.push(`/auditoria${params.size ? `?${params}` : ""}`);
  }

  return (
    <form
      role="search"
      aria-label="Filtrar o registro de ações"
      onSubmit={submit}
      className="card mb-4 grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] lg:items-end"
    >
      <Field label="Ação">
        <Select value={v.action} onChange={(e) => set({ action: e.target.value })}>
          <option value="">Todas</option>
          {actions.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Quem">
        <Select value={v.actorId} onChange={(e) => set({ actorId: e.target.value })}>
          <option value="">Todas as pessoas</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Cliente">
        <Select value={v.clientId} onChange={(e) => set({ clientId: e.target.value })}>
          <option value="">Todos os clientes</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="De" id="auditoria-de">
        <DatePicker id="auditoria-de" value={v.from} onChange={(from) => set({ from })} placeholder="Início" />
      </Field>
      <Field label="Até" id="auditoria-ate">
        <DatePicker id="auditoria-ate" value={v.to} onChange={(to) => set({ to })} placeholder="Hoje" />
      </Field>
      <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-1">
        <Button type="submit" variant="primary" className="flex-1 lg:flex-none">
          Filtrar
        </Button>
        {any && (
          <Link href="/auditoria" className={`${buttonClasses({ variant: "ghost" })} flex-1 lg:flex-none`}>
            Limpar filtros
          </Link>
        )}
      </div>
    </form>
  );
}
