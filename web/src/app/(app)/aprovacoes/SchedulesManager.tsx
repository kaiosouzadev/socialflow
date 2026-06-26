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

const STATUS: Record<string, { label: string; cls: string }> = {
  rascunho: { label: "Rascunho", cls: "text-zinc-300 bg-white/5 border-white/10" },
  aprovado_interno: { label: "Aprovado (interno)", cls: "text-sky-300 bg-sky-500/10 border-sky-500/20" },
  enviado_cliente: { label: "Enviado ao cliente", cls: "text-amber-300 bg-amber-500/10 border-amber-500/20" },
  em_revisao: { label: "Em revisão (cliente)", cls: "text-violet-300 bg-violet-500/10 border-violet-500/20" },
  aprovado_cliente: { label: "Aprovado", cls: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20" },
};

function Badge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "text-zinc-300 bg-white/5 border-white/10" };
  return <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>{s.label}</span>;
}

function RowItem({ row }: { row: Row }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [link, setLink] = useState(row.link);
  const [msg, setMsg] = useState("");

  async function send() {
    setBusy("send");
    setMsg("");
    const r = await fetch(`/api/schedules/${row.id}/send`, { method: "POST" });
    const d = await r.json().catch(() => null);
    setBusy("");
    if (!r.ok) { setMsg(typeof d?.error === "string" ? d.error : "Erro ao enviar"); return; }
    setLink(d.link);
    setMsg(d.emailed ? "E-mail enviado ✓" : `Sem e-mail (${d.emailError ?? "copie o link"})`);
    router.refresh();
  }

  async function approveInternal() {
    setBusy("appr");
    const r = await fetch(`/api/schedules/${row.id}/approve-internal`, { method: "POST" });
    setBusy("");
    if (r.ok) router.refresh();
    else setMsg("Erro ao aprovar");
  }

  function copy() {
    if (link) { navigator.clipboard.writeText(link); setMsg("Link copiado ✓"); }
  }

  const done = row.status === "aprovado_cliente";

  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            {row.client} <span className="text-[var(--color-text-faint)]">· {row.month}</span>
          </p>
          <p className="text-xs text-[var(--color-text-faint)]">
            {row.posts} posts · {row.plan === "aprovacao_cliente" ? "com aprovação" : "auto-publicação"}
            {row.sentAt ? ` · enviado ${row.sentAt}` : ""}
          </p>
        </div>
        <Badge status={row.status} />
        <div className="flex items-center gap-2">
          {!done && (
            <button onClick={send} disabled={busy !== ""} className="btn-ghost !py-2 text-xs">
              {busy === "send" ? "Enviando..." : row.status === "enviado_cliente" || row.status === "em_revisao" ? "Reenviar" : "Enviar p/ cliente"}
            </button>
          )}
          {link && !done && (
            <button onClick={copy} className="btn-ghost !py-2 text-xs">Copiar link</button>
          )}
          {!done && (
            <button onClick={approveInternal} disabled={busy !== ""} className="btn-primary !py-2 text-xs">
              {busy === "appr" ? "..." : "Aprovar interno"}
            </button>
          )}
        </div>
      </div>
      {msg && <p className="text-xs text-[var(--color-text-muted)] mt-2">{msg}</p>}
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
