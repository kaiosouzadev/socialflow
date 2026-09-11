"use client";

import { useState } from "react";
import { BrandBadge, BRAND } from "./BrandIcons";

/** Proporção da mídia por tipo de postagem, como cada rede recorta. */
const RATIO: Record<string, string> = {
  feed: "aspect-square",
  carrossel: "aspect-square",
  story: "aspect-[9/16]",
  reels: "aspect-[9/16]",
};

function isVideoUrl(u: string) {
  return /\.(mp4|mov|webm|m4v)$/i.test(u);
}

/**
 * Prévia aproximada de como o post sai na rede.
 *
 * Não é um espelho exato do Instagram — serve para pegar antes de publicar o
 * que só aparecia depois: legenda cortada, arte no recorte errado, texto que
 * some atrás do "mais".
 */
export function PostPreview({
  mediaUrl,
  caption,
  clientName,
  targets,
  format,
}: {
  mediaUrl: string;
  caption: string;
  clientName: string;
  targets: string[];
  format: string;
}) {
  const platforms = targets.filter((t) => t === "instagram" || t === "facebook");
  const [platform, setPlatform] = useState(platforms[0] ?? "instagram");
  const [expanded, setExpanded] = useState(false);

  if (platforms.length === 0) return null;

  // o Instagram corta a legenda por volta de 125 caracteres e esconde o resto
  const LIMIT = 125;
  const long = caption.length > LIMIT;
  const shown = expanded || !long ? caption : caption.slice(0, LIMIT).trimEnd();

  const handle = clientName.toLowerCase().replace(/[^a-z0-9]+/g, "");

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="label !mb-0">Prévia</span>
        {platforms.length > 1 && (
          <div className="flex items-center gap-1">
            {platforms.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                  platform === p
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-white"
                    : "border-[var(--color-border)] text-[var(--color-text-muted)]"
                }`}
              >
                <BrandBadge platform={p} size={14} />
                {BRAND[p]?.label ?? p}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mx-auto w-full max-w-80 rounded-xl border border-[var(--color-border)] bg-black/20 overflow-hidden">
        {/* cabeçalho da publicação */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="w-7 h-7 rounded-full bg-gradient-to-br from-[#7c5cff] to-[#ec4899] shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">
              {platform === "instagram" ? handle || "cliente" : clientName}
            </p>
            <p className="text-[10px] text-[var(--color-text-faint)]">Patrocinado · agora</p>
          </div>
          <BrandBadge platform={platform} size={16} className="ml-auto shrink-0" />
        </div>

        {/* mídia */}
        <div className={`${RATIO[format] ?? "aspect-square"} bg-black/40 flex items-center justify-center`}>
          {mediaUrl ? (
            isVideoUrl(mediaUrl) ? (
              <video src={mediaUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaUrl} alt="" className="w-full h-full object-cover" />
            )
          ) : (
            <p className="text-xs text-[var(--color-text-faint)] px-6 text-center">
              Sem arte — a publicação vai falhar
            </p>
          )}
        </div>

        {/* legenda */}
        <div className="px-3 py-2.5">
          {caption ? (
            <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">
              <span className="font-semibold">
                {platform === "instagram" ? handle || "cliente" : clientName}
              </span>{" "}
              {shown}
              {long && !expanded && (
                <>
                  …{" "}
                  <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="text-[var(--color-text-faint)] hover:text-white"
                  >
                    mais
                  </button>
                </>
              )}
            </p>
          ) : (
            <p className="text-xs text-[var(--color-text-faint)]">Sem legenda</p>
          )}
        </div>
      </div>

      {long && (
        <p className="text-[11px] text-[var(--color-text-faint)] text-center mt-1.5">
          A legenda tem {caption.length} caracteres — o Instagram corta em ~{LIMIT} e esconde o resto
          atrás de “mais”.
        </p>
      )}
    </div>
  );
}
