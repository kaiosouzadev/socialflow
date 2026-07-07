"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";

type Row = {
  id: string;
  client: string;
  plan: string;
  month: string;
  status: string;
  posts: number;
  sentAt: string | null;
  link: string | null;
};

const STATUS: Record<string, { label: string; text: string; bg: string; dot: string }> = {
  rascunho: { label: "Rascunho", text: "text-zinc-300", bg: "bg-white/5 border-white/10", dot: "#a1a1aa" },
  aprovado_interno: { label: "Aprovado (interno)", text: "text-sky-300", bg: "bg-sky-500/10 border-sky-500/20", dot: "#38bdf8" },
  enviado_cliente: { label: "Enviado ao cliente", text: "text-amber-300", bg: "bg-amber-500/10 border-amber-500/20", dot: "#fbbf24" },
  em_revisao: { label: "Em revisão", text: "text-violet-300", bg: "bg-violet-500/10 border-violet-500/20", dot: "#a78bfa" },
  aprovado_cliente: { label: "Aprovado", text: "text-emerald-300", bg: "bg-emerald-500/10 border-emerald-500/20", dot: "#34d399" },
};

const STEPS = ["Rascunho", "Interno", "Enviado", "Aprovado"];
const STEP_INDEX: Record<string, number> = {
  rascunho: 0,
  aprovado_interno: 1,
  enviado_cliente: 2,
  em_revisao: 2,
  aprovado_cliente: 3,
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, text: "text-zinc-300", bg: "bg-white/5 border-white/10", dot: "#a1a1aa" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${s.text} ${s.bg}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}

function Steps({ status }: { status: string }) {
  const cur = STEP_INDEX[status] ?? 0;
  const done = status === "aprovado_cliente";
  return (
    <div className="flex items-center gap-1.5">
      {STEPS.map((label, i) => {
        const active = i <= cur;
        return (
          <span
            key={label}
            title={label}
            className={`h-1.5 rounded-full transition-all ${active ? (done ? "bg-emerald-400" : "bg-[var(--color-accent)]") : "bg-white/10"}`}
            style={{ width: i === cur ? 22 : 14 }}
          />
        );
      })}
    </div>
  );
}

function RowItem({ row }: { row: Row }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [link, setLink] = useState(row.link);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);

  async function send() {
    setBusy("send");
    setMsg("");
    setOk(false);
    const r = await fetch(`/api/schedules/${row.id}/send`, { method: "POST" });
    const d = await r.json().catch(() => null);
    setBusy("");
    if (!r.ok) { setMsg(typeof d?.error === "string" ? d.error : "Erro ao enviar"); return; }
    setLink(d.link);
    setOk(d.emailed === true);
    setMsg(
      d.emailed
        ? `E-mail enviado para ${d.to ?? "o cliente"}`
        : `E-mail NÃO enviado: ${d.emailError ?? "erro desconhecido"} — copie o link`
    );
    router.refresh();
  }

  async function approveInternal() {
    setBusy("appr");
    setMsg("");
    const r = await fetch(`/api/schedules/${row.id}/approve-internal`, { method: "POST" });
    setBusy("");
    if (r.ok) router.refresh();
    else setMsg("Erro ao aprovar");
  }

  function copy() {
    if (link) { navigator.clipboard.writeText(link); setOk(true); setMsg("Link copiado"); }
  }

  const done = row.status === "aprovado_cliente";
  const sent = row.status === "enviado_cliente" || row.status === "em_revisao";
  const s = STATUS[row.status] ?? STATUS.rascunho;

  return (
    <div className="relative pl-4 pr-5 py-4 hover:bg-white/[0.02] transition-colors">
      <span className="absolute left-0 top-3 bottom-3 w-1 rounded-full" style={{ background: s.dot }} />

      <div className="flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold truncate">{row.client}</p>
            <span className="text-[var(--color-text-faint)] text-sm">·</span>
            <span className="text-sm text-[var(--color-text-muted)] capitalize">{row.month}</span>
            <StatusPill status={row.status} />
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-[var(--color-text-faint)]">
            <span className="inline-flex items-center gap-1">
              <Icon.calendar className="w-3.5 h-3.5" /> {row.posts} posts
            </span>
            <span className="inline-flex items-center gap-1">
              <Icon.shield className="w-3.5 h-3.5" />
              {row.plan === "aprovacao_cliente" ? "com aprovação" : "auto-publicação"}
            </span>
            {row.sentAt && (
              <span className="inline-flex items-center gap-1">
                <Icon.send className="w-3.5 h-3.5" /> {row.sentAt}
              </span>
            )}
          </div>
          <div className="mt-2.5">
            <Steps status={row.status} />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost !py-2 text-xs inline-flex items-center gap-1.5"
            >
              <Icon.link className="w-3.5 h-3.5" /> Abrir
            </a>
          )}
          {link && !done && (
            <button onClick={copy} className="btn-ghost !py-2 text-xs inline-flex items-center gap-1.5">
              Copiar link
            </button>
          )}
          {!done && (
            <button onClick={send} disabled={busy !== ""} className="btn-ghost !py-2 text-xs inline-flex items-center gap-1.5">
              <Icon.send className="w-3.5 h-3.5" />
              {busy === "send" ? "Enviando..." : sent ? "Reenviar" : "Enviar p/ cliente"}
            </button>
          )}
          {!done && (
            <button onClick={approveInternal} disabled={busy !== ""} className="btn-primary !py-2 text-xs inline-flex items-center gap-1.5">
              <Icon.check className="w-3.5 h-3.5" />
              {busy === "appr" ? "..." : "Aprovar interno"}
            </button>
          )}
          {done && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
              <Icon.check className="w-4 h-4" /> Concluído
            </span>
          )}
        </div>
      </div>

      {msg && (
        <p className={`text-xs mt-2 ${ok ? "text-emerald-300" : "text-[var(--color-text-muted)]"}`}>{msg}</p>
      )}
    </div>
  );
}

export default function SchedulesManager({ rows }: { rows: Row[] }) {
  return (
    <div className="card overflow-hidden divide-y divide-[var(--color-border)]">
      {rows.map((r) => (
        <RowItem key={r.id} row={r} />
      ))}
    </div>
  );
}
