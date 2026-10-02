"use client";

import { useId, useState } from "react";
import { BrandBadge } from "./BrandIcons";
import { AiCaptionButton } from "./AiCaptionButton";

const TEXTAREA =
  "w-full resize-y rounded-control border border-line-strong bg-surface px-3 py-2.5 text-base leading-relaxed text-fg transition-colors duration-(--sf-dur-fast) placeholder:text-fg-faint hover:border-fg-muted focus:border-focus focus:outline-2 focus:outline-offset-1 focus:outline-focus sm:text-sm";

/**
 * Padrão de legendas do sistema:
 * - Facebook + Instagram compartilham UM campo (mesma legenda nas duas redes).
 * - LinkedIn tem campo próprio que espelha a legenda compartilhada até ser
 *   editado manualmente (aí vira independente).
 * O armazenamento continua por rede ({ instagram, facebook, linkedin }).
 */
export function CaptionFields({
  clientId,
  theme,
  targets,
  captions,
  setCaptions,
  aiDisabled,
}: {
  clientId: string;
  theme: string;
  targets: string[];
  captions: Record<string, string>;
  setCaptions: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  aiDisabled?: boolean;
}) {
  const shared = captions.instagram ?? captions.facebook ?? "";
  const [liDirty, setLiDirty] = useState(
    () => typeof captions.linkedin === "string" && captions.linkedin !== shared
  );
  const sharedId = useId();
  const linkedinId = useId();

  const hasMeta = targets.includes("instagram") || targets.includes("facebook");
  const hasLinkedin = targets.includes("linkedin");

  function setShared(text: string) {
    setCaptions((prev) => ({
      ...prev,
      instagram: text,
      facebook: text,
      ...(liDirty ? {} : { linkedin: text }),
    }));
  }

  function setLinkedin(text: string) {
    setLiDirty(true);
    setCaptions((prev) => ({ ...prev, linkedin: text }));
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-fg">Legendas</p>
        <AiCaptionButton
          clientId={clientId}
          theme={theme}
          targets={targets}
          disabled={aiDisabled || targets.length === 0}
          onResult={(generated) => {
            const s = generated.instagram ?? generated.facebook ?? "";
            const li = generated.linkedin ?? s;
            setLiDirty(!!generated.linkedin && generated.linkedin !== s);
            setCaptions((prev) => ({ ...prev, instagram: s, facebook: s, linkedin: li }));
          }}
        />
      </div>

      {targets.length === 0 ? (
        <p className="text-sm text-fg-muted">Selecione ao menos uma rede para escrever as legendas.</p>
      ) : (
        <div className="space-y-3">
          {hasMeta && (
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span aria-hidden="true" className="flex items-center gap-1">
                  <BrandBadge platform="facebook" size={20} />
                  <BrandBadge platform="instagram" size={20} />
                </span>
                <label htmlFor={sharedId} className="text-sm font-medium text-fg-muted">
                  Facebook + Instagram (legenda única)
                </label>
              </div>
              <textarea
                id={sharedId}
                value={shared}
                onChange={(e) => setShared(e.target.value)}
                rows={9}
                className={`${TEXTAREA} min-h-32`}
                placeholder="Legenda para Facebook e Instagram... ou gere com IA"
              />
            </div>
          )}

          {hasLinkedin && (
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <span aria-hidden="true" className="flex items-center">
                  <BrandBadge platform="linkedin" size={20} />
                </span>
                <label htmlFor={linkedinId} className="text-sm font-medium text-fg-muted">
                  LinkedIn
                  {!liDirty && hasMeta && <span className="font-normal"> · espelhando a legenda acima</span>}
                </label>
              </div>
              <textarea
                id={linkedinId}
                value={captions.linkedin ?? shared}
                onChange={(e) => setLinkedin(e.target.value)}
                rows={7}
                className={`${TEXTAREA} min-h-24`}
                placeholder="Legenda para LinkedIn (por padrão igual à de Facebook/Instagram)"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
