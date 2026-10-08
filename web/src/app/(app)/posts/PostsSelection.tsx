"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/Dialog";
import { Icon } from "@/components/Icons";
import { hasOpenPopover } from "@/components/Popover";
import { Toast, type ToastState } from "@/components/Toast";

/**
 * Seleção múltipla e exclusão em massa na lista /posts (P5-B), no padrão de mercado:
 * caixa em cada linha/cartão, "Selecionar todos desta página" (tri-estado) e, com ≥ 1
 * marcado, uma barra de ações presa ao rodapé da tela enquanto a lista está visível:
 * "N selecionados" · Limpar seleção · Selecionar todos os M do filtro · Excluir selecionados.
 *
 * O page.tsx (servidor) monta a tabela/cartões e usa `RowCheckbox` e `SelectPageCheckbox`
 * dentro deste provedor. A seleção zera ao trocar filtro/página (o page.tsx troca a `key`),
 * com Esc (sem diálogo aberto) e depois de excluir.
 *
 * Os ids de "todos os M deste filtro" vêm de GET /api/posts/ids só quando a pessoa pede (U-37).
 * Com a barra visível, o `html` ganha `scroll-padding-bottom` da altura dela: o item que recebe
 * o foco nunca fica escondido atrás da barra (WCAG 2.4.11; U-12).
 */

export type SelectablePost = { id: string; status: string };

/** Alvo do toque: 44 px no celular, 40 px a partir de sm (DESIGN, A11y "Alvos"). */
const CHECK_HIT =
  "inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center sm:min-h-10 sm:min-w-10";
const CHECKBOX = "size-4.5 cursor-pointer rounded-chip accent-selected";

const fmt = (n: number) => n.toLocaleString("pt-BR");

/** Máximo da seleção "todos deste filtro" (o mesmo limite do POST /api/posts/bulk-delete). */
const BULK_LIMIT = 500;

/** Folga entre o item com foco e a barra fixa (além da distância da barra ao rodapé). */
const FOCUS_GAP = 12;
const postsWord = (n: number) => (n === 1 ? "post" : "posts");

type PageState = "none" | "some" | "all";

type SelectionApi = {
  pageCount: number;
  pageState: PageState;
  isSelected: (id: string) => boolean;
  toggle: (id: string, checked: boolean, el: HTMLElement) => void;
  setPage: (checked: boolean, el: HTMLElement) => void;
};

const SelectionContext = createContext<SelectionApi | null>(null);

function useSelection(): SelectionApi {
  const api = useContext(SelectionContext);
  if (!api) throw new Error("RowCheckbox/SelectPageCheckbox precisam estar dentro de PostsSelection.");
  return api;
}

const isVisible = (el: Element | null | undefined): el is HTMLElement =>
  el instanceof HTMLElement && el.isConnected && el.getClientRects().length > 0;

/** Texto do Toast a partir da resposta do servidor (as contagens dele valem, não as da tela). */
function resultToast(d: unknown): Exclude<ToastState, null> {
  const r = (d ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  const deleted = num(r.deleted);
  const skipped = num(r.skippedPublishing);
  const keptPublished = num(r.skippedPublished);
  const gone = num(r.notFound);
  const parts = [deleted > 0 ? `${fmt(deleted)} ${deleted === 1 ? "post excluído." : "posts excluídos."}` : "Nenhum post foi excluído."];
  if (skipped > 0) parts.push(`${fmt(skipped)} em publicação não ${skipped === 1 ? "foi excluído" : "foram excluídos"}.`);
  if (keptPublished > 0) {
    parts.push(`${fmt(keptPublished)} ${keptPublished === 1 ? "foi publicado e ficou" : "foram publicados e ficaram"} (só administradoras excluem publicados).`);
  }
  if (gone > 0) parts.push(`${fmt(gone)} já ${gone === 1 ? "tinha sido excluído" : "tinham sido excluídos"}.`);
  return { kind: deleted > 0 ? "success" : "info", text: parts.join(" ") };
}

export default function PostsSelection({
  pageItems,
  total,
  filterQuery,
  canExpandFilter,
  canDeletePublished = false,
  children,
}: {
  /** posts desta página, na ordem da lista */
  pageItems: SelectablePost[];
  /** total de posts do filtro (pode passar de 500) */
  total: number;
  /** query string do filtro atual para GET /api/posts/ids ("todos os M deste filtro") */
  filterQuery: string;
  /** a página está entre os primeiros 500 do filtro (senão "todos deste filtro" não a incluiria) */
  canExpandFilter: boolean;
  /** admin: também exclui posts já publicados (decisão "Só admin + registro", AC-07). Staff: eles ficam. */
  canDeletePublished?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  /** posts do filtro (no máximo 500), carregados ao pedir "todos deste filtro" */
  const [filterItems, setFilterItems] = useState<SelectablePost[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  /** última caixa que a pessoa marcou/desmarcou: o foco volta para ela ao limpar a seleção */
  const lastToggledRef = useRef<HTMLElement | null>(null);
  /** para onde vai o foco quando a barra some (ela desmonta com o elemento focado dentro) */
  const focusAfterClearRef = useRef<"last" | "list" | null>(null);
  /** muda a cada troca de seleção: a resposta de "todos deste filtro" que chega atrasada é ignorada */
  const versionRef = useRef(0);

  const pageIds = useMemo(() => pageItems.map((p) => p.id), [pageItems]);
  const statusById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of filterItems) m.set(p.id, p.status);
    for (const p of pageItems) m.set(p.id, p.status);
    return m;
  }, [pageItems, filterItems]);

  // Seleção efetiva: só o que ainda está na lista (um post excluído em outra aba some no refresh).
  const effective = useMemo(() => [...selected].filter((id) => statusById.has(id)), [selected, statusById]);
  const count = effective.length;

  const pageSelected = pageIds.filter((id) => selected.has(id)).length;
  const pageState: PageState =
    pageIds.length === 0 || pageSelected === 0 ? "none" : pageSelected === pageIds.length ? "all" : "some";

  // "Selecionar todos os M deste filtro": página inteira marcada e o filtro tem mais posts que ela.
  const pageIdSet = useMemo(() => new Set(pageIds), [pageIds]);
  const beyondPage = effective.some((id) => !pageIdSet.has(id));
  const filterSize = Math.min(total, BULK_LIMIT);
  const canExpand = !beyondPage && pageState === "all" && total > pageIds.length && canExpandFilter;
  const expandLabel =
    total > filterSize
      ? `Selecionar os primeiros ${fmt(filterSize)} de ${fmt(total)} posts deste filtro`
      : `Selecionar todos os ${fmt(filterSize)} posts deste filtro`;

  /** Troca a seleção (atualização funcional: cliques rápidos não se perdem). */
  function select(next: (prev: ReadonlySet<string>) => Set<string>, grows: boolean) {
    versionRef.current++;
    setLoadError(null);
    setSelected(next);
    // marcar algo dispensa o aviso da exclusão anterior (o Toast cobriria a barra)
    if (grows) setToast(null);
  }

  function clear(focusTo: "last" | "list" | null) {
    versionRef.current++;
    setLoadError(null);
    focusAfterClearRef.current = focusTo;
    setSelected(new Set());
  }

  /** "Todos os M deste filtro": busca os ids agora (U-37), na ordem da lista. */
  async function selectWholeFilter() {
    if (loadingAll) return;
    const version = ++versionRef.current;
    setLoadError(null);
    setLoadingAll(true);
    try {
      const res = await fetch(`/api/posts/ids${filterQuery ? `?${filterQuery}` : ""}`, { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (version !== versionRef.current) return; // a pessoa mudou a seleção enquanto carregava
      const items: SelectablePost[] | null = Array.isArray(d?.items)
        ? (d.items as unknown[]).filter(
            (i): i is SelectablePost =>
              !!i && typeof (i as SelectablePost).id === "string" && typeof (i as SelectablePost).status === "string"
          )
        : null;
      if (!res.ok || !items) {
        // N-14: só mostra `error` do servidor quando é texto
        setLoadError(typeof d?.error === "string" ? d.error : "Não foi possível selecionar todos os posts. Tente de novo.");
        return;
      }
      setFilterItems(items);
      select(() => new Set(items.map((i) => i.id)), true);
    } catch {
      if (version === versionRef.current) setLoadError("Falha de conexão. Verifique a internet e tente de novo.");
    } finally {
      setLoadingAll(false);
    }
  }

  const api: SelectionApi = {
    pageCount: pageIds.length,
    pageState,
    isSelected: (id) => selected.has(id),
    toggle: (id, checked, el) => {
      lastToggledRef.current = el;
      select((prev) => {
        const next = new Set(prev);
        if (checked) next.add(id);
        else next.delete(id);
        return next;
      }, checked);
    },
    // desmarcar a caixa da página limpa tudo (inclusive o "todos do filtro"), como no Gmail
    setPage: (checked, el) => {
      lastToggledRef.current = el;
      select((prev) => (checked ? new Set([...prev, ...pageIds]) : new Set()), checked);
    },
  };

  // Foco depois que a barra some: Limpar/Esc → última caixa usada; depois de excluir → a lista
  // (as linhas excluídas saem no refresh; o contêiner da lista continua).
  useEffect(() => {
    const mode = focusAfterClearRef.current;
    if (count > 0 || !mode) return;
    focusAfterClearRef.current = null;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      // a pessoa já está em outro lugar: não roubar o foco
      if (active && active !== document.body && active.isConnected) return;
      const root = rootRef.current;
      if (!root) return;
      if (mode === "last") {
        const target =
          [lastToggledRef.current].find(isVisible) ??
          Array.from(root.querySelectorAll("[data-select-page], [data-select-row]")).find(isVisible);
        if (target) {
          target.focus();
          return;
        }
      }
      // contêiner da lista focável só neste momento (sem entrar na ordem de Tab)
      root.tabIndex = -1;
      root.focus({ preventScroll: true });
      root.addEventListener("blur", () => root.removeAttribute("tabindex"), { once: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [count]);

  // U-12 (WCAG 2.4.11): com a barra visível, a rolagem por foco (Tab) para acima dela.
  const barVisible = count > 0;
  useEffect(() => {
    const bar = barRef.current;
    if (!barVisible || !bar) return;
    const html = document.documentElement;
    const previous = html.style.scrollPaddingBottom;
    const apply = () => {
      const offset = Number.parseFloat(getComputedStyle(bar).bottom) || 0;
      html.style.scrollPaddingBottom = `${Math.ceil(bar.offsetHeight + offset + FOCUS_GAP)}px`;
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      html.style.scrollPaddingBottom = previous;
    };
  }, [barVisible]);

  // Esc limpa a seleção quando nenhum diálogo/popover está aberto e o foco não está num campo de texto.
  useEffect(() => {
    if (count === 0) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
      if (document.querySelector("dialog[open]") || hasOpenPopover()) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable ||
          t instanceof HTMLTextAreaElement ||
          t instanceof HTMLSelectElement ||
          (t instanceof HTMLInputElement && t.type !== "checkbox"))
      ) {
        return;
      }
      // foco dentro da barra (que vai sumir) → volta para a última caixa usada
      focusAfterClearRef.current = barRef.current?.contains(document.activeElement) ? "last" : null;
      versionRef.current++; // descarta um "todos deste filtro" ainda carregando
      setSelected(new Set());
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [count]);

  // contagens do diálogo (status de quando a página carregou; o servidor confere de novo)
  const counts = useMemo(() => {
    const c = { scheduled: 0, published: 0, publishing: 0 };
    for (const id of effective) {
      const s = statusById.get(id);
      if (s === "scheduled") c.scheduled++;
      else if (s === "published") c.published++;
      else if (s === "publishing") c.publishing++;
    }
    return c;
  }, [effective, statusById]);
  // staff: publicados não entram no pedido (o servidor recusaria a seleção inteira com 403)
  const keepsPublished = !canDeletePublished && counts.published > 0;
  const deletable = count - counts.publishing - (keepsPublished ? counts.published : 0);
  const idsToDelete = keepsPublished ? effective.filter((id) => statusById.get(id) !== "published") : effective;

  const consequences: string[] = [];
  if (deletable > 0) {
    consequences.push(deletable === 1 ? "O post é apagado do sistema." : `Os ${fmt(deletable)} posts são apagados do sistema.`);
  }
  if (counts.scheduled > 0) {
    consequences.push(
      counts.scheduled === 1
        ? "1 agendado sai da fila e não é publicado."
        : `${fmt(counts.scheduled)} agendados saem da fila e não são publicados.`
    );
  }
  if (keepsPublished) {
    consequences.push(
      counts.published === 1
        ? "1 já publicado fica no sistema: só administradoras podem excluir posts publicados."
        : `${fmt(counts.published)} já publicados ficam no sistema: só administradoras podem excluir posts publicados.`
    );
  } else if (counts.published > 0) {
    consequences.push(
      counts.published === 1
        ? "1 já publicado some do sistema, mas continua nas redes sociais."
        : `${fmt(counts.published)} já publicados somem do sistema, mas continuam nas redes sociais.`
    );
  }
  if (counts.publishing > 0) {
    consequences.push(
      counts.publishing === 1
        ? "1 em publicação agora não será excluído."
        : `${fmt(counts.publishing)} em publicação agora não serão excluídos.`
    );
  }

  function openConfirm() {
    setError(null);
    setConfirmOpen(true);
  }

  function cancelConfirm() {
    if (busy) return;
    setConfirmOpen(false);
    setError(null);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/posts/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: idsToDelete }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        // N-14: só mostra `error` do servidor quando é texto
        setError(typeof d?.error === "string" ? d.error : "Não foi possível excluir os posts. Tente de novo.");
        return;
      }
      // fecha o diálogo e só então o Toast aparece (nunca Toast com Dialog aberto)
      setConfirmOpen(false);
      clear("list");
      setToast(resultToast(d));
      router.refresh();
    } catch {
      setError("Falha de conexão. Verifique a internet e tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SelectionContext.Provider value={api}>
      <div ref={rootRef} className="outline-none">
        {children}

        {/* anúncio para leitor de tela, sempre montado (a barra aparece e some) */}
        <p role="status" className="sr-only">
          {count > 0 ? `${fmt(count)} ${count === 1 ? "post selecionado" : "posts selecionados"}` : ""}
        </p>

        {count > 0 && (
          <div
            ref={barRef}
            role="region"
            aria-label="Ações dos posts selecionados"
            className="sticky bottom-[max(12px,env(safe-area-inset-bottom))] z-20 mt-4 rounded-card border border-line bg-raised p-3 shadow-raised"
          >
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <p aria-hidden="true" className="min-w-0 flex-1 pl-1 text-sm font-semibold tabular-nums text-fg sm:flex-none">
                {fmt(count)} {count === 1 ? "selecionado" : "selecionados"}
              </p>
              <Button variant="ghost" onClick={() => clear("last")}>
                Limpar seleção
              </Button>
              {(canExpand || beyondPage) && (
                // o mesmo botão alterna os dois modos: o foco não se perde ao clicar (por isso não
                // fica desabilitado enquanto carrega; aria-busy + texto avisam)
                <Button
                  variant="ghost"
                  className="w-full sm:w-auto"
                  aria-busy={loadingAll || undefined}
                  onClick={() => (beyondPage ? select(() => new Set(pageIds), true) : void selectWholeFilter())}
                >
                  {beyondPage
                    ? `Selecionar só os ${fmt(pageIds.length)} desta página`
                    : loadingAll
                      ? "Selecionando todos deste filtro…"
                      : expandLabel}
                </Button>
              )}
              <Button
                variant="danger"
                leadingIcon={<Icon.trash />}
                className="w-full sm:ml-auto sm:w-auto"
                onClick={openConfirm}
              >
                Excluir selecionados
              </Button>
            </div>
            {loadError && (
              <p role="alert" className="mt-2 pl-1 text-sm font-medium text-danger-fg">
                {loadError}
              </p>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        tone="danger"
        title={deletable > 0 ? `Excluir ${fmt(deletable)} ${postsWord(deletable)}?` : "Nenhum post pode ser excluído agora"}
        description={
          deletable > 0
            ? "Não dá para desfazer."
            : keepsPublished
              ? `Só administradoras podem excluir posts já publicados.${
                  counts.publishing > 0 ? " Os demais selecionados estão em publicação." : ""
                }`
              : "Os posts selecionados estão em publicação. Espere terminar e tente de novo."
        }
        consequences={consequences}
        confirmLabel={deletable > 0 ? `Excluir ${fmt(deletable)} ${postsWord(deletable)}` : "Excluir posts"}
        confirmDisabled={deletable === 0}
        busy={busy}
        busyLabel="Excluindo…"
        error={error}
        onConfirm={() => void remove()}
        onCancel={cancelConfirm}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </SelectionContext.Provider>
  );
}

/** Caixa de uma linha/cartão. Nome acessível: "Selecionar post: <tema>". */
export function RowCheckbox({ id, label, className = "" }: { id: string; label: string; className?: string }) {
  const { isSelected, toggle } = useSelection();
  return (
    <label className={`${CHECK_HIT} ${className}`}>
      <input
        type="checkbox"
        data-select-row=""
        checked={isSelected(id)}
        aria-label={`Selecionar post: ${label}`}
        onChange={(e) => toggle(id, e.target.checked, e.currentTarget)}
        className={CHECKBOX}
      />
    </label>
  );
}

/**
 * "Selecionar todos desta página", tri-estado (nenhum / alguns = misto / todos).
 * `withLabel`: versão com texto visível (acima dos cartões, < lg); sem ele, só a caixa
 * (cabeçalho da tabela) com o mesmo nome acessível.
 */
export function SelectPageCheckbox({ withLabel = false }: { withLabel?: boolean }) {
  const { pageCount, pageState, setPage } = useSelection();
  if (pageCount === 0) return null;
  const input = (
    <input
      type="checkbox"
      data-select-page=""
      checked={pageState === "all"}
      ref={(el) => {
        if (el) el.indeterminate = pageState === "some";
      }}
      aria-label={withLabel ? undefined : "Selecionar todos desta página"}
      onChange={(e) => setPage(e.target.checked, e.currentTarget)}
      className={CHECKBOX}
    />
  );
  if (!withLabel) return <label className={CHECK_HIT}>{input}</label>;
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center pr-3 text-sm font-medium text-fg-muted sm:min-h-10">
      <span className={CHECK_HIT}>{input}</span>
      Selecionar todos desta página
    </label>
  );
}
