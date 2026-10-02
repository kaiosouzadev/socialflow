"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

/*
 * Painel flutuante (DESIGN e.3). Mora num portal — no <dialog> aberto mais
 * próximo do gatilho ou no <body> — com `position: fixed` calculada a partir do
 * gatilho, então não é cortado por listas roláveis (A-042) nem afetado por
 * `transform` de ancestrais. Esc, clique fora e Tab para fora fecham (A-051).
 * Com Popovers aninhados, Esc fecha só o do topo e o clique no painel de cima não
 * fecha o de baixo. Abrir, fechar e rolar por dentro não rolam a página.
 */

export type PopoverPlacement = "bottom-start" | "bottom-end" | "top-start" | "top-end";
export type PopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** o gatilho */
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  /** padrão "bottom-start"; inverte para top-* se não couber */
  placement?: PopoverPlacement;
  /** padrão 8 */
  offset?: number;
  /** padrão "dialog" */
  role?: "dialog" | "listbox";
  /** um dos dois é obrigatório */
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** para aria-controls do gatilho */
  id?: string;
  /** padrão false */
  matchAnchorWidth?: boolean;
  /** padrão "first" */
  initialFocus?: "first" | "container" | "none";
  /** largura/padding do painel */
  className?: string;
};

/**
 * Pilha global de popovers abertos, na ordem em que abriram (o último é o do topo).
 * O Dialog lê se há algum aberto (Esc e clique no fundo); cada Popover lê se é o do
 * topo (Esc fecha só ele) e quem abriu depois dele (clique num painel aninhado).
 */
type OpenEntry = { panel: () => HTMLElement | null };
const openStack: OpenEntry[] = [];

function trackOpenPopover(entry: OpenEntry) {
  openStack.push(entry);
  return () => {
    const i = openStack.indexOf(entry);
    if (i >= 0) openStack.splice(i, 1);
  };
}

/** Há algum Popover aberto? O Dialog consulta antes de fechar por Esc ou clique no fundo. */
export function hasOpenPopover(): boolean {
  return openStack.length > 0;
}

/** `target` está no painel de um Popover aberto DEPOIS de `entry` (aninhado nele)? */
function inPopoverAbove(entry: OpenEntry, target: Node): boolean {
  const i = openStack.indexOf(entry);
  return i >= 0 && openStack.slice(i + 1).some((e) => e.panel()?.contains(target));
}

/** Distância mínima das bordas da viewport. */
const EDGE = 8;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && el.getClientRects().length > 0,
  );
}

/** Calcula e aplica a posição: inverte para cima/baixo e desloca para caber na viewport. */
function place(
  panel: HTMLElement,
  anchor: HTMLElement,
  placement: PopoverPlacement,
  offset: number,
  matchAnchorWidth: boolean,
) {
  const a = anchor.getBoundingClientRect();
  const viewportW = document.documentElement.clientWidth;
  const viewportH = document.documentElement.clientHeight;
  if (matchAnchorWidth) panel.style.width = `${a.width}px`;

  // mede a altura natural (sem o limite aplicado na última vez); a rolagem interna
  // volta para onde estava depois (medir sem o limite a zera)
  const scrollTop = panel.scrollTop;
  panel.style.maxHeight = "";
  const naturalH = panel.offsetHeight;
  const width = panel.offsetWidth;

  const [preferred, align] = placement.split("-") as ["bottom" | "top", "start" | "end"];
  const spaceBelow = viewportH - a.bottom - offset - EDGE;
  const spaceAbove = a.top - offset - EDGE;
  const preferredSpace = preferred === "bottom" ? spaceBelow : spaceAbove;
  const otherSpace = preferred === "bottom" ? spaceAbove : spaceBelow;
  const side = naturalH > preferredSpace && otherSpace > preferredSpace ? (preferred === "bottom" ? "top" : "bottom") : preferred;

  // não coube: limita a altura ao espaço do lado escolhido (rolagem interna)
  const space = Math.max(side === "bottom" ? spaceBelow : spaceAbove, 0);
  const height = Math.min(naturalH, space);
  if (naturalH > space) panel.style.maxHeight = `${space}px`;
  if (panel.scrollTop !== scrollTop) panel.scrollTop = scrollTop;

  let top = side === "bottom" ? a.bottom + offset : a.top - offset - height;
  top = Math.max(EDGE, Math.min(top, viewportH - EDGE - height));
  let left = align === "start" ? a.left : a.right - width;
  left = Math.max(EDGE, Math.min(left, viewportW - EDGE - width));

  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
  panel.dataset.side = side;
}

/** O gatilho saiu da área visível da viewport ou de algum contêiner de rolagem? */
function anchorOutOfView(anchor: HTMLElement): boolean {
  const r = anchor.getBoundingClientRect();
  const root = document.documentElement;
  if (r.bottom <= 0 || r.top >= root.clientHeight || r.right <= 0 || r.left >= root.clientWidth) return true;
  for (let el = anchor.parentElement; el && el !== document.body && el !== root; el = el.parentElement) {
    const s = getComputedStyle(el);
    if (!/(auto|scroll|hidden|clip)/.test(`${s.overflowX} ${s.overflowY}`)) continue;
    const c = el.getBoundingClientRect();
    if (r.bottom <= c.top || r.top >= c.bottom || r.right <= c.left || r.left >= c.right) return true;
  }
  return false;
}

export function Popover({
  open,
  onOpenChange,
  anchorRef,
  children,
  placement = "bottom-start",
  offset = 8,
  role = "dialog",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  id,
  matchAnchorWidth = false,
  initialFocus = "first",
  className = "",
}: PopoverProps): React.ReactPortal | null {
  // Nó do portal, criado uma vez no navegador e movido para o <dialog>/<body> ao abrir.
  const [host] = useState<HTMLDivElement | null>(() =>
    typeof document === "undefined" ? null : document.createElement("div"),
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const focusInside = useRef(false);

  const reposition = useEffectEvent(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (panel && anchor) place(panel, anchor, placement, offset, matchAnchorWidth);
  });

  const onViewportChange = useEffectEvent(() => {
    const anchor = anchorRef.current;
    if (!anchor || anchorOutOfView(anchor)) {
      onOpenChange(false);
      return;
    }
    reposition();
  });

  const dismiss = useEffectEvent((returnFocus: boolean) => {
    if (returnFocus) anchorRef.current?.focus({ preventScroll: true });
    onOpenChange(false);
  });

  // 1) portal no <dialog> aberto que contém o gatilho (senão ficaria inerte, sob a top layer) ou no <body>
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!open || !host || !anchor) return;
    const container = anchor.closest("dialog[open]") ?? document.body;
    container.appendChild(host);
    return () => host.remove();
  }, [open, host, anchorRef]);

  // 2) posição antes da pintura; acompanha resize, rolagem de ancestral do gatilho e mudança de tamanho
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => reposition());
    };
    const onResize = () => onViewportChange();
    // Só a rolagem do documento ou de um ancestral do gatilho move o gatilho. A rolagem de
    // dentro do painel (ou de outro contêiner, como um painel aninhado) não reposiciona: senão
    // place() mediria de novo a cada passo e a rolagem interna voltaria ao topo.
    const onScroll = (e: Event) => {
      const target = e.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      const anchor = anchorRef.current;
      if (target instanceof Element && anchor && !target.contains(anchor)) return;
      onViewportChange();
    };
    const ro = new ResizeObserver(later);
    if (contentRef.current) ro.observe(contentRef.current);
    if (anchorRef.current) ro.observe(anchorRef.current);
    window.addEventListener("resize", onResize);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [open, anchorRef]);

  // 3) pilha global, Esc (em captura: o Dialog por baixo não fecha junto) e clique fora
  useEffect(() => {
    if (!open) return;
    const entry: OpenEntry = { panel: () => panelRef.current };
    const untrack = trackOpenPopover(entry);
    const onKey = (e: globalThis.KeyboardEvent) => {
      // Esc já tratado (folha de um seletor, Popover aninhado) ou não é o do topo: não fecha
      if (e.key !== "Escape" || e.defaultPrevented || openStack[openStack.length - 1] !== entry) return;
      e.preventDefault();
      e.stopPropagation();
      dismiss(true);
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        (panelRef.current?.contains(target) || anchorRef.current?.contains(target) || inPopoverAbove(entry, target))
      ) {
        return;
      }
      dismiss(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      untrack();
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [open, anchorRef]);

  // 4) foco inicial e devolução do foco ao fechar (sem rolar a página)
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (panel && initialFocus === "first") (tabbables(panel)[0] ?? panel).focus({ preventScroll: true });
    if (panel && initialFocus === "container") panel.focus({ preventScroll: true });
    return () => {
      // o painel já saiu do DOM: se o foco estava nele, volta ao gatilho
      const active = document.activeElement;
      if (focusInside.current && (!active || active === document.body) && anchor?.isConnected) {
        anchor.focus({ preventScroll: true });
      }
      focusInside.current = false;
    };
  }, [open, initialFocus, anchorRef]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || e.defaultPrevented) return;
    const items = tabbables(e.currentTarget);
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement;
    const leaving =
      items.length === 0 ||
      (e.shiftKey && (current === first || current === e.currentTarget)) ||
      (!e.shiftKey && current === last);
    if (!leaving) return;
    // Tab saindo do painel: fecha e devolve o foco ao gatilho
    e.preventDefault();
    focusInside.current = false;
    anchorRef.current?.focus({ preventScroll: true });
    onOpenChange(false);
  }

  if (!open || !host) return null;

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role={role}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      tabIndex={-1}
      data-sf-popover=""
      style={{ position: "fixed" }}
      onFocus={() => {
        focusInside.current = true;
      }}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (!next || e.currentTarget.contains(next)) return;
        focusInside.current = false;
        // foco foi para fora (e não para o gatilho, que alterna sozinho): fecha
        if (!anchorRef.current?.contains(next)) onOpenChange(false);
      }}
      onKeyDown={onKeyDown}
      className={`z-50 max-w-[calc(100%-16px)] overflow-y-auto rounded-card border border-line-strong bg-raised p-3 text-fg shadow-raised outline-none transition-[opacity,translate] duration-(--sf-dur-base) ease-out-soft starting:translate-y-1 starting:opacity-0 ${className}`}
    >
      <div ref={contentRef}>{children}</div>
    </div>,
    host,
  );
}
