"use client";

import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import { Icon } from "./Icons";

/*
 * Tema (contrato C1 do DESIGN): a preferência fica em localStorage["sf-theme"]
 * e o <html> recebe sempre o tema RESOLVIDO em data-theme ("light" | "dark") e
 * a preferência crua em data-theme-pref. O script anti-flash do app/layout.tsx
 * aplica isso antes da pintura; aqui só lemos, gravamos e reagimos a mudanças.
 */

export type ThemePref = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "sf-theme";

const CHANGE_EVENT = "sf-theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function parsePref(value: unknown): ThemePref {
  return value === "light" || value === "dark" ? value : "system";
}

function readPref(): ThemePref {
  return parsePref(document.documentElement.dataset.themePref);
}

function readStoredPref(): ThemePref {
  try {
    return parsePref(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system"; // storage bloqueado
  }
}

function applyPref(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia(DARK_QUERY).matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.themePref = pref;
}

function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // storage bloqueado: o tema vale só nesta sessão (ERROR PATHS)
  }
  applyPref(pref);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: pref }));
}

/** Assina as 3 fontes de mudança: sistema (modo "system"), outras abas e esta aba. */
function subscribe(onChange: () => void) {
  const media = window.matchMedia(DARK_QUERY);
  const onSystem = () => {
    if (readPref() === "system") applyPref("system");
    onChange();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== THEME_STORAGE_KEY) return;
    applyPref(parsePref(e.newValue));
    onChange();
  };
  media.addEventListener("change", onSystem);
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    media.removeEventListener("change", onSystem);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

const getServerSnapshot = (): ThemePref => "system";

/**
 * Mantém o <html> em sincronia (modo "system" seguindo o sistema, troca feita em
 * outra aba) em toda página, mesmo nas que não mostram o seletor. Montado uma vez
 * no layout raiz; também reaplica a preferência salva quando o global-error
 * substitui o layout raiz. Não renderiza nada.
 */
export function ThemeSync() {
  useEffect(() => {
    applyPref(readStoredPref());
    return subscribe(() => {});
  }, []);
  return null;
}

const OPTIONS = [
  { value: "light", label: "Claro", icon: Icon.sun },
  { value: "dark", label: "Escuro", icon: Icon.moon },
  { value: "system", label: "Sistema", icon: Icon.monitor },
] as const;

/**
 * Seletor de tema: radiogroup com as opções Claro / Escuro / Sistema (e.5).
 * `variant="icons"` (padrão) mostra só os ícones (nome em aria-label e title);
 * `"labeled"` mostra os rótulos.
 */
export function ThemeToggle({
  variant = "icons",
  className = "",
}: {
  variant?: "icons" | "labeled";
  className?: string;
}) {
  const pref = useSyncExternalStore(subscribe, readPref, getServerSnapshot);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const iconsOnly = variant === "icons";

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = OPTIONS.length - 1;
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = index === 0 ? last : index - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    e.preventDefault();
    setThemePref(OPTIONS[next].value);
    optionRefs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className={`inline-flex gap-0.5 rounded-control border border-line-strong bg-surface p-0.5 ${className}`}
    >
      {OPTIONS.map((option, index) => {
        const checked = pref === option.value;
        const OptionIcon = option.icon;
        return (
          <button
            key={option.value}
            ref={(el) => {
              optionRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={iconsOnly ? option.label : undefined}
            title={iconsOnly ? option.label : undefined}
            tabIndex={checked ? 0 : -1}
            onClick={() => setThemePref(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-chip px-3 text-sm font-medium transition-colors duration-(--sf-dur-base) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus sm:h-7 ${
              checked ? "bg-selected text-on-selected" : "text-fg-muted hover:bg-hover hover:text-fg"
            }`}
          >
            <OptionIcon className="size-4 shrink-0" />
            {!iconsOnly && <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
