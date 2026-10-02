"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { Button } from "@/components/Button";
import { Field, Textarea } from "@/components/Field";
import { ToneBadge } from "@/components/ui";
import { Toast, type ToastState } from "@/components/Toast";

export type AdjustmentRow = {
  id: string;
  comment: string;
  /** "12/10 às 14:18" */
  createdAt: string;
  postId: string;
  postTheme: string;
  clientName: string;
  /** "Outubro de 2026" */
  month: string;
  scheduleId: string | null;
  /**
   * "cronograma": o cronograma está com o cliente e o ajuste bloqueia a aprovação dele;
   * "post": ajuste de um post (link semanal), que bloqueia a aprovação desse post.
   */
  phase: "cronograma" | "post";
};

/** Mesmo limite do POST /api/adjustments/[id]/resolve. */
const MAX_REPLY = 1000;

/** O que concluir este ajuste libera (os outros ajustes abertos continuam bloqueando). */
function resolvedMessage(row: AdjustmentRow, rows: AdjustmentRow[], autoApproved: boolean): string {
  if (autoApproved) {
    return "Ajuste concluído. O prazo do cliente já tinha vencido: o cronograma foi aprovado automaticamente.";
  }
  const others = rows.filter(
    (r) =>
      r.id !== row.id &&
      (row.phase === "cronograma" ? r.scheduleId === row.scheduleId : r.postId === row.postId)
  ).length;
  const left = others === 1 ? "Falta 1 ajuste" : `Faltam ${others} ajustes`;
  if (row.phase === "cronograma") {
    return others === 0
      ? `Ajuste concluído. O cliente já pode aprovar o cronograma de ${row.month}.`
      : `Ajuste concluído. ${left} deste cronograma para o cliente poder aprovar.`;
  }
  return others === 0
    ? "Ajuste concluído. O cliente já pode aprovar este post."
    : `Ajuste concluído. ${left} neste post para o cliente poder aprovar.`;
}

function AdjustmentItem({
  row,
  rows,
  notify,
}: {
  row: AdjustmentRow;
  rows: AdjustmentRow[];
  notify: (t: ToastState) => void;
}) {
  const router = useRouter();
  const replyBoxId = useId();
  const errorId = useId();
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const [reply, setReply] = useState("");
  const [showReply, setShowReply] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ao abrir a resposta, o foco vai para o campo
  useEffect(() => {
    if (showReply) replyRef.current?.focus();
  }, [showReply]);

  async function resolve() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/adjustments/${row.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // resposta descartada não vai junto
        body: JSON.stringify({ reply: (showReply && reply.trim()) || undefined }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        // N-14: só o texto do servidor; objeto (zod) vira mensagem desta tela
        setError(typeof d?.error === "string" ? d.error : "Não foi possível concluir o ajuste. Tente de novo.");
        if (r.status === 404 || r.status === 409) router.refresh();
        return;
      }
      notify({ kind: "success", text: resolvedMessage(row, rows, d?.autoApproved === true) });
      router.refresh();
    } catch {
      setError("Falha de conexão ao concluir o ajuste. Verifique a internet e tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">
            {row.clientName} <span className="font-normal text-fg-muted">· {row.month}</span>
          </h3>
          <Link
            href={`/posts/${row.postId}`}
            className="inline-flex min-h-11 items-center text-sm text-link underline underline-offset-2 hover:text-link-hover sm:min-h-10"
          >
            {row.postTheme || "Abrir post"}
          </Link>
          <p className="text-xs text-fg-muted">Pedido em {row.createdAt}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showReply}
            aria-controls={showReply ? replyBoxId : undefined}
            disabled={busy}
            onClick={() => setShowReply((v) => !v)}
          >
            {showReply ? "Descartar resposta" : "Escrever resposta"}
          </Button>
          <Button
            variant="primary"
            size="sm"
            leadingIcon={<Icon.check />}
            loading={busy}
            loadingText="Concluindo…"
            aria-describedby={error ? errorId : undefined}
            onClick={() => void resolve()}
          >
            Concluir ajuste
          </Button>
        </div>
      </div>

      <p className="mt-3 whitespace-pre-wrap rounded-control border border-warning-line bg-warning-bg px-3 py-2 text-sm text-fg">
        <span className="sr-only">Pedido do cliente: </span>
        {row.comment}
      </p>

      {showReply && (
        <div id={replyBoxId} className="mt-3">
          <Field label="Resposta ao cliente" optional help="O cliente vê esta resposta no link de aprovação.">
            <Textarea
              ref={replyRef}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={2}
              maxLength={MAX_REPLY}
              showCount
              disabled={busy}
              placeholder="Ex.: trocamos o tema para focar em resultados."
            />
          </Field>
        </div>
      )}

      {error && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-danger-fg">
          {error}
        </p>
      )}
    </li>
  );
}

export default function AdjustmentsPanel({ rows }: { rows: AdjustmentRow[] }) {
  const [toast, setToast] = useState<ToastState>(null);
  return (
    <>
      {rows.length > 0 && (
        <section id="ajustes" aria-labelledby="ajustes-titulo" className="mb-8 scroll-mt-20">
          <div className="mb-3 flex items-start gap-3">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-full border border-warning-line bg-warning-bg text-warning-solid"
            >
              <span className="inline-flex size-4 [&>svg]:size-full">
                <Icon.alert />
              </span>
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="ajustes-titulo" className="text-base font-semibold text-fg">
                  Ajustes pedidos pelos clientes
                </h2>
                <ToneBadge tone="warning">{rows.length === 1 ? "1 aberto" : `${rows.length} abertos`}</ToneBadge>
              </div>
              <p className="mt-0.5 text-sm text-fg-muted">
                Enquanto um ajuste estiver aberto, o cliente não consegue aprovar. Concluir o ajuste libera a aprovação.
              </p>
            </div>
          </div>
          <ul aria-labelledby="ajustes-titulo" className="card divide-y divide-line overflow-hidden">
            {rows.map((r) => (
              <AdjustmentItem key={r.id} row={r} rows={rows} notify={setToast} />
            ))}
          </ul>
        </section>
      )}
      {/* fora da seção: o aviso do último ajuste concluído continua visível depois que a lista some */}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}
