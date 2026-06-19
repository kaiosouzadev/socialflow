"use client";

import { BRAND, BrandBadge } from "./BrandIcons";
import { AiCaptionButton } from "./AiCaptionButton";

/**
 * Um campo de legenda por rede selecionada, com um único botão que gera
 * todas as legendas de uma vez e preenche cada campo.
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
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="label !mb-0">Legendas por rede</label>
        <AiCaptionButton
          clientId={clientId}
          theme={theme}
          targets={targets}
          disabled={aiDisabled || targets.length === 0}
          onResult={(generated) => setCaptions((prev) => ({ ...prev, ...generated }))}
        />
      </div>

      {targets.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Selecione ao menos uma rede para escrever as legendas.
        </p>
      ) : (
        <div className="space-y-3">
          {targets.map((t) => (
            <div key={t}>
              <div className="flex items-center gap-2 mb-1.5">
                <BrandBadge platform={t} size={20} />
                <span className="text-xs font-medium text-[var(--color-text-muted)]">
                  {BRAND[t]?.label ?? t}
                </span>
              </div>
              <textarea
                value={captions[t] ?? ""}
                onChange={(e) =>
                  setCaptions((prev) => ({ ...prev, [t]: e.target.value }))
                }
                rows={4}
                className="input resize-none"
                placeholder={`Legenda para ${BRAND[t]?.label ?? t}... ou gere com IA`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
