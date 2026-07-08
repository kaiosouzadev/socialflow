"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";

type MonthRow = {
  month: string;
  label: string;
  templates: number;
  scheduled: number;
  withArt: number;
};

/**
 * Plano básico: agenda o calendário do mês (posts sem arte) e gera as artes
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

  const load = useCallback(async () => {
    const r = await fetch(`/api/clients/${clientId}/basic-plan`);
    const d = await r.json().catch(() => null);
    if (r.ok) setMonths(d.months ?? []);
  }, [clientId]);

  async function schedule(month: string, label: string) {
    setBusy(`s:${month}`);
    setMsg(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/basic-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, action: "schedule" }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(typeof d?.error === "string" ? d.error : "Falha ao agendar");
      const skips = (d.skipped ?? []).length;
      setMsg({
        ok: true,
        text: `${label}: ${d.scheduled} posts agendados${skips ? ` · ${skips} pulados (datas passadas)` : ""}`,
      });
      await load();
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Erro" });
    } finally {
      setBusy("");
    }
  }

  async function generateArts(month: string, label: string) {
    setBusy(`a:${month}`);
    setMsg(null);
    let created = 0;
    const issues: string[] = [];
    try {
      for (let round = 0; round < 12; round++) {
        setProgress(created > 0 ? `${created} artes geradas...` : "Gerando artes...");
        const r = await fetch(`/api/clients/${clientId}/basic-plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ month, action: "arts" }),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(typeof d?.error === "string" ? d.error : "Falha na geração");
        created += d.created ?? 0;
        for (const s of d.skipped ?? []) issues.push(`${s.title}: ${s.reason}`);
        for (const w of d.warnings ?? []) issues.push(w);
        if (!d.remaining) break;
      }
      const extra = issues.length
        ? ` · ${issues.length} avisos: ${issues.slice(0, 2).join("; ")}${issues.length > 2 ? "..." : ""}`
        : "";
      setMsg({ ok: true, text: `${label}: ${created} artes geradas${extra}` });
      await load();
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Erro na geração" });
    } finally {
      setBusy("");
      setProgress("");
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--color-border)]">
        <h2 className="font-semibold flex items-center gap-2">
          <Icon.zap className="w-4 h-4 text-[var(--color-accent)]" />
          Plano básico — calendário e artes automáticas
        </h2>
        <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
          O calendário é agendado no cadastro do cliente; aqui você gera as artes pendentes
          (personalizadas com logo, cor e contatos) e salva no Drive.
        </p>
      </div>

      {months.length === 0 ? (
        <div className="px-5 py-6 text-sm text-[var(--color-text-muted)]">
          Nenhuma arte no calendário básico ainda. Cadastre em{" "}
          <a href="/templates" className="text-[var(--color-accent)] hover:underline">
            Artes-base
          </a>{" "}
          (com mês e dia) ou use &quot;Gerar mês com IA&quot;.
        </div>
      ) : (
        <div className="divide-y divide-[var(--color-border)]">
          {months.map((m) => {
            const allScheduled = m.scheduled >= m.templates;
            const allArts = m.withArt >= m.scheduled && m.scheduled > 0;
            const done = allScheduled && allArts;
            return (
              <div key={m.month} className="flex items-center gap-4 px-5 py-3.5 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium capitalize">
                    {m.label} <span className="text-[var(--color-text-faint)] font-normal">· {m.month}</span>
                  </p>
                  <p className="text-xs text-[var(--color-text-faint)]">
                    {m.scheduled}/{m.templates} agendados · {m.withArt}/{m.scheduled || m.templates} com arte
                  </p>
                </div>
                {done ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
                    <Icon.check className="w-4 h-4" /> Completo
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    {!allScheduled && (
                      <button
                        onClick={() => schedule(m.month, m.label)}
                        disabled={busy !== ""}
                        className="btn-ghost !py-2 text-xs"
                      >
                        {busy === `s:${m.month}` ? "Agendando..." : "Agendar posts"}
                      </button>
                    )}
                    <button
                      onClick={() => generateArts(m.month, m.label)}
                      disabled={busy !== ""}
                      className="btn-primary !py-2 text-xs"
                    >
                      {busy === `a:${m.month}`
                        ? progress || "Gerando..."
                        : `Gerar artes${m.scheduled > m.withArt ? ` (${m.scheduled - m.withArt})` : ""}`}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {msg && (
        <p className={`px-5 py-3 text-xs border-t border-[var(--color-border)] ${msg.ok ? "text-emerald-300" : "text-red-400"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
