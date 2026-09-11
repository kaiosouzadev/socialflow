"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { Toast, type ToastState } from "@/components/Toast";

type Props = {
  stuck: number;
  overdue: number;
  exhausted: number;
  failed: number;
  lastPublishedLabel: string | null;
  healthy: boolean;
};

/**
 * Saúde da fila de publicação no dashboard.
 *
 * A fila travando em silêncio era o bug mais caro: posts ficavam presos em
 * "publishing" e só apareciam depois, como "Falharam". Agora o travamento é
 * visível na primeira tela, com a ação de destravar ao lado.
 */
export default function QueueHealthCard({
  stuck,
  overdue,
  exhausted,
  failed,
  lastPublishedLabel,
  healthy,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState<ToastState>(null);

  async function requeue(scope: "stuck" | "failed") {
    setBusy(scope);
    try {
      const r = await fetch("/api/posts/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setToast({
          kind: "error",
          text: typeof d?.error === "string" ? d.error : "Não foi possível recolocar na fila.",
        });
        return;
      }
      setToast({
        kind: "success",
        text:
          d.requeued > 0
            ? `${d.requeued} post(s) de volta na fila — publicação em ~2 minutos.`
            : "Nada para recolocar na fila.",
      });
      router.refresh();
    } catch {
      setToast({ kind: "error", text: "Falha de conexão. Tente novamente." });
    } finally {
      setBusy("");
    }
  }

  if (healthy && failed === 0) {
    return (
      <>
        <div className="mb-6 flex items-center gap-3 rounded-xl px-4 py-3 bg-emerald-500/[0.06] border border-emerald-500/20">
          <Icon.check className="w-4 h-4 text-emerald-400 shrink-0" />
          <p className="text-sm text-emerald-200/90">
            Fila de publicação saudável.
            {lastPublishedLabel && (
              <span className="text-[var(--color-text-faint)]">
                {" "}
                Última publicação: {lastPublishedLabel}.
              </span>
            )}
          </p>
        </div>
        <Toast toast={toast} onClose={() => setToast(null)} />
      </>
    );
  }

  return (
    <>
      <div
        className={`mb-6 card p-5 ${
          healthy ? "" : "border-red-500/25 bg-red-500/[0.04]"
        }`}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div className="flex items-center gap-2.5">
            <Icon.alert
              className={`w-5 h-5 ${healthy ? "text-amber-400" : "text-red-400"}`}
            />
            <div>
              <h2 className="font-semibold text-sm">
                {healthy ? "Fila com pendências" : "Fila de publicação travada"}
              </h2>
              <p className="text-xs text-[var(--color-text-faint)]">
                {lastPublishedLabel
                  ? `Última publicação com sucesso: ${lastPublishedLabel}`
                  : "Nenhuma publicação bem-sucedida registrada ainda"}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric
            label={`Presos publicando`}
            value={stuck}
            tone={stuck > 0 ? "bad" : "ok"}
            hint="há mais de 20 min"
          />
          <Metric
            label="Agendados atrasados"
            value={overdue}
            tone={overdue > 0 ? "warn" : "ok"}
            hint="passaram da hora"
          />
          <Metric
            label="Tentativas esgotadas"
            value={exhausted}
            tone={exhausted > 0 ? "bad" : "ok"}
            hint="o retry desistiu"
          />
          <Metric
            label="Falharam"
            value={failed}
            tone={failed > 0 ? "warn" : "ok"}
            hint="total"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap mt-4">
          {stuck > 0 && (
            <button
              onClick={() => requeue("stuck")}
              disabled={busy !== ""}
              className="btn-primary !py-2 text-xs"
            >
              <Icon.refresh className="w-3.5 h-3.5" />
              {busy === "stuck" ? "Destravando..." : `Destravar ${stuck} preso(s)`}
            </button>
          )}
          {failed > 0 && (
            <>
              <button
                onClick={() => requeue("failed")}
                disabled={busy !== ""}
                className="btn-ghost !py-2 text-xs"
              >
                <Icon.refresh className="w-3.5 h-3.5" />
                {busy === "failed" ? "Reenviando..." : `Reenviar todos (${failed})`}
              </button>
              <Link href="/posts?status=failed" className="btn-ghost !py-2 text-xs">
                Ver os que falharam
              </Link>
            </>
          )}
          {overdue > 0 && stuck === 0 && failed === 0 && (
            <Link href="/posts?status=scheduled" className="btn-ghost !py-2 text-xs">
              Ver agendados
            </Link>
          )}
        </div>

        {overdue > 0 && (
          <p className="text-xs text-amber-200/80 mt-3">
            {overdue} post(s) passaram do horário e continuam “Agendado” — sinal de que o WF-01 do
            n8n pode não estar executando.
          </p>
        )}
      </div>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}

function Metric({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "bad";
  hint: string;
}) {
  const color =
    value === 0
      ? "text-[var(--color-text-faint)]"
      : tone === "bad"
        ? "text-red-300"
        : tone === "warn"
          ? "text-amber-300"
          : "text-emerald-300";
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-white/[0.02] px-3 py-2.5">
      <p className={`text-2xl font-semibold tabular-nums leading-none ${color}`}>{value}</p>
      <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5 leading-tight">{label}</p>
      <p className="text-[10px] text-[var(--color-text-faint)] leading-tight">{hint}</p>
    </div>
  );
}
