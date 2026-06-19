"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MonthPicker, TimePicker } from "@/components/DatePickers";
import CalendarReviewModal, { type PreviewPost } from "./CalendarReviewModal";

type Preview = {
  month: string;
  clientName: string;
  activePlatforms: string[];
  posts: PreviewPost[];
};

function SparkleIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3Z" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z" />
    </svg>
  );
}

function nextMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function GenerateCalendarButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(nextMonth());
  const [time, setTime] = useState("18:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);

  async function generate() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/ai/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, month, time, count: 12 }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(typeof data?.error === "string" ? data.error : "Falha ao gerar o calendário.");
      return;
    }
    setOpen(false);
    setPreview({
      month: data.month,
      clientName: data.clientName,
      activePlatforms: data.activePlatforms ?? [],
      posts: data.posts ?? [],
    });
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="btn-ghost">
        <SparkleIcon className="w-4 h-4" />
        Calendário com IA
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 mt-2 w-80 z-20 card p-5 shadow-2xl"
            style={{ backgroundColor: "var(--color-surface)" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <SparkleIcon className="w-4 h-4 text-[var(--color-accent)]" />
              <h3 className="font-semibold text-sm">Gerar calendário do mês</h3>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mb-4">
              A IA cria <strong>12 posts</strong> (3 por semana) como rascunho, no tom de voz do
              cliente, para você revisar.
            </p>

            <div className="space-y-3">
              <div>
                <label className="label">Mês de referência</label>
                <MonthPicker value={month} onChange={setMonth} />
              </div>
              <div>
                <label className="label">Horário padrão</label>
                <TimePicker value={time} onChange={setTime} />
              </div>
            </div>

            {error && (
              <p className="mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex gap-2 mt-4">
              <button onClick={() => setOpen(false)} className="btn-ghost flex-1 !py-2">
                Cancelar
              </button>
              <button onClick={generate} disabled={busy} className="btn-primary flex-1 !py-2">
                {busy ? "Gerando..." : "Gerar 12 posts"}
              </button>
            </div>
          </div>
        </>
      )}

      {preview && (
        <CalendarReviewModal
          clientId={clientId}
          clientName={preview.clientName}
          month={preview.month}
          availablePlatforms={preview.activePlatforms}
          initialPosts={preview.posts}
          onClose={() => setPreview(null)}
          onCommitted={() => {
            setPreview(null);
            router.push(`/calendar?view=month&ref=${preview.month}-01`);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
