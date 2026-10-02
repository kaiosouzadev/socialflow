"use client";

import { useId, useRef, useState } from "react";
import { Button } from "./Button";
import { Label, useFieldControl } from "./Field";
import { Icon } from "./Icons";
import { toUserMessage } from "@/lib/user-facing-error";

const ACCEPT = "image/png,image/jpeg,image/webp";
const UPLOAD_ERROR = "Não foi possível enviar o arquivo. Tente de novo em instantes.";

function isVideoUrl(u: string) {
  return /\.(mp4|mov|webm|m4v)$/i.test(u);
}

const URL_INPUT =
  "h-11 w-full min-w-0 rounded-control border bg-surface px-3 text-base text-fg transition-colors duration-(--sf-dur-fast) placeholder:text-fg-faint hover:border-fg-muted focus:border-focus focus:outline-2 focus:outline-offset-1 focus:outline-focus sm:h-10 sm:text-sm";

/**
 * Mídia do post: sobe o arquivo direto ou cola uma URL pública.
 *
 * Antes só existia o campo de URL, então era preciso hospedar a imagem em
 * outro lugar antes de agendar — e a prévia só aparecia depois de salvar.
 * Dentro de um <Field>, o campo de URL recebe o id, a descrição e o erro dele.
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
  const field = useFieldControl();
  const ownId = useId();
  const errorId = useId();
  const urlId = field?.id ?? ownId;
  const invalid = !!error || !!field?.invalid;
  const describedBy = [field?.describedBy, error ? errorId : null].filter(Boolean).join(" ") || undefined;

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
      if (!r.ok || typeof d?.url !== "string") {
        setError(toUserMessage(d, UPLOAD_ERROR));
        return;
      }
      onChange(d.url);
    } catch {
      setError("Falha de conexão no envio. Verifique a internet e tente de novo.");
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

  const urlInput = (placeholder: string, extra: string) => (
    <input
      id={urlId}
      type="url"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      // compacto e sem <Field>: não há rótulo visível ligado ao campo
      aria-label={compact && !field ? "URL da arte" : undefined}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className={`${URL_INPUT} ${invalid ? "border-danger-solid" : "border-line-strong"} ${extra}`}
    />
  );

  const errorText = error ? (
    <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-danger-fg">
      {error}
    </p>
  ) : null;

  const thumb = (size: string, iconSize: string, alt: string) => (
    <span
      className={`${size} flex shrink-0 items-center justify-center overflow-hidden rounded-control border border-line bg-sunken`}
    >
      {value ? (
        isVideoUrl(value) ? (
          <video src={value} muted playsInline preload="metadata" className="size-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={alt} className="size-full object-cover" />
        )
      ) : (
        <Icon.alert className={`${iconSize} text-fg-muted`} />
      )}
    </span>
  );

  if (compact) {
    return (
      <div>
        <div className="flex items-center gap-2">
          {thumb("size-9", "size-3.5", "")}
          {urlInput("https://… ou envie o arquivo →", "flex-1 font-mono")}
          <Button
            size="sm"
            leadingIcon={<Icon.upload />}
            loading={uploading}
            loadingText="Enviando…"
            title="Enviar imagem do computador"
            onClick={() => inputRef.current?.click()}
            className="shrink-0"
          >
            Enviar
          </Button>
        </div>
        {hiddenInput}
        {errorText}
      </div>
    );
  }

  return (
    <div>
      {!field && (
        <Label htmlFor={urlId} className="mb-1.5 block">
          {label}
        </Label>
      )}

      <div className="flex flex-wrap items-start gap-3">
        {/* prévia */}
        {thumb("size-24", "size-5", "Prévia da mídia")}

        <div className="min-w-56 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              leadingIcon={<Icon.upload />}
              loading={uploading}
              loadingText="Enviando…"
              onClick={() => inputRef.current?.click()}
            >
              {value ? "Trocar imagem" : "Enviar imagem"}
            </Button>
            {value && (
              <Button variant="ghost" size="sm" disabled={uploading} onClick={() => onChange("")}>
                Remover
              </Button>
            )}
            <span className="text-xs text-fg-muted">png, jpg ou webp · até 8MB</span>
          </div>

          {hiddenInput}

          {urlInput("ou cole a URL pública: https://exemplo.com/imagem.jpg", "")}
        </div>
      </div>

      {errorText}
    </div>
  );
}
