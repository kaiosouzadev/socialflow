"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/Dialog";
import { Icon } from "@/components/Icons";
import type { ToastState } from "@/components/Toast";
import { labelOf, SCHEDULE_STATUS } from "@/lib/status-meta";

/*
 * Cronogramas sem posts (F13): saem da lista principal e ficam numa seção recolhida no
 * fim da página, com "Excluir" por linha e "Excluir todos os vazios (N)". O servidor
 * revalida "0 posts" (DELETE /api/schedules/[id] e POST /api/schedules/cleanup-empty).
 */

export type EmptyScheduleRow = {
  id: string;
  client: string;
  /** "Outubro de 2026" */
  month: string;
  status: string;
  /** criado em "07/10" */
  createdAt: string;
  /** link público já gerado (enviado ao cliente alguma vez) */
  link: string | null;
};

type Notify = (t: ToastState) => void;
type DialogState = { kind: "one"; row: EmptyScheduleRow } | { kind: "all"; rows: EmptyScheduleRow[] } | null;

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** Linhas que mostram ao cliente um link que vai parar de funcionar. */
const sentToClient = (r: EmptyScheduleRow) => !!r.link;

function oneConsequences(row: EmptyScheduleRow): string[] {
  const out = ["O cronograma sai de Aprovações. Ele não tem nenhum post: nada mais é apagado."];
  if (sentToClient(row)) {
    out.push("O link enviado ao cliente deixa de funcionar: quem abrir verá a página “não encontrado”.");
  }
  out.push("Não dá para desfazer. Para planejar o mês de novo, gere ou importe o cronograma na página do cliente.");
  return out;
}

function allConsequences(rows: EmptyScheduleRow[]): string[] {
  const sent = rows.filter(sentToClient).length;
  const out = [
    rows.length === 1
      ? "O cronograma sai de Aprovações. Ele não tem nenhum post: nada mais é apagado."
      : `Os ${rows.length} cronogramas saem de Aprovações. Nenhum tem posts: nada mais é apagado.`,
  ];
  if (sent > 0) {
    out.push(
      sent === 1
        ? "1 deles foi enviado ao cliente: o link enviado deixa de funcionar (a página mostra “não encontrado”)."
        : `${sent} deles foram enviados ao cliente: os links enviados deixam de funcionar (a página mostra “não encontrado”).`
    );
  }
  out.push("Não dá para desfazer.");
  return out;
}

export default function EmptySchedules({ rows, notify }: { rows: EmptyScheduleRow[]; notify: Notify }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // o servidor recusou com o estado mudado (ex.: ganhou posts): ao fechar, recarrega
  const [stale, setStale] = useState(false);
  // excluídos nesta visita: somem na hora, antes do refresh do servidor
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  // depois de excluir o último, a seção continua (com o aviso) para o foco ter onde ficar
  const [deletedHere, setDeletedHere] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const titleId = useId();

  const visible = rows.filter((r) => !removed.has(r.id));
  if (visible.length === 0 && !deletedHere) return null;

  function openDialog(next: Exclude<DialogState, null>) {
    setError(null);
    setStale(false);
    setDialog(next);
  }

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setError(null);
    if (stale) router.refresh();
  }

  /** Foco depois de excluir: botão da próxima linha, senão da anterior, senão o título da seção. */
  function focusAfter(ids: string[]) {
    const gone = new Set(ids);
    const index = visible.findIndex((r) => gone.has(r.id));
    const rest = visible.filter((r) => !gone.has(r.id));
    const neighbor = rest[index] ?? rest[index - 1] ?? null;
    // depois do diálogo devolver o foco ao botão que o abriu (que vai sumir)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const target = neighbor
          ? document.querySelector<HTMLElement>(`[data-empty-delete="${neighbor.id}"]`)
          : null;
        (target ?? toggleRef.current)?.focus();
      })
    );
  }

  async function confirm() {
    if (!dialog) return;
    const targets = dialog.kind === "one" ? [dialog.row] : dialog.rows;
    setBusy(true);
    setError(null);
    try {
      const r =
        dialog.kind === "one"
          ? await fetch(`/api/schedules/${dialog.row.id}`, { method: "DELETE" })
          : await fetch("/api/schedules/cleanup-empty", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ ids: dialog.rows.map((x) => x.id) }),
            });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        // N-14: só o texto do servidor; objeto vira mensagem desta tela
        setError(typeof d?.error === "string" ? d.error : "Não foi possível excluir agora. Tente de novo.");
        if (r.status === 404 || r.status === 409) setStale(true);
        return;
      }
      // excluídos de fato (o 404 do lote = já não existiam: somem também)
      const gone =
        dialog.kind === "one"
          ? [dialog.row.id]
          : [
              ...(Array.isArray(d?.deletedIds) ? (d.deletedIds as string[]) : []),
              ...(Array.isArray(d?.notFound) ? (d.notFound as string[]) : []),
            ];
      const goneSet = new Set(gone.map((id) => id.toLowerCase()));
      const goneIds = targets.filter((t) => goneSet.has(t.id.toLowerCase())).map((t) => t.id);
      const kept = Array.isArray(d?.withPosts) ? d.withPosts.length : 0;
      const deleted = typeof d?.deleted === "number" ? d.deleted : goneIds.length;

      focusAfter(goneIds);
      setRemoved((prev) => new Set([...prev, ...goneIds]));
      setDeletedHere(true);
      setDialog(null);
      const keptNote =
        kept > 0
          ? ` ${kept === 1 ? "1 não foi excluído porque recebeu posts." : `${kept} não foram excluídos porque receberam posts.`}`
          : "";
      notify({
        kind: kept > 0 ? "info" : "success",
        text:
          dialog.kind === "one"
            ? `Cronograma de ${dialog.row.month} de ${dialog.row.client} excluído.`
            : `${deleted === 1 ? "1 cronograma sem posts excluído." : `${deleted} cronogramas sem posts excluídos.`}${keptNote}`,
      });
      router.refresh();
    } catch {
      setError("Falha de conexão ao excluir. Verifique a internet e tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  const n = visible.length;
  const dialogProps =
    dialog?.kind === "one"
      ? {
          title: `Excluir o cronograma de ${dialog.row.month} de ${dialog.row.client}?`,
          consequences: oneConsequences(dialog.row),
          confirmLabel: "Excluir cronograma",
        }
      : dialog?.kind === "all"
        ? {
            title:
              dialog.rows.length === 1
                ? "Excluir 1 cronograma sem posts?"
                : `Excluir ${dialog.rows.length} cronogramas sem posts?`,
            consequences: allConsequences(dialog.rows),
            confirmLabel: dialog.rows.length === 1 ? "Excluir 1 cronograma" : `Excluir ${dialog.rows.length} cronogramas`,
          }
        : null;

  return (
    <section aria-labelledby={titleId} className="mt-10">
      <h2 id={titleId} className="text-base font-semibold text-fg">
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((v) => !v)}
          className="-ml-2 inline-flex min-h-11 items-center gap-2 rounded-control px-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:min-h-10"
        >
          <span
            aria-hidden="true"
            className={`inline-flex size-4 shrink-0 text-fg-muted transition-transform duration-(--sf-dur-fast) [&>svg]:size-full ${open ? "rotate-90" : ""}`}
          >
            <Icon.chevronRight />
          </span>
          Cronogramas sem posts ({n})
        </button>
      </h2>
      <p className="mt-1 text-sm text-fg-muted">Cronogramas sem nenhum post. Exclua os que não vão ser usados.</p>

      <div id={listId} hidden={!open} className="mt-3">
        {n === 0 ? (
          <p className="text-sm text-fg-muted">Nenhum cronograma sem posts.</p>
        ) : (
          <>
            <Button
              variant="secondary"
              leadingIcon={<Icon.trash />}
              disabled={busy}
              onClick={() => openDialog({ kind: "all", rows: visible })}
              className="mb-3"
            >
              Excluir todos os vazios ({n})
            </Button>
            <ul aria-labelledby={titleId} className="card divide-y divide-line overflow-hidden">
              {visible.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-fg">
                      {r.client} <span className="font-normal text-fg-muted">· {r.month}</span>
                    </h3>
                    <p className="mt-0.5 text-xs text-fg-muted">
                      {labelOf(SCHEDULE_STATUS, r.status)} · 0 posts · criado em {r.createdAt}
                      {sentToClient(r) && " · link já enviado ao cliente"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    leadingIcon={<Icon.trash />}
                    data-empty-delete={r.id}
                    aria-label={`Excluir o cronograma de ${r.month} de ${r.client}`}
                    disabled={busy}
                    onClick={() => openDialog({ kind: "one", row: r })}
                    className="self-start sm:self-auto"
                  >
                    Excluir
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {dialogProps && (
        <ConfirmDialog
          open
          {...dialogProps}
          tone="danger"
          busy={busy}
          busyLabel="Excluindo…"
          error={error}
          onConfirm={() => void confirm()}
          onCancel={closeDialog}
        >
          {dialog?.kind === "all" && (
            <div>
              <p className="font-medium">Cronogramas:</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5">
                {dialog.rows.slice(0, 8).map((r) => (
                  <li key={r.id}>
                    {r.client} · {r.month}
                    {sentToClient(r) && " (enviado ao cliente)"}
                  </li>
                ))}
                {dialog.rows.length > 8 && <li>e mais {plural(dialog.rows.length - 8, "cronograma", "cronogramas")}</li>}
              </ul>
            </div>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
