"use client";

import { useState } from "react";
import { Avatar } from "./Avatar";
import { BrandBadge, BRAND } from "./BrandIcons";
import { Icon } from "./Icons";
import { SegmentedControl } from "./Toggle";
import { formatMeta, type PostFormat } from "@/lib/formats";

/** Proporção da mídia por tipo de postagem, como cada rede recorta (artes de feed são 4:5, A-008). */
const RATIO: Record<string, string> = {
  feed: "aspect-4/5",
  carrossel: "aspect-4/5",
  story: "aspect-9/16",
  reels: "aspect-9/16",
};

/* Placeholder de mídia na cor do formato (DESIGN a.6): fundo, ícone e rótulo. */
const PLACEHOLDER: Record<PostFormat, { box: string; icon: string }> = {
  feed: { box: "bg-format-feed-bg text-format-feed-fg", icon: "text-format-feed" },
  carrossel: { box: "bg-format-carrossel-bg text-format-carrossel-fg", icon: "text-format-carrossel" },
  reels: { box: "bg-format-reels-bg text-format-reels-fg", icon: "text-format-reels" },
  story: { box: "bg-format-story-bg text-format-story-fg", icon: "text-format-story" },
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
  const [chosen, setChosen] = useState(platforms[0] ?? "instagram");
  const [expanded, setExpanded] = useState(false);
  // URL da mídia que falhou ao carregar (volta a tentar se a URL mudar)
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (platforms.length === 0) return null;
  // a rede escolhida pode ter saído dos destinos depois
  const platform = platforms.includes(chosen) ? chosen : platforms[0];

  // o Instagram corta a legenda por volta de 125 caracteres e esconde o resto
  const LIMIT = 125;
  const long = caption.length > LIMIT;
  const shown = expanded || !long ? caption : caption.slice(0, LIMIT).trimEnd();

  const handle = clientName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const author = platform === "instagram" ? handle || "cliente" : clientName;
  const placeholder = PLACEHOLDER[formatMeta(format).id];
  const showMedia = !!mediaUrl && failedUrl !== mediaUrl;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-fg">Prévia</p>
        {platforms.length > 1 && (
          <SegmentedControl
            size="sm"
            aria-label="Rede da prévia"
            value={platform}
            onChange={setChosen}
            options={platforms.map((p) => ({
              value: p,
              label: BRAND[p]?.label ?? p,
              icon: <BrandBadge platform={p} size={16} />,
            }))}
          />
        )}
      </div>

      <div className="mx-auto w-full max-w-80 overflow-hidden rounded-card border border-line bg-surface">
        {/* cabeçalho da publicação */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <Avatar name={clientName} size="sm" />
          <p className="min-w-0 truncate text-sm font-semibold text-fg">{author}</p>
          <BrandBadge platform={platform} size={16} className="ml-auto shrink-0" />
        </div>

        {/* mídia */}
        <div data-preview-media="" className={`${RATIO[format] ?? "aspect-4/5"} relative overflow-hidden bg-sunken`}>
          {showMedia ? (
            isVideoUrl(mediaUrl) ? (
              <video
                src={mediaUrl}
                muted
                playsInline
                preload="metadata"
                onError={() => setFailedUrl(mediaUrl)}
                className="size-full object-cover"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaUrl}
                alt="Arte do post"
                onError={() => setFailedUrl(mediaUrl)}
                className="size-full object-cover"
              />
            )
          ) : (
            <div className={`flex size-full flex-col items-center justify-center gap-2 px-6 text-center ${placeholder.box}`}>
              <Icon.alert className={`size-6 ${placeholder.icon}`} />
              <p className="text-xs font-medium">
                {mediaUrl ? "Arte indisponível" : "Sem arte — a publicação vai falhar"}
              </p>
            </div>
          )}
        </div>

        {/* legenda */}
        <div className="px-3 py-2.5">
          {caption ? (
            <p className="whitespace-pre-wrap wrap-break-word text-xs leading-relaxed text-fg">
              <span className="font-semibold">{author}</span> {shown}
              {long && !expanded && (
                <>
                  …{" "}
                  {/* A-033: o box do botão é só o texto, então o anel de foco fica a 4 px dele e cabe no px-3
                      da legenda em qualquer ponto da linha. O alvo de 46×46 px é o ::before absoluto, que não
                      muda o layout: parte da posição estática (início do texto), 10 px à esquerda e 26 px acima,
                      sobre as linhas anteriores. Sem `relative` no botão de propósito: ele põe o texto numa
                      camada própria e muda a suavização do "mais" a partir de 768 px. */}
                  <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="text-fg-muted underline-offset-2 before:absolute before:-mt-6.5 before:-ml-2.5 before:size-11.5 hover:text-fg hover:underline"
                  >
                    mais
                  </button>
                </>
              )}
            </p>
          ) : (
            <p className="text-xs text-fg-muted">Sem legenda</p>
          )}
        </div>
      </div>

      {long && (
        <p className="mt-1.5 text-center text-xs text-fg-muted">
          A legenda tem {caption.length} caracteres — o Instagram corta em ~{LIMIT} e esconde o resto
          atrás de “mais”.
        </p>
      )}
    </div>
  );
}
