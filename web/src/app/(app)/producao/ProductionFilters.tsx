"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Button } from "@/components/Button";
import { Dialog } from "@/components/Dialog";
import { Field, Select } from "@/components/Field";
import { MonthPicker } from "@/components/DatePickers";
import { Icon } from "@/components/Icons";
import { CLIENT_STATUS, CLIENT_STATUSES, PLAN, SEGMENT, SEGMENTS } from "@/lib/status-meta";

/*
 * Filtros e navegação de mês do Quadro de Produção (S31, DESIGN g.1). O estado
 * fica na URL; a troca acontece numa transição, e enquanto ela dura a área do
 * quadro fica marcada como ocupada (aria-busy + opacidade + barra no topo).
 */

export type ProductionStatusFilter = "ativo" | "pausado" | "encerrado" | "todos";

/** Filtros já validados pelo servidor ("" = sem filtro). */
export type ProductionFilterValues = {
  /** "AAAA-MM" */
  mes: string;
  /** id da redatora responsável */
  redatora: string;
  segmento: string;
  aprovacao: "" | "com" | "sem";
  status: ProductionStatusFilter;
  publica: "" | "sim" | "nao";
};

export type WriterOption = { id: string; name: string };

const DEFAULT_STATUS: ProductionStatusFilter = "ativo";

function hrefFor(v: ProductionFilterValues): string {
  const params = new URLSearchParams();
  params.set("mes", v.mes);
  if (v.redatora) params.set("redatora", v.redatora);
  if (v.segmento) params.set("segmento", v.segmento);
  if (v.aprovacao) params.set("aprovacao", v.aprovacao);
  if (v.status !== DEFAULT_STATUS) params.set("status", v.status);
  if (v.publica) params.set("publica", v.publica);
  return `/producao?${params}`;
}

function cleared(v: ProductionFilterValues): ProductionFilterValues {
  return { mes: v.mes, redatora: "", segmento: "", aprovacao: "", status: DEFAULT_STATUS, publica: "" };
}

/** Quantos filtros estão fora do padrão. */
function activeCount(v: ProductionFilterValues): number {
  return [v.redatora, v.segmento, v.aprovacao, v.status !== DEFAULT_STATUS ? v.status : "", v.publica].filter(Boolean)
    .length;
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

type Nav = { pending: boolean; go: (href: string) => void };
const NavContext = createContext<Nav | null>(null);

function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error("Use os filtros do Quadro dentro de <ProductionNavProvider>.");
  return nav;
}

/** Envolve cabeçalho, filtros e quadro: uma só transição de navegação para todos. */
export function ProductionNavProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const go = useCallback(
    (href: string) => startTransition(() => router.push(href, { scroll: false })),
    [router],
  );
  const value = useMemo(() => ({ pending, go }), [pending, go]);
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

/** ‹ Mês anterior · MonthPicker · Próximo mês › (ações do PageHeader). */
export function MonthNav({ values }: { values: ProductionFilterValues }) {
  const { go } = useNav();
  return (
    <div role="group" aria-label="Mês do quadro" className="flex w-full items-center gap-2 sm:w-auto">
      <Button iconOnly aria-label="Mês anterior" onClick={() => go(hrefFor({ ...values, mes: shiftMonth(values.mes, -1) }))}>
        <Icon.chevronLeft />
      </Button>
      <div className="min-w-0 flex-1 sm:w-52 sm:flex-none">
        <MonthPicker value={values.mes} onChange={(mes) => mes && go(hrefFor({ ...values, mes }))} />
      </div>
      <Button iconOnly aria-label="Próximo mês" onClick={() => go(hrefFor({ ...values, mes: shiftMonth(values.mes, 1) }))}>
        <Icon.chevronRight />
      </Button>
    </div>
  );
}

function FilterFields({
  values,
  writers,
  onChange,
  size,
  fieldClassName = "",
}: {
  values: ProductionFilterValues;
  writers: WriterOption[];
  onChange: (next: ProductionFilterValues) => void;
  size: "sm" | "md";
  fieldClassName?: string;
}) {
  return (
    <>
      <Field label="Redatora" className={fieldClassName}>
        <Select size={size} value={values.redatora} onChange={(e) => onChange({ ...values, redatora: e.target.value })}>
          <option value="">Todas</option>
          {writers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Segmento" className={fieldClassName}>
        <Select size={size} value={values.segmento} onChange={(e) => onChange({ ...values, segmento: e.target.value })}>
          <option value="">Todos</option>
          {SEGMENTS.map((s) => (
            <option key={s} value={s}>
              {SEGMENT[s].label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Aprovação" className={fieldClassName}>
        <Select
          size={size}
          value={values.aprovacao}
          onChange={(e) => onChange({ ...values, aprovacao: e.target.value as ProductionFilterValues["aprovacao"] })}
        >
          <option value="">Todas</option>
          <option value="com">{PLAN.aprovacao_cliente.label}</option>
          <option value="sem">{PLAN.sem_aprovacao.label}</option>
        </Select>
      </Field>
      <Field label="Status do cliente" className={fieldClassName}>
        <Select
          size={size}
          value={values.status}
          onChange={(e) => onChange({ ...values, status: e.target.value as ProductionStatusFilter })}
        >
          {CLIENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CLIENT_STATUS[s].label}
            </option>
          ))}
          <option value="todos">Todos</option>
        </Select>
      </Field>
      <Field label="Publicação" className={fieldClassName}>
        <Select
          size={size}
          value={values.publica}
          onChange={(e) => onChange({ ...values, publica: e.target.value as ProductionFilterValues["publica"] })}
        >
          <option value="">Todos</option>
          <option value="sim">Agência publica</option>
          <option value="nao">Só produção</option>
        </Select>
      </Field>
    </>
  );
}

/**
 * Filtros: em linha (≥ md, aplicam na hora) ou num botão "Filtros (n)" que abre
 * um diálogo com "Aplicar" e "Limpar" (< md).
 */
export default function ProductionFilters({
  values,
  writers,
}: {
  values: ProductionFilterValues;
  writers: WriterOption[];
}) {
  const { go } = useNav();
  // valor otimista: o select já mostra a escolha enquanto a página nova carrega;
  // quando a URL muda (servidor respondeu, voltar do navegador), volta a refletir a URL
  const [local, setLocal] = useState(values);
  const urlKey = hrefFor(values);
  const [prevUrlKey, setPrevUrlKey] = useState(urlKey);
  if (urlKey !== prevUrlKey) {
    setPrevUrlKey(urlKey);
    setLocal(values);
  }
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(values);

  const apply = (next: ProductionFilterValues) => {
    setLocal(next);
    go(hrefFor(next));
  };
  const count = activeCount(values);

  return (
    <>
      <div className="mb-5 hidden flex-wrap items-end gap-3 md:flex">
        <FilterFields values={local} writers={writers} onChange={apply} size="sm" fieldClassName="w-44" />
        {count > 0 && (
          <Button variant="ghost" size="sm" onClick={() => apply(cleared(local))}>
            Limpar filtros
          </Button>
        )}
      </div>

      <div className="mb-4 md:hidden">
        <Button
          variant="secondary"
          aria-haspopup="dialog"
          onClick={() => {
            setDraft(values);
            setOpen(true);
          }}
        >
          {count > 0 ? `Filtros (${count})` : "Filtros"}
        </Button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Filtros"
          size="sm"
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  apply(cleared(values));
                }}
              >
                Limpar
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setOpen(false);
                  apply(draft);
                }}
              >
                Aplicar
              </Button>
            </>
          }
        >
          <div className="grid gap-4">
            <FilterFields values={draft} writers={writers} onChange={setDraft} size="md" />
          </div>
        </Dialog>
      </div>
    </>
  );
}

/**
 * Área do resumo, da legenda e da grade. Fica "ocupada" durante a troca de
 * filtro/mês e, ao abrir um mês, rola a grade até a coluna marcada
 * (`data-scroll-anchor`, "hoje" − 2), sem animação.
 */
export function ProductionBusyArea({ scrollKey, children }: { scrollKey: string; children: React.ReactNode }) {
  const { pending } = useNav();
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const anchor = ref.current?.querySelector<HTMLElement>("[data-scroll-anchor]");
    const region = anchor?.closest<HTMLElement>('[role="region"]');
    const sticky = region?.querySelector<HTMLElement>("thead th");
    if (!anchor || !region || !sticky) return;
    const delta = anchor.getBoundingClientRect().left - region.getBoundingClientRect().left - region.clientLeft - sticky.offsetWidth;
    region.scrollLeft = Math.max(0, region.scrollLeft + delta);
  }, [scrollKey]);

  return (
    <div ref={ref} aria-busy={pending || undefined} className="relative">
      {pending && <div aria-hidden="true" className="absolute inset-x-0 -top-2 z-30 h-0.5 rounded-full bg-brand" />}
      <div className={`transition-opacity duration-(--sf-dur-fast) ${pending ? "opacity-60" : ""}`}>{children}</div>
    </div>
  );
}
