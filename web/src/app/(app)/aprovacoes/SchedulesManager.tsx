"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icons";
import { Toast, type ToastState } from "@/components/Toast";

type Row = {
  id: string;
  client: string;
  plan: string;
  month: string;
  status: string;
  posts: number;
  withMedia: number;
  notedPosts: number;
  clientNote: string | null;
  changesAskedAt: string | null;
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

/** Quantos posts já têm arte. Cronograma sem arte publica e falha — por isso
 *  a contagem aparece aqui, antes de enviar ao cliente. */
function MediaPill({ withMedia, total }: { withMedia: number; total: number }) {
  const complete = total > 0 && withMedia === total;
  const none = withMedia === 0;
  const cls = complete
    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"
    : none
      ? "text-red-300 bg-red-500/10 border-red-500/20"
      : "text-amber-300 bg-amber-500/10 border-amber-500/20";
  return (
    <span
      title={
        complete
          ? "Todos os posts têm arte"
          : "Posts sem arte falham na publicação — adicione a mídia antes de aprovar"
      }
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}
    >
      {complete ? <Icon.check className="w-3 h-3" /> : <Icon.alert className="w-3 h-3" />}
      {withMedia}/{total} com arte
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

function RowItem({ row, notify }: { row: Row; notify: (t: ToastState) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  // link recém-gerado pelo send() desta linha; senão usa o vindo do servidor
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const link = freshLink ?? row.link;
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const [confirmingRevert, setConfirmingRevert] = useState(false);
  const [confirmingSend, setConfirmingSend] = useState(false);

  const noArt = row.posts > 0 && row.withMedia === 0;
  const partialArt = row.withMedia > 0 && row.withMedia < row.posts;

  async function send() {
    setBusy("send");
    setMsg("");
    setOk(false);
    try {
      const r = await fetch(`/api/schedules/${row.id}/send`, { method: "POST" });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        const text = typeof d?.error === "string" ? d.error : "Erro ao enviar";
        setMsg(text);
        notify({ kind: "error", text });
        return;
      }
      setFreshLink(d.link);
      setOk(d.emailed === true);
      if (d.emailed) {
        notify({ kind: "success", text: `E-mail enviado para ${d.to ?? "o cliente"}` });
        setMsg(`E-mail enviado para ${d.to ?? "o cliente"}`);
      } else {
        const text = `E-mail NÃO enviado: ${d.emailError ?? "erro desconhecido"} — copie o link e mande manualmente`;
        notify({ kind: "error", text });
        setMsg(text);
      }
      router.refresh();
    } catch {
      const text = "Falha de conexão ao enviar. Tente novamente.";
      setMsg(text);
      notify({ kind: "error", text });
    } finally {
      setBusy("");
      setConfirmingSend(false);
    }
  }

  function trySend() {
    // sem nenhuma arte, confirma antes — o cliente veria um cronograma vazio
    if (noArt) {
      setConfirmingSend(true);
      return;
    }
    void send();
  }

  async function approveInternal() {
    setBusy("appr");
    setMsg("");
    try {
      const r = await fetch(`/api/schedules/${row.id}/approve-internal`, { method: "POST" });
      if (r.ok) {
        notify({ kind: "success", text: `${row.client} · ${row.month} aprovado internamente` });
        router.refresh();
      } else {
        const d = await r.json().catch(() => null);
        const text = typeof d?.error === "string" ? d.error : "Erro ao aprovar";
        setMsg(text);
        notify({ kind: "error", text });
      }
    } catch {
      const text = "Falha de conexão ao aprovar. Tente novamente.";
      setMsg(text);
      notify({ kind: "error", text });
    } finally {
      setBusy("");
    }
  }

  async function revert() {
    setBusy("revert");
    setMsg("");
    try {
      const r = await fetch(`/api/schedules/${row.id}/revert`, { method: "POST" });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        const text = typeof d?.error === "string" ? d.error : "Erro ao reverter";
        setMsg(text);
        notify({ kind: "error", text });
        return;
      }
      const text = `Aprovação revertida — ${d.reverted ?? 0} post(s) voltaram para rascunho.`;
      setMsg(text);
      notify({ kind: "success", text });
      router.refresh();
    } catch {
      const text = "Falha de conexão ao reverter. Tente novamente.";
      setMsg(text);
      notify({ kind: "error", text });
    } finally {
      setBusy("");
      setConfirmingRevert(false);
    }
  }

  function copy() {
    if (!link) return;
    navigator.clipboard
      ?.writeText(link)
      .then(() => {
        setOk(true);
        setMsg("Link copiado");
        notify({ kind: "success", text: "Link de aprovação copiado" });
      })
      .catch(() => {
        setOk(false);
        setMsg("Não foi possível copiar — abra o link e copie da barra.");
        notify({ kind: "error", text: "Não foi possível copiar — abra o link e copie da barra." });
      });
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
          <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--color-text-faint)] flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Icon.calendar className="w-3.5 h-3.5" /> {row.posts} posts
            </span>
            <MediaPill withMedia={row.withMedia} total={row.posts} />
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
          {!done && !confirmingSend && (
            <button onClick={trySend} disabled={busy !== ""} className="btn-ghost !py-2 text-xs inline-flex items-center gap-1.5">
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
          {done && !confirmingRevert && (
            <>
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
                <Icon.check className="w-4 h-4" /> Concluído
              </span>
              <button
                onClick={() => setConfirmingRevert(true)}
                disabled={busy !== ""}
                title="Volta o cronograma para edição e tira da fila os posts ainda não publicados"
                className="btn-ghost !py-2 text-xs inline-flex items-center gap-1.5"
              >
                <Icon.refresh className="w-3.5 h-3.5" />
                Reverter aprovação
              </button>
            </>
          )}
          {done && confirmingRevert && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[var(--color-text-muted)]">
                Tirar da fila os posts não publicados?
              </span>
              <button
                onClick={revert}
                disabled={busy !== ""}
                className="font-medium text-amber-300 hover:text-amber-200"
              >
                {busy === "revert" ? "Revertendo..." : "Reverter"}
              </button>
              <button
                onClick={() => setConfirmingRevert(false)}
                disabled={busy !== ""}
                className="text-[var(--color-text-muted)] hover:text-white"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* confirmação de envio sem nenhuma arte */}
      {confirmingSend && (
        <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2.5 flex items-start gap-2.5 flex-wrap">
          <Icon.alert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200/90 flex-1 min-w-[14rem]">
            Nenhum dos {row.posts} posts tem arte. O cliente vai ver o cronograma só com temas e
            legendas, e a publicação falha sem mídia. Enviar mesmo assim?
          </p>
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={send}
              disabled={busy !== ""}
              className="font-medium text-amber-300 hover:text-amber-200"
            >
              {busy === "send" ? "Enviando..." : "Enviar assim"}
            </button>
            <button
              onClick={() => setConfirmingSend(false)}
              disabled={busy !== ""}
              className="text-[var(--color-text-muted)] hover:text-white"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* o que o cliente pediu — antes não havia canal para isso */}
      {(row.clientNote || row.notedPosts > 0) && (
        <div className="mt-3 rounded-lg border border-violet-500/25 bg-violet-500/[0.07] px-3 py-2.5">
          <p className="text-xs font-medium text-violet-200 flex items-center gap-1.5">
            <Icon.edit className="w-3.5 h-3.5" />
            Ajustes pedidos pelo cliente
            {row.changesAskedAt && (
              <span className="font-normal text-[var(--color-text-faint)]">· {row.changesAskedAt}</span>
            )}
          </p>
          {row.clientNote && (
            <p className="text-xs text-violet-100/90 mt-1.5 whitespace-pre-wrap">{row.clientNote}</p>
          )}
          {row.notedPosts > 0 && (
            <Link
              href={`/posts?scheduleId=${row.id}&noted=1`}
              className="inline-block text-xs text-[var(--color-accent)] hover:underline mt-1.5"
            >
              {row.notedPosts} {row.notedPosts === 1 ? "post com comentário" : "posts com comentário"} →
            </Link>
          )}
        </div>
      )}

      {partialArt && !done && (
        <p className="text-xs text-amber-200/80 mt-2">
          {row.posts - row.withMedia} post(s) ainda sem arte — eles falham na publicação.
        </p>
      )}

      {msg && (
        <p className={`text-xs mt-2 ${ok ? "text-emerald-300" : "text-[var(--color-text-muted)]"}`}>{msg}</p>
      )}
    </div>
  );
}

export default function SchedulesManager({ rows }: { rows: Row[] }) {
  const [toast, setToast] = useState<ToastState>(null);
  return (
    <>
      <div className="card overflow-hidden divide-y divide-[var(--color-border)]">
        {rows.map((r) => (
          <RowItem key={r.id} row={r} notify={setToast} />
        ))}
      </div>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}
