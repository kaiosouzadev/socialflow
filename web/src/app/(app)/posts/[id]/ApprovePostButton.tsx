"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icons";

/**
 * "Aprovar e agendar" de um post individual.
 *
 * Dois bloqueios que antes não existiam:
 *  - post sem arte ia para a fila e falhava na publicação (só havia uma dica);
 *  - cliente do plano "com aprovação" era agendado com 1 clique, pulando o
 *    cronograma que o cliente precisa aprovar.
 *
 * Nenhum dos dois é um beco sem saída: o admin confirma e segue.
 */
export default function ApprovePostButton({
  postId,
  hasMedia,
  needsClientApproval,
  clientName,
  scheduleId,
}: {
  postId: string;
  hasMedia: boolean;
  needsClientApproval: boolean;
  clientName: string;
  scheduleId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const blocked = !hasMedia || needsClientApproval;

  async function approve() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "scheduled" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setError(typeof d?.error === "string" ? d.error : "Não foi possível agendar.");
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Falha de conexão. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  function handleClick() {
    if (blocked) {
      setConfirming(true);
      return;
    }
    void approve();
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <button onClick={handleClick} disabled={busy} className="btn-primary">
          <Icon.check className="w-4 h-4" />
          {busy ? "Agendando..." : needsClientApproval ? "Agendar sem aprovação" : "Aprovar e agendar"}
        </button>
        {!hasMedia && (
          <span className="text-xs text-amber-300/90">Sem arte — a publicação vai falhar.</span>
        )}
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setConfirming(false)}
        >
          <div
            className="card w-full max-w-md rounded-b-none sm:rounded-2xl p-6 animate-fade-up text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-3">Agendar mesmo assim?</h2>

            <div className="space-y-2.5 mb-5">
              {!hasMedia && (
                <div className="flex items-start gap-2.5 rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2.5">
                  <Icon.alert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-200/90">
                    <span className="font-semibold">Este post não tem arte.</span> Instagram e
                    Facebook exigem mídia — na data marcada a publicação falha e o post vai para
                    &quot;Falhou&quot;.{" "}
                    <Link href={`/posts/${postId}/edit`} className="underline hover:text-white">
                      Adicionar a mídia
                    </Link>
                    .
                  </p>
                </div>
              )}

              {needsClientApproval && (
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2.5">
                  <Icon.shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-200/90">
                    <span className="font-semibold">{clientName} é do plano “com aprovação”.</span>{" "}
                    Agendar por aqui coloca o post na fila <span className="font-semibold">sem</span>{" "}
                    passar pela aprovação do cliente.
                    {scheduleId && (
                      <>
                        {" "}
                        O caminho normal é enviar o cronograma em{" "}
                        <Link href="/aprovacoes" className="underline hover:text-white">
                          Aprovações
                        </Link>
                        .
                      </>
                    )}
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="btn-ghost flex-1"
              >
                Cancelar
              </button>
              <button onClick={approve} disabled={busy} className="btn-primary flex-1">
                {busy ? "Agendando..." : "Agendar assim"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
