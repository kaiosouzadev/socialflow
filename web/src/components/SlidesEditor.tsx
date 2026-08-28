"use client";

import { useState } from "react";
import { Icon } from "./Icons";

const MAX_SLIDES = 20;

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

  const label = format === "reels" ? "Telas do reels" : "Páginas do carrossel";
  const unit = format === "reels" ? "tela" : "slide";
  const current = Math.min(active, Math.max(0, slides.length - 1));

  function add() {
    if (slides.length >= MAX_SLIDES) return;
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
      <label className="label uppercase tracking-wider">{label}</label>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {slides.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActive(i)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              i === current
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-border-strong)]"
            }`}
          >
            Slide {i + 1}
          </button>
        ))}
        <button
          type="button"
          onClick={add}
          disabled={slides.length >= MAX_SLIDES}
          title={`Adicionar ${unit}`}
          className="flex items-center justify-center w-8 h-8 rounded-lg border border-dashed border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:text-white hover:border-[var(--color-accent)] transition-colors disabled:opacity-40"
        >
          <Icon.plus className="w-4 h-4" />
        </button>
      </div>

      {slides.length === 0 ? (
        <button
          type="button"
          onClick={add}
          className="w-full rounded-xl border border-dashed border-[var(--color-border-strong)] px-4 py-6 text-sm text-[var(--color-text-muted)] hover:text-white hover:border-[var(--color-accent)] transition-colors"
        >
          + Adicionar a primeira {unit}
        </button>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-[var(--color-text-muted)]">
              Arte do slide {current + 1}
            </span>
            <button
              type="button"
              onClick={() => remove(current)}
              className="flex items-center gap-1 text-xs text-[var(--color-text-faint)] hover:text-red-400 transition-colors"
            >
              <Icon.trash className="w-3.5 h-3.5" />
              Remover
            </button>
          </div>
          <textarea
            value={slides[current] ?? ""}
            onChange={(e) => setText(current, e.target.value)}
            rows={4}
            className="input text-sm"
            placeholder={`Insira o conteúdo visual/textual do ${unit} aqui…`}
          />
        </div>
      )}
    </div>
  );
}
