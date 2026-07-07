"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";

type MonthRow = {
  month: string;
  label: string;
  templates: number;
  created: number;
};

/**
 * Plano básico: gera as artes do banco mensal para este cliente.
 * A API processa em lotes (timeout serverless) — repete até remaining = 0.
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

  async function generate(month: string, label: string) {
    setBusy(month);
    setMsg(null);
    let created = 0;
    const issues: string[] = [];
    try {
      // lotes até terminar (cada chamada gera até 4 artes)
      for (let round = 0; round < 12; round++) {
        setProgress(created > 0 ? `${created} artes geradas...` : "Gerando artes...");
        const r = await fetch(`/api/clients/${clientId}/basic-plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ month }),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(typeof d?.error === "string" ? d.error : "Falha na geração");
        created += d.created ?? 0;
        for (const s of d.skipped ?? []) issues.push(`${s.title}: ${s.reason}`);
        for (const w of d.warnings ?? []) issues.push(w);
        if (!d.remaining) break;
      }
      const extra = issues.length ? ` · ${issues.length} avisos: ${issues.slice(0, 3).join("; ")}${issues.length > 3 ? "..." : ""}` : "";
      setMsg({ ok: true, text: `${label}: ${created} artes geradas e agendadas${extra}` });
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
          Plano básico — artes automáticas
        </h2>
        <p className="text-xs text-[var(--color-text-faint)] mt-0.5">
          Gera as artes do calendário básico personalizadas para este cliente, agenda os posts e salva no Drive.
        </p>
      </div>

      {months.length === 0 ? (
        <div className="px-5 py-6 text-sm text-[var(--color-text-muted)]">
          Nenhuma arte no calendário básico ainda. Cadastre em{" "}
          <a href="/templates" className="text-[var(--color-accent)] hover:underline">
            Artes-base
          </a>{" "}
          (com mês e dia).
        </div>
      ) : (
        <div className="divide-y divide-[var(--color-border)]">
          {months.map((m) => {
            const done = m.created >= m.templates;
            return (
              <div key={m.month} className="flex items-center gap-4 px-5 py-3.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium capitalize">{m.label} <span className="text-[var(--color-text-faint)] font-normal">· {m.month}</span></p>
                  <p className="text-xs text-[var(--color-text-faint)]">
                    {m.created}/{m.templates} artes geradas
                  </p>
                </div>
                {done ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
                    <Icon.check className="w-4 h-4" /> Completo
                  </span>
                ) : (
                  <button
                    onClick={() => generate(m.month, m.label)}
                    disabled={busy !== ""}
                    className="btn-primary !py-2 text-xs"
                  >
                    {busy === m.month
                      ? progress || "Gerando..."
                      : m.created > 0
                        ? `Gerar restantes (${m.templates - m.created})`
                        : "Gerar artes"}
                  </button>
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
