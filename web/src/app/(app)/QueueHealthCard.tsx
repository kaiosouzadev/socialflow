"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { Button, buttonClasses } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { ConfirmDialog } from "@/components/Dialog";
import { Toast, type ToastState } from "@/components/Toast";

type Props = {
  stuck: number;
  overdue: number;
  exhausted: number;
  failed: number;
  /** presos que voltam à fila (cliente com postagem pela agência) */
  stuckRequeueable: number;
  /** com falha que voltam à fila (cliente com postagem pela agência) */
  failedRequeueable: number;
  lastPublishedLabel: string | null;
  healthy: boolean;
};

type Scope = "stuck" | "failed";

const posts = (n: number) => `${n} ${n === 1 ? "post" : "posts"}`;

/** Link solto (fora de frase) com alvo ≥ 40 px (DESIGN, A11y "Alvos"). */
const LOOSE_LINK_SM = buttonClasses({ variant: "ghost", size: "sm" });

/**
 * Saúde da fila de publicação no dashboard.
 *
 * A fila travando em silêncio era o bug mais caro: posts ficavam presos em
 * "publishing" e só apareciam depois, como "Falharam". O travamento fica
 * visível na primeira tela, com a ação de destravar ao lado — sempre depois de
 * um ConfirmDialog com o resumo (A-002): nada é enviado antes de confirmar.
 * O servidor pula os clientes só produção (S13); o resumo já os desconta.
 */
export default function QueueHealthCard({
  stuck,
  overdue,
  exhausted,
  failed,
  stuckRequeueable,
  failedRequeueable,
  lastPublishedLabel,
  healthy,
}: Props) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Scope | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  function openConfirm(scope: Scope) {
    setError(null);
    setConfirm(scope);
  }

  function closeConfirm() {
    if (busy) return;
    setConfirm(null);
    setError(null);
  }

  async function requeue(scope: Scope) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/posts/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        // erro fica DENTRO do diálogo (nunca Toast com Dialog aberto)
        setError(
          r.status === 401
            ? "Sua sessão expirou. Entre de novo para continuar."
            : typeof d?.error === "string"
              ? d.error
              : "Não foi possível recolocar os posts na fila. Tente de novo.",
        );
        return;
      }
      const requeued = typeof d?.requeued === "number" ? d.requeued : 0;
      const skipped = typeof d?.skippedNoPublish === "number" ? d.skippedNoPublish : 0;
      const skippedText = skipped > 0 ? ` ${posts(skipped)} de cliente só produção ficou de fora.` : "";
      setConfirm(null);
      setToast(
        requeued > 0
          ? { kind: "success", text: `${posts(requeued)} de volta na fila — publicação em ~2 min.${skippedText}` }
          : { kind: "info", text: `Nenhum post voltou à fila: a lista já tinha mudado.${skippedText}` },
      );
      router.refresh();
    } catch {
      setError("Falha de conexão. Verifique a internet e tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  if (healthy && failed === 0) {
    return (
      <>
        <Callout tone="success" title="Fila de publicação saudável" className="mb-6">
          {lastPublishedLabel
            ? `Última publicação com sucesso: ${lastPublishedLabel}.`
            : "Nenhuma publicação com sucesso registrada ainda."}
        </Callout>
        <Toast toast={toast} onClose={() => setToast(null)} />
      </>
    );
  }

  const stuckSkipped = Math.max(0, stuck - stuckRequeueable);
  const failedSkipped = Math.max(0, failed - failedRequeueable);
  const skippedLine = (n: number) =>
    `${posts(n)} de cliente só produção ${n === 1 ? "fica" : "ficam"} de fora: a agência não publica para ${n === 1 ? "ele" : "eles"}.`;

  const dialog =
    confirm === "stuck"
      ? {
          title: `Destravar ${posts(stuckRequeueable)} ${stuckRequeueable === 1 ? "preso" : "presos"}?`,
          description:
            stuckRequeueable === 1
              ? "Ele está em “Publicando” há mais de 20 minutos."
              : "Eles estão em “Publicando” há mais de 20 minutos.",
          consequences: [
            `${posts(stuckRequeueable)} ${stuckRequeueable === 1 ? "volta" : "voltam"} à fila e ${stuckRequeueable === 1 ? "será publicado" : "serão publicados"} em ~2 min nas redes dos clientes.`,
            "As tentativas automáticas recomeçam do zero.",
            ...(stuckSkipped > 0 ? [skippedLine(stuckSkipped)] : []),
          ],
          confirmLabel: `Destravar ${posts(stuckRequeueable)}`,
          busyLabel: "Destravando…",
        }
      : {
          title: `Reenviar ${posts(failedRequeueable)} com falha?`,
          description:
            exhausted > 0 ? "Inclui os que já esgotaram as tentativas automáticas." : undefined,
          consequences: [
            `${posts(failedRequeueable)} ${failedRequeueable === 1 ? "volta" : "voltam"} à fila e ${failedRequeueable === 1 ? "será publicado" : "serão publicados"} em ~2 min nas redes dos clientes.`,
            "As tentativas automáticas recomeçam do zero e o último erro é apagado.",
            ...(failedSkipped > 0 ? [skippedLine(failedSkipped)] : []),
          ],
          confirmLabel: `Reenviar ${posts(failedRequeueable)}`,
          busyLabel: "Reenviando…",
        };

  return (
    <>
      <section
        aria-labelledby="fila-titulo"
        className={`card mb-6 p-4 sm:p-5 ${healthy ? "border-warning-line" : "border-danger-line"}`}
      >
        <div className="mb-4 flex items-start gap-3">
          <span aria-hidden="true" className={`mt-0.5 inline-flex shrink-0 ${healthy ? "text-warning-solid" : "text-danger-solid"}`}>
            <Icon.alert className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 id="fila-titulo" className="text-base font-semibold text-fg">
              {healthy ? "Fila com pendências" : "Fila de publicação travada"}
            </h2>
            <p className="text-sm text-fg-muted">
              {lastPublishedLabel
                ? `Última publicação com sucesso: ${lastPublishedLabel}`
                : "Nenhuma publicação com sucesso registrada ainda"}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Presos publicando" value={stuck} tone="bad" hint="há mais de 20 min" />
          <Metric label="Agendados atrasados" value={overdue} tone="warn" hint="passaram da hora" />
          <Metric
            label="Tentativas esgotadas"
            value={exhausted}
            tone="bad"
            hint="sem novas tentativas automáticas"
          />
          <Metric label="Falharam" value={failed} tone="warn" hint="total" />
        </dl>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {stuckRequeueable > 0 && (
            <Button
              variant="primary"
              size="sm"
              leadingIcon={<Icon.refresh />}
              onClick={() => openConfirm("stuck")}
            >
              {`Destravar ${posts(stuckRequeueable)} ${stuckRequeueable === 1 ? "preso" : "presos"}`}
            </Button>
          )}
          {failedRequeueable > 0 && (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Icon.refresh />}
              onClick={() => openConfirm("failed")}
            >
              {`Reenviar todos (${failedRequeueable})`}
            </Button>
          )}
          {failed > 0 && (
            <Link href="/posts?status=failed" className={LOOSE_LINK_SM}>
              Ver os que falharam
            </Link>
          )}
          {overdue > 0 && stuck === 0 && failed === 0 && (
            <Link href="/posts?status=scheduled" className={LOOSE_LINK_SM}>
              Ver agendados
            </Link>
          )}
        </div>

        {(stuckSkipped > 0 || failedSkipped > 0) && (
          <p className="mt-3 text-sm text-fg-muted">
            {posts(stuckSkipped + failedSkipped)} com problema{" "}
            {stuckSkipped + failedSkipped === 1 ? "é" : "são"} de cliente só produção e não{" "}
            {stuckSkipped + failedSkipped === 1 ? "volta" : "voltam"} à fila.
          </p>
        )}

        {overdue > 0 && (
          <p className="mt-3 text-sm text-warning-fg">
            {posts(overdue)} {overdue === 1 ? "passou" : "passaram"} do horário e{" "}
            {overdue === 1 ? "continua" : "continuam"} “Agendado”: sinal de que o publicador automático pode
            não estar rodando.
          </p>
        )}
      </section>

      <ConfirmDialog
        open={confirm !== null}
        title={dialog.title}
        description={dialog.description}
        consequences={dialog.consequences}
        confirmLabel={dialog.confirmLabel}
        busy={busy}
        busyLabel={dialog.busyLabel}
        error={error}
        onConfirm={() => confirm && requeue(confirm)}
        onCancel={closeConfirm}
      />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}

/* Mapas estáticos de classes (H-03). Zero fica apagado; > 0 ganha o tom. */
const METRIC_VALUE = {
  ok: "text-fg-faint",
  warn: "text-warning-fg",
  bad: "text-danger-fg",
} as const;

function Metric({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: "warn" | "bad";
  hint: string;
}) {
  return (
    <div className="flex flex-col rounded-control border border-line bg-sunken px-3 py-2.5">
      <dt className="order-2 mt-1.5 text-xs font-medium leading-tight text-fg-muted">
        {label}
        <span className="block font-normal text-fg-faint">{hint}</span>
      </dt>
      <dd
        className={`order-1 font-display text-2xl font-semibold leading-none tracking-display tabular-nums ${
          METRIC_VALUE[value === 0 ? "ok" : tone]
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
