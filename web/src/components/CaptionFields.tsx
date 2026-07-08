"use client";

import { useState } from "react";
import { BrandBadge } from "./BrandIcons";
import { AiCaptionButton } from "./AiCaptionButton";

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
      <div className="flex items-center justify-between mb-2">
        <label className="label !mb-0">Legendas</label>
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
        <p className="text-sm text-[var(--color-text-muted)]">
          Selecione ao menos uma rede para escrever as legendas.
        </p>
      ) : (
        <div className="space-y-3">
          {hasMeta && (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="flex items-center gap-1">
                  <BrandBadge platform="facebook" size={20} />
                  <BrandBadge platform="instagram" size={20} />
                </span>
                <span className="text-xs font-medium text-[var(--color-text-muted)]">
                  Facebook + Instagram (legenda única)
                </span>
              </div>
              <textarea
                value={shared}
                onChange={(e) => setShared(e.target.value)}
                rows={4}
                className="input resize-none"
                placeholder="Legenda para Facebook e Instagram... ou gere com IA"
              />
            </div>
          )}

          {hasLinkedin && (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <BrandBadge platform="linkedin" size={20} />
                <span className="text-xs font-medium text-[var(--color-text-muted)]">
                  LinkedIn
                  {!liDirty && hasMeta && (
                    <span className="text-[var(--color-text-faint)] font-normal"> · espelhando a legenda acima</span>
                  )}
                </span>
              </div>
              <textarea
                value={captions.linkedin ?? shared}
                onChange={(e) => setLinkedin(e.target.value)}
                rows={4}
                className="input resize-none"
                placeholder="Legenda para LinkedIn (por padrão igual à de Facebook/Instagram)"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
