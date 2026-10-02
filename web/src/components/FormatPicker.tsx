"use client";

import { useRef, type KeyboardEvent } from "react";
import { useFieldControl } from "./Field";
import { FORMAT_OPTIONS, type FormatMeta, type PostFormat } from "@/lib/formats";

/**
 * Formatos na ordem de exibição (feed, story, carrossel, reels).
 * @deprecated use `FORMAT_OPTIONS` de `@/lib/formats` — é a mesma lista (fonte única, A-029);
 * cada item tem `id` e `label` como antes, mais o `tone` da cor do formato.
 */
export const POST_FORMATS: readonly FormatMeta[] = FORMAT_OPTIONS;

/* Mapa estático (H-03): a cor de cada formato vem dos tokens format-* do lib/formats. */
const SWATCH: Record<PostFormat, string> = {
  feed: "bg-format-feed",
  story: "bg-format-story",
  carrossel: "bg-format-carrossel",
  reels: "bg-format-reels",
};

/**
 * Escolha única do formato do post: radiogroup com um ponto de Tab e setas
 * (com volta). Nome acessível: `aria-labelledby` > `aria-label` > rótulo do
 * <Field> em volta > "Tipo de postagem".
 */
export function FormatPicker({
  value,
  onChange,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
}: {
  value: string;
  onChange: (v: string) => void;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const field = useFieldControl();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = FORMAT_OPTIONS.findIndex((f) => f.id === value);
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0;
  const labelledBy = ariaLabelledby ?? (ariaLabel ? undefined : field?.labelId);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = FORMAT_OPTIONS.length;
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (index + 1) % count;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (index - 1 + count) % count;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = count - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    onChange(FORMAT_OPTIONS[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : (ariaLabel ?? "Tipo de postagem")}
      aria-describedby={field?.describedBy}
      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
    >
      {FORMAT_OPTIONS.map((f, index) => {
        const on = value === f.id;
        return (
          <button
            key={f.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={index === tabStop ? 0 : -1}
            onClick={() => onChange(f.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`inline-flex h-11 items-center justify-center gap-2 rounded-control border px-3 text-sm font-medium transition-colors duration-(--sf-dur-fast) sm:h-10 ${
              on ? "border-selected bg-selected text-on-selected" : "border-line-strong bg-surface text-fg-muted hover:bg-hover hover:text-fg"
            }`}
          >
            <span
              aria-hidden="true"
              className={`size-2.5 shrink-0 rounded-xs ${SWATCH[f.id]} ${on ? "ring-1 ring-on-selected" : ""}`}
            />
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
