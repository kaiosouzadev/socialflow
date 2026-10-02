"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/Dialog";
import { Icon } from "@/components/Icons";

/**
 * Excluir um post da lista, sempre com confirmação (A-016).
 * - `variant="icon"` (tabela): só o ícone, revelado no hover da linha E no foco
 *   do teclado (A-009: antes ficava com opacity 0 mesmo focado).
 * - `variant="text"` (cartões do celular): botão com rótulo, sempre visível.
 */
export default function DeletePostButton({
  postId,
  postLabel,
  status,
  variant = "icon",
}: {
  postId: string;
  /** como o post é chamado na pergunta: o tema, ou "post de <cliente> em <data>" */
  postLabel: string;
  status: string;
  variant?: "icon" | "text";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setError(typeof d?.error === "string" ? d.error : "Não foi possível excluir o post. Tente de novo.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Falha de conexão. Verifique a internet e tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (busy) return;
    setOpen(false);
    setError(null);
  }

  const consequences = [
    "O post é apagado e não dá para desfazer.",
    ...(status === "scheduled" ? ["Ele sai da fila e não é publicado."] : []),
  ];

  return (
    <>
      {variant === "icon" ? (
        <Button
          iconOnly
          variant="ghost"
          size="sm"
          aria-label={`Excluir post: ${postLabel}`}
          title="Excluir post"
          onClick={() => setOpen(true)}
          className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <Icon.trash />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<Icon.trash className="text-danger-solid" />}
          aria-label={`Excluir post: ${postLabel}`}
          onClick={() => setOpen(true)}
        >
          Excluir
        </Button>
      )}

      <ConfirmDialog
        open={open}
        tone="danger"
        title={`Excluir o post «${postLabel}»?`}
        consequences={consequences}
        confirmLabel="Excluir post"
        busy={busy}
        busyLabel="Excluindo…"
        error={error}
        onConfirm={() => void remove()}
        onCancel={close}
      />
    </>
  );
}
