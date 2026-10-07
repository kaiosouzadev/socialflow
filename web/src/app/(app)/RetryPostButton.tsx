"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icons";

type Outcome =
  | { kind: "queued" }
  | { kind: "skipped" }
  | { kind: "unchanged" }
  | { kind: "error"; text: string };

const FALLBACK_ERROR = "Não foi possível reenviar o post. Tente de novo.";
const NETWORK_ERROR = "Falha de conexão. Verifique a internet e tente de novo.";

/** Resultado que substitui o botão (o reenvio não se repete). */
const RESULT = {
  queued: {
    text: "Na fila: publica em ~2 min",
    className: "font-medium text-success-fg",
    icon: <Icon.check className="mt-0.5 size-4 shrink-0 text-success-solid" />,
  },
  // cliente só produção: o servidor não recoloca na fila (S13)
  skipped: {
    text: "Não voltou à fila: os posts deste cliente não são agendados pelo sistema.",
    className: "text-warning-fg",
    icon: <Icon.alert className="mt-0.5 size-4 shrink-0 text-warning-solid" />,
  },
  // o post já não estava com falha (outra pessoa reenviou ou o status mudou)
  unchanged: {
    text: "Nada a reenviar: o post já não está com falha.",
    className: "text-fg-muted",
    icon: <Icon.info className="mt-0.5 size-4 shrink-0" />,
  },
} as const;

/**
 * Reenvio de um post específico, direto de onde ele aparece (dashboard e
 * detalhe do post). API congelada: `{ postId, label? }` (o S25 importa).
 *
 * Um único canal de feedback, em linha: o resultado substitui o botão e
 * recebe o foco; o erro aparece sob o botão, ligado por aria-describedby,
 * com o botão de volta ao normal.
 */
export default function RetryPostButton({
  postId,
  label = "Reenviar",
}: {
  postId: string;
  label?: string;
}) {
  const router = useRouter();
  const messageId = useId();
  const resultRef = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // o botão some ao concluir: o foco vai para o resultado, não para o <body>
  useEffect(() => {
    if (outcome && outcome.kind !== "error") resultRef.current?.focus();
  }, [outcome]);

  async function retry() {
    setBusy(true);
    setOutcome(null);
    try {
      const r = await fetch("/api/posts/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "ids", ids: [postId] }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setOutcome({
          kind: "error",
          text:
            r.status === 401
              ? "Sua sessão expirou. Entre de novo para continuar."
              : typeof d?.error === "string"
                ? d.error
                : FALLBACK_ERROR,
        });
        return;
      }
      const requeued = typeof d?.requeued === "number" ? d.requeued : 0;
      const skipped = typeof d?.skippedNoPublish === "number" ? d.skippedNoPublish : 0;
      const kind = requeued > 0 ? "queued" : skipped > 0 ? "skipped" : "unchanged";
      setOutcome({ kind });
      // "skipped" não mudou nada no banco: não há o que recarregar
      if (kind !== "skipped") router.refresh();
    } catch {
      setOutcome({ kind: "error", text: NETWORK_ERROR });
    } finally {
      setBusy(false);
    }
  }

  if (outcome && outcome.kind !== "error") {
    const r = RESULT[outcome.kind];
    return (
      <p
        ref={resultRef}
        tabIndex={-1}
        role="status"
        className={`inline-flex items-start gap-1.5 text-sm outline-none ${r.className}`}
      >
        {r.icon}
        {r.text}
      </p>
    );
  }

  const error = outcome?.kind === "error" ? outcome.text : null;
  return (
    <div className="inline-flex max-w-full flex-col items-start gap-1.5">
      <Button
        size="sm"
        variant="secondary"
        leadingIcon={<Icon.refresh />}
        loading={busy}
        loadingText="Reenviando…"
        onClick={retry}
        title="Recoloca este post na fila de publicação"
        aria-describedby={error ? messageId : undefined}
      >
        {label}
      </Button>
      {error && (
        <p id={messageId} role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}
