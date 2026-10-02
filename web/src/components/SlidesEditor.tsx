"use client";

import { useId, useState } from "react";
import { Button } from "./Button";
import { Icon } from "./Icons";

const MAX_SLIDES = 20;

const TEXTAREA =
  "min-h-24 w-full resize-y rounded-control border border-line-strong bg-surface px-3 py-2.5 text-base text-fg transition-colors duration-(--sf-dur-fast) placeholder:text-fg-faint hover:border-fg-muted focus:border-focus focus:outline-2 focus:outline-offset-1 focus:outline-focus sm:text-sm";

/**
 * Roteiro por tela para carrossel/reels: abas "Slide 1..N" + botão de adicionar,
 * uma área de texto por slide com o conteúdo visual/textual planejado da arte.
 * Persistido em Post.slides ([{ text }]).
 */
export function SlidesEditor({
  format,
  slides,
  onChange,
}: {
  format: string;
  slides: string[];
  onChange: (slides: string[]) => void;
}) {
  const [active, setActive] = useState(0);
  const titleId = useId();
  const textId = useId();

  const label = format === "reels" ? "Telas do reels" : "Páginas do carrossel";
  const unit = format === "reels" ? "tela" : "slide";
  const Unit = format === "reels" ? "Tela" : "Slide";
  const ofUnit = format === "reels" ? "da tela" : "do slide";
  const current = Math.min(active, Math.max(0, slides.length - 1));
  const full = slides.length >= MAX_SLIDES;

  function add() {
    if (full) return;
    onChange([...slides, ""]);
    setActive(slides.length);
  }

  function remove(idx: number) {
    const next = slides.filter((_, i) => i !== idx);
    onChange(next);
    setActive(Math.max(0, Math.min(current, next.length - 1)));
  }

  function setText(idx: number, text: string) {
    onChange(slides.map((s, i) => (i === idx ? text : s)));
  }

  return (
    <div>
      <p id={titleId} className="mb-1.5 text-sm font-medium text-fg">
        {label}
      </p>

      {slides.length > 0 && (
        <div role="group" aria-labelledby={titleId} className="mb-3 flex flex-wrap items-center gap-1.5">
          {slides.map((_, i) => {
            const on = i === current;
            return (
              <button
                key={i}
                type="button"
                aria-pressed={on}
                onClick={() => setActive(i)}
                className={`inline-flex min-h-10 items-center rounded-control border px-3 text-sm font-medium transition-colors duration-(--sf-dur-fast) sm:min-h-8 ${
                  on ? "border-selected bg-selected text-on-selected" : "border-line-strong bg-surface text-fg-muted hover:bg-hover hover:text-fg"
                }`}
              >
                {Unit} {i + 1}
              </button>
            );
          })}
          <Button
            iconOnly
            variant="secondary"
            size="sm"
            aria-label={`Adicionar ${unit}`}
            title={full ? `Limite de ${MAX_SLIDES} atingido` : `Adicionar ${unit}`}
            disabled={full}
            onClick={add}
          >
            <Icon.plus />
          </Button>
        </div>
      )}

      {slides.length === 0 ? (
        <button
          type="button"
          onClick={add}
          className="w-full rounded-card border border-dashed border-line-strong px-4 py-6 text-sm text-fg-muted transition-colors duration-(--sf-dur-fast) hover:bg-hover hover:text-fg"
        >
          + Adicionar {unit === "tela" ? "a primeira tela" : "o primeiro slide"}
        </button>
      ) : (
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label htmlFor={textId} className="text-sm font-medium text-fg-muted">
              Arte {ofUnit} {current + 1}
            </label>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Icon.trash />}
              aria-label={`Remover ${unit} ${current + 1}`}
              onClick={() => remove(current)}
            >
              Remover
            </Button>
          </div>
          <textarea
            id={textId}
            value={slides[current] ?? ""}
            onChange={(e) => setText(current, e.target.value)}
            rows={4}
            className={TEXTAREA}
            placeholder={`Insira o conteúdo visual/textual ${ofUnit} aqui…`}
          />
        </div>
      )}
    </div>
  );
}
