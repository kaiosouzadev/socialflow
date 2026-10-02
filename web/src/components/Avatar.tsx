"use client";

import { useState } from "react";

/*
 * Iniciais ou imagem de pessoa/cliente (DESIGN e.7). Substitui os gradientes
 * repetidos [RC 3e]. A cor de cliente é dado (a.8): só vira anel, nunca fundo.
 */

export type AvatarProps = {
  /** iniciais: 1ª letra da 1ª e da última palavra */
  name: string;
  /** foto/logo */
  src?: string | null;
  /** 24 · 32 · 40 · 48 px (iniciais 12 · 12 · 14 · 16 px, peso 600). Padrão "md" */
  size?: "xs" | "sm" | "md" | "lg";
  /** pessoa = circle; cliente = square (rounded-control). Padrão "circle" */
  shape?: "circle" | "square";
  /** cor de cliente → só anel (a.8); nunca fundo */
  color?: string | null;
  /** padrão true → aria-hidden; false → role="img" aria-label={name} */
  decorative?: boolean;
};

const SIZE = {
  xs: "size-6 text-xs",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
} as const;

function initialsOf(name: string, single: boolean): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  if (single) return first.toUpperCase();
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}

export function Avatar({ name, src, size = "md", shape = "circle", color, decorative = true }: AvatarProps) {
  // imagem que falhou: volta para as iniciais (e tenta de novo se o src mudar)
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const label = name.trim() || "Sem nome";
  const imageSrc = src && src !== failedSrc ? src : null;
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": label };

  return (
    <span
      {...a11y}
      className={`inline-grid shrink-0 select-none place-items-center overflow-hidden bg-neutral-bg font-semibold leading-none text-fg ${SIZE[size]} ${
        shape === "circle" ? "rounded-full" : "rounded-control"
      }`}
      // cor-de-dado: anel com a cor do cliente, separado do fundo por 2 px de superfície
      style={color ? { boxShadow: `0 0 0 2px var(--sf-surface), 0 0 0 4px ${color}` } : undefined}
    >
      {imageSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageSrc} alt="" onError={() => setFailedSrc(imageSrc)} className="size-full object-cover" />
      ) : (
        initialsOf(name, size === "xs")
      )}
    </span>
  );
}
