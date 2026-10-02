"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";

const FALLBACK_ERROR = "Não foi possível gerar o resumo do dia agora. Tente de novo em instantes.";
const NETWORK_ERROR = "Falha de conexão. Verifique a internet e tente de novo.";

export default function DailySummaryCard({
  content,
  generatedAt,
  postCount,
}: {
  content: string | null;
  generatedAt: string | null;
  postCount: number;
}) {
  const router = useRouter();
  const errorId = useId();
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // A-043: try/catch/finally — com a rede caindo o botão volta ao normal, com mensagem.
  // A-026: mostra o `error` do servidor (texto amigável do S17) quando é string (N-14).
  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/daily-summary", { method: "POST" });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          res.status === 401
            ? "Sua sessão expirou. Entre de novo para continuar."
            : typeof d?.error === "string"
              ? d.error
              : FALLBACK_ERROR,
        );
        return;
      }
      startRefresh(() => router.refresh());
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const loading = busy || refreshing;

  return (
    <section aria-labelledby="resumo-titulo" className="card mb-6 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* "IA": o resumo é escrito pela inteligência artificial */}
          <Avatar name="Inteligência Artificial" shape="square" />
          <div className="min-w-0">
            <h2 id="resumo-titulo" className="font-display text-lg font-semibold tracking-title text-fg">
              Resumo do dia
            </h2>
            <p className="text-xs text-fg-muted">
              {postCount} {postCount === 1 ? "post hoje" : "posts hoje"}
              {generatedAt && ` · atualizado ${generatedAt}`}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icon.refresh />}
          loading={loading}
          loadingText="Gerando…"
          onClick={regenerate}
          aria-describedby={error ? errorId : undefined}
        >
          {content ? "Atualizar resumo" : "Gerar resumo"}
        </Button>
      </div>

      {content ? (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-fg">{content}</p>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">
          Nenhum resumo gerado ainda hoje. Use “Gerar resumo” para a inteligência artificial resumir os posts do dia.
        </p>
      )}

      {error && (
        <div id={errorId} className="mt-3">
          <Callout tone="danger" live="assertive">
            {error}
          </Callout>
        </div>
      )}
    </section>
  );
}
