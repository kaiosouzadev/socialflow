"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Callout } from "@/components/Callout";
import { ConfirmDialog } from "@/components/Dialog";
import { Icon } from "@/components/Icons";
import { formatMonthLabel } from "@/lib/format-date";
import { toUserMessage } from "@/lib/user-facing-error";

type MonthRow = {
  month: string;
  label: string;
  templates: number;
  /** posts já criados (rascunhos) a partir das artes-base do mês */
  scheduled: number;
  withArt: number;
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "2026-11" → "Novembro de 2026"; chave fora do padrão aparece como veio. */
function monthTitle(m: MonthRow): string {
  return /^\d{4}-\d{2}$/.test(m.month) ? formatMonthLabel(m.month) : m.label || m.month;
}

/**
 * Plano básico: cria os posts do mês como RASCUNHO (sem arte, fora da fila de
 * publicação; `lib/basic-plan.ts` grava status "draft") e gera as artes
 * pendentes. A geração roda em lotes (timeout serverless) — repete até acabar.
 */
export default function BasicPlanManager({
  clientId,
  initial,
}: {
  clientId: string;
  initial: MonthRow[];
}) {
  const router = useRouter();
  const [months, setMonths] = useState<MonthRow[]>(initial);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // confirmação de "Criar posts do mês" (nada é criado antes de confirmar)
  const [confirming, setConfirming] = useState<MonthRow | null>(null);
  const [confirmError, setConfirmError] = useState("");

  const load = useCallback(async () => {
    const r = await fetch(`/api/clients/${clientId}/basic-plan`);
    const d = await r.json().catch(() => null);
    if (r.ok && Array.isArray(d?.months)) setMonths(d.months);
  }, [clientId]);

  function askCreate(m: MonthRow) {
    setMsg(null);
    setConfirmError("");
    setConfirming(m);
  }

  async function createPosts(m: MonthRow) {
    const title = monthTitle(m);
    setBusy(`s:${m.month}`);
    setConfirmError("");
    try {
      const r = await fetch(`/api/clients/${clientId}/basic-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: m.month, action: "schedule" }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setConfirmError(toUserMessage(d, "Não foi possível criar os posts agora. Tente de novo em instantes."));
        return;
      }
      const created = typeof d?.scheduled === "number" ? d.scheduled : 0;
      const skips = Array.isArray(d?.skipped) ? d.skipped.length : 0;
      setConfirming(null);
      setMsg({
        ok: true,
        text:
          `${title}: ${created} ${plural(created, "post criado", "posts criados")} como rascunho` +
          (skips ? ` · ${skips} ${plural(skips, "pulado", "pulados")} (datas que já passaram)` : ""),
      });
      await load();
      router.refresh();
    } catch {
      setConfirmError("Falha de conexão. Verifique a internet e tente de novo.");
    } finally {
      setBusy("");
    }
  }

  async function generateArts(m: MonthRow) {
    const title = monthTitle(m);
    setBusy(`a:${m.month}`);
    setMsg(null);
    let created = 0;
    const issues: string[] = [];
    try {
      for (let round = 0; round < 12; round++) {
        setProgress(created > 0 ? `${created} ${plural(created, "arte gerada", "artes geradas")}…` : "Gerando artes…");
        const r = await fetch(`/api/clients/${clientId}/basic-plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ month: m.month, action: "arts" }),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(toUserMessage(d, "Não foi possível gerar as artes agora. Tente de novo em instantes."));
        created += typeof d?.created === "number" ? d.created : 0;
        for (const s of Array.isArray(d?.skipped) ? d.skipped : []) issues.push(`${s.title}: ${s.reason}`);
        for (const w of Array.isArray(d?.warnings) ? d.warnings : []) issues.push(String(w));
        if (!d?.remaining) break;
      }
      const extra = issues.length
        ? ` · ${issues.length} ${plural(issues.length, "aviso", "avisos")}: ${issues.slice(0, 2).join("; ")}${issues.length > 2 ? "…" : ""}`
        : "";
      setMsg({ ok: true, text: `${title}: ${created} ${plural(created, "arte gerada", "artes geradas")}${extra}` });
      await load();
      router.refresh();
    } catch (e) {
      setMsg({
        ok: false,
        text: e instanceof Error && e.message ? e.message : "Não foi possível gerar as artes agora. Tente de novo em instantes.",
      });
    } finally {
      setBusy("");
      setProgress("");
    }
  }

  const pending = confirming ? Math.max(confirming.templates - confirming.scheduled, 0) : 0;
  const pendingTitle = confirming ? monthTitle(confirming) : "";

  return (
    <section aria-labelledby="plano-basico" className="card overflow-hidden">
      <div className="border-b border-line px-5 py-4">
        <h2 id="plano-basico" className="flex items-center gap-2 font-display text-lg font-semibold tracking-title text-fg">
          <span aria-hidden="true" className="inline-flex size-4.5 text-link [&>svg]:size-full">
            <Icon.zap />
          </span>
          Plano básico: calendário e artes automáticas
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Os posts do mês nascem como rascunho a partir das artes-base. Aqui você cria os que faltam e gera as artes
          pendentes (com logo, cor e contatos), salvas no Drive.
        </p>
      </div>

      {months.length === 0 ? (
        <p className="px-5 py-6 text-sm text-fg-muted">
          Nenhuma arte no calendário básico ainda. Cadastre em{" "}
          <Link href="/templates" className="font-medium text-link underline underline-offset-2 hover:text-link-hover">
            Artes-base
          </Link>{" "}
          (com mês e dia) ou use &quot;Gerar mês com IA&quot;.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {months.map((m) => {
            const allCreated = m.scheduled >= m.templates;
            const allArts = m.withArt >= m.scheduled && m.scheduled > 0;
            const done = allCreated && allArts;
            const missingArts = m.scheduled - m.withArt;
            const title = monthTitle(m);
            return (
              <li key={m.month} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{title}</p>
                  <p className="text-sm text-fg-muted">
                    {m.scheduled}/{m.templates} {plural(m.templates, "criado", "criados")} · {m.withArt}/
                    {m.scheduled || m.templates} com arte
                  </p>
                </div>
                {done ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success-fg">
                    <span aria-hidden="true" className="inline-flex size-4 [&>svg]:size-full">
                      <Icon.check />
                    </span>
                    Completo
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {!allCreated && (
                      <Button
                        size="sm"
                        disabled={busy !== ""}
                        aria-label={`Criar posts do mês de ${title}`}
                        onClick={() => askCreate(m)}
                      >
                        Criar posts do mês
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="primary"
                      loading={busy === `a:${m.month}`}
                      loadingText={progress || "Gerando…"}
                      disabled={busy !== "" && busy !== `a:${m.month}`}
                      onClick={() => generateArts(m)}
                    >
                      {`Gerar artes${missingArts > 0 ? ` (${missingArts})` : ""}`}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {msg && (
        <div className="border-t border-line px-5 py-3">
          <Callout tone={msg.ok ? "success" : "danger"} live={msg.ok ? "polite" : "assertive"} onDismiss={() => setMsg(null)}>
            {msg.text}
          </Callout>
        </div>
      )}

      <ConfirmDialog
        open={!!confirming}
        title={`Criar ${pending} ${plural(pending, "post (rascunho)", "posts (rascunhos)")} de ${pendingTitle}?`}
        consequences={[
          "Nenhum entra na fila de publicação: os posts ficam como rascunho, sem arte, até alguém aprovar.",
          "As datas vêm das artes-base do mês; dias que já passaram são pulados.",
          "Depois, use “Gerar artes” para criar as imagens.",
        ]}
        confirmLabel="Criar posts"
        busy={!!confirming && busy === `s:${confirming.month}`}
        busyLabel="Criando…"
        error={confirmError}
        onCancel={() => {
          if (busy) return;
          setConfirming(null);
          setConfirmError("");
        }}
        onConfirm={() => {
          if (confirming) void createPosts(confirming);
        }}
      />
    </section>
  );
}
