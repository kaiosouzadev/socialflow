"use client";

import { useRef, useState } from "react";
import { Icon } from "./Icons";

const ACCEPT = "image/png,image/jpeg,image/webp";

function isVideoUrl(u: string) {
  return /\.(mp4|mov|webm|m4v)$/i.test(u);
}

/**
 * Mídia do post: sobe o arquivo direto ou cola uma URL pública.
 *
 * Antes só existia o campo de URL, então era preciso hospedar a imagem em
 * outro lugar antes de agendar — e a prévia só aparecia depois de salvar.
 */
export function MediaField({
  value,
  onChange,
  clientId,
  label = "Mídia do post",
  compact = false,
}: {
  value: string;
  onChange: (url: string) => void;
  clientId?: string;
  label?: string;
  /** Linha única para listas densas (ex.: revisão do calendário). */
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    setError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "post");
      if (clientId) fd.append("clientId", clientId);

      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setError(typeof d?.error === "string" ? d.error : "Falha no upload.");
        return;
      }
      onChange(d.url as string);
    } catch {
      setError("Falha de conexão no upload. Tente novamente.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const hiddenInput = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) void upload(f);
      }}
    />
  );

  if (compact) {
    return (
      <div>
        <div className="flex items-center gap-2">
          <span className="w-9 h-9 shrink-0 rounded-lg overflow-hidden border border-[var(--color-border)] bg-black/30 flex items-center justify-center">
            {value ? (
              isVideoUrl(value) ? (
                <video src={value} muted playsInline preload="metadata" className="w-full h-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={value} alt="" className="w-full h-full object-cover" />
              )
            ) : (
              <Icon.alert className="w-3.5 h-3.5 text-[var(--color-text-faint)]" />
            )}
          </span>
          <input
            type="url"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://… ou envie o arquivo →"
            className="input font-mono text-xs flex-1 min-w-0"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            title="Enviar imagem do computador"
            className="btn-ghost !py-2 !px-2.5 text-xs shrink-0"
          >
            <Icon.folder className="w-3.5 h-3.5" />
            {uploading ? "..." : "Enviar"}
          </button>
        </div>
        {hiddenInput}
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <label className="label">{label}</label>

      <div className="flex items-start gap-3 flex-wrap">
        {/* prévia */}
        <div className="w-24 h-24 shrink-0 rounded-xl overflow-hidden border border-[var(--color-border)] bg-black/30 flex items-center justify-center">
          {value ? (
            isVideoUrl(value) ? (
              <video src={value} muted playsInline preload="metadata" className="w-full h-full object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={value} alt="Prévia da mídia" className="w-full h-full object-cover" />
            )
          ) : (
            <Icon.alert className="w-5 h-5 text-[var(--color-text-faint)]" />
          )}
        </div>

        <div className="flex-1 min-w-56 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="btn-ghost !py-2 text-xs"
            >
              <Icon.folder className="w-3.5 h-3.5" />
              {uploading ? "Enviando..." : value ? "Trocar imagem" : "Enviar imagem"}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange("")}
                disabled={uploading}
                className="text-xs text-[var(--color-text-muted)] hover:text-white"
              >
                Remover
              </button>
            )}
            <span className="text-[11px] text-[var(--color-text-faint)]">
              png, jpg ou webp · até 8MB
            </span>
          </div>

          {hiddenInput}

          <input
            type="url"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="input text-sm"
            placeholder="ou cole a URL pública: https://exemplo.com/imagem.jpg"
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
    </div>
  );
}
